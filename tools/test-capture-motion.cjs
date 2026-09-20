'use strict';

// Dependency-free regression checks for the actual service-worker functions.
// This models DOM/style mutations, not browser layout or screenshot rendering.
// Run: node --test tools/test-capture-motion.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workerPath = path.join(__dirname, '..', 'full-page-screenshot-extension', 'sw.js');
const workerSource = readFileSync(workerPath, 'utf8');
const ROW_CLASS = 'vue-recycle-scroller__item-view';

function sourceFor(name) {
  const start = workerSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `Missing production function: ${name}`);
  const remaining = workerSource.slice(start);
  const next = remaining.slice(1).search(/^(?:async )?function\s+[\w$]+\s*\(/m);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

function environment() {
  const observers = [];
  const pending = new Map();
  const calls = [];
  const injectionErrors = [];

  function styleChanged(el) {
    for (const observer of observers) {
      const options = observer.targets.get(el);
      if (!options || !options.attributes ||
          (options.attributeFilter && !options.attributeFilter.includes('style'))) continue;
      const records = pending.get(observer) || [];
      records.push({ type: 'attributes', attributeName: 'style', target: el });
      pending.set(observer, records);
    }
  }

  class Element {
    constructor(tagName, classes = '', transform) {
      this.tagName = tagName.toUpperCase();
      this.className = classes;
      this.children = [];
      this.parentElement = null;
      this.id = '';
      this.textContent = '';
      this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
      const values = transform === undefined ? {} : { transform };
      this.style = new Proxy(values, {
        get(target, key) { return target[key] === undefined ? '' : target[key]; },
        set: (target, key, value) => {
          const next = String(value);
          if (target[key] !== next) {
            target[key] = next;
            styleChanged(this);
          }
          return true;
        }
      });
    }

    appendChild(el) {
      el.remove();
      el.parentElement = this;
      this.children.push(el);
      return el;
    }

    remove() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }

    closest(selector) {
      assert.ok(selector.startsWith('.'), 'Mock closest supports class selectors only');
      for (let el = this; el; el = el.parentElement) {
        if (el.classList.contains(selector.slice(1))) return el;
      }
      return null;
    }
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      this.disconnectCalls = 0;
      observers.push(this);
    }

    observe(target, options) { this.targets.set(target, options); }

    disconnect() {
      this.disconnectCalls++;
      this.targets.clear();
      pending.delete(this);
    }
  }

  const root = new Element('html');
  const head = root.appendChild(new Element('head'));
  const body = root.appendChild(new Element('body'));
  function elements(node = root) {
    return node.children.flatMap(child => [child, ...elements(child)]);
  }
  const document = {
    head,
    body,
    documentElement: root,
    createElement: name => new Element(name),
    getElementById: id => elements().find(el => el.id === id) || null,
    querySelectorAll(selector) {
      if (selector === 'video') return elements().filter(el => el.tagName === 'VIDEO');
      if (selector === '[style*="transform"]') {
        return elements().filter(el => Object.keys(el.style).some(name => name.includes('transform')));
      }
      throw new Error(`Unexpected production selector: ${selector}`);
    }
  };
  const window = {};
  const chrome = {
    scripting: {
      async executeScript(options) {
        calls.push(options);
        try {
          assert.equal(options.world, 'MAIN');
          assert.equal(options.target.tabId, 17);
          return [{ result: await options.func(...(options.args || [])) }];
        } catch (error) {
          injectionErrors.push(error);
          throw error;
        }
      }
    }
  };
  const context = vm.createContext({ document, window, chrome, MutationObserver });
  vm.runInContext(`${sourceFor('pauseCssAnims')}\n${sourceFor('resumeCssAnims')}`, context,
    { filename: workerPath });

  function element(classes, transform, parent = body) {
    return parent.appendChild(new Element('div', classes, transform));
  }
  function video(paused) {
    const el = body.appendChild(new Element('video'));
    Object.assign(el, {
      paused, pauseCalls: 0, playCalls: 0,
      pause() { this.paused = true; this.pauseCalls++; },
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); }
    });
    return el;
  }
  function flush() {
    // MutationObserver callbacks run after a mutation and can queue another one.
    let rounds = 0;
    while (pending.size) {
      assert.ok(++rounds < 50, 'Mutation callbacks did not settle');
      const batch = Array.from(pending);
      pending.clear();
      for (const [observer, records] of batch) {
        if (observer.targets.size) observer.callback(records, observer);
      }
    }
  }
  async function invoke(name) {
    await context[name](17);
    flush();
    assert.equal(injectionErrors.length, 0, injectionErrors.map(String).join('\n'));
  }

  return {
    element, video, flush, window, document, observers, calls,
    pause: () => invoke('pauseCssAnims'),
    resume: () => invoke('resumeCssAnims'),
    observed: el => observers.some(observer => observer.targets.has(el))
  };
}

test('all 26 recycled rows, including parked rows, remain free to move', async () => {
  const env = environment();
  const offsets = [0, 88, 224, 408, 544, 632, 720, 808, ...Array(18).fill(-9999)];
  const rows = offsets.map((y, index) => env.element(
    index === 0 ? `active ${ROW_CLASS} selected` : ROW_CLASS, `translateY(${y}px)`));
  await env.pause();
  assert.equal(env.observers.length, 0, 'Recycled rows must not create observers');
  assert.equal(env.window.__shotFrozen.length, 0);
  rows.forEach((row, index) => { row.style.transform = `translateY(${3000 + index * 88}px)`; });
  env.flush();
  rows.forEach((row, index) => {
    assert.equal(env.observed(row), false);
    assert.equal(row.style.transform, `translateY(${3000 + index * 88}px)`);
  });
  await env.resume();
});

test('tickers outside AND inside a recycled row still freeze independently', async () => {
  const env = environment();
  const row = env.element(ROW_CLASS, 'translateY(-9999px)');
  const outside = env.element('carousel-track', 'translateX(-60px)');
  const inside = env.element('ticker', 'translateX(30px)', row);
  await env.pause();
  assert.equal(env.observers.length, 2);
  assert.equal(env.observed(row), false);
  assert.equal(env.observed(outside), true);
  assert.equal(env.observed(inside), true);
  row.style.transform = 'translateY(800px)';
  outside.style.transform = 'translateX(-300px)';
  inside.style.transform = 'translateX(90px)';
  outside.style.opacity = '0.4';
  env.flush();
  assert.equal(row.style.transform, 'translateY(800px)');
  assert.equal(outside.style.transform, 'translateX(-60px)');
  assert.equal(inside.style.transform, 'translateX(30px)');
  assert.equal(outside.style.opacity, '0.4', 'Non-transform changes must survive');
  await env.resume();
});

test('similar class names are not exempt and empty/none transforms stay ignored', async () => {
  const env = environment();
  const lookalikes = [
    `${ROW_CLASS}-extra`, `prefix-${ROW_CLASS}`, 'vue-recycle-scroller__item-wrapper',
    ROW_CLASS.toUpperCase()
  ].map(name => env.element(name, 'translateY(16px)'));
  const none = env.element('carousel-track', 'none');
  const empty = env.element('carousel-track', '');
  const absent = env.element('carousel-track');
  await env.pause();
  assert.equal(env.observers.length, lookalikes.length);
  for (const el of lookalikes) {
    assert.equal(env.observed(el), true);
    el.style.transform = 'translateY(400px)';
  }
  env.flush();
  for (const el of lookalikes) assert.equal(el.style.transform, 'translateY(16px)');
  for (const el of [none, empty, absent]) assert.equal(env.observed(el), false);
  await env.resume();
});

test('resume cleans up and a second capture freezes fresh values without leftovers', async () => {
  const env = environment();
  const row = env.element(ROW_CLASS, 'translateY(0px)');
  const ticker = env.element('ticker', 'translateX(10px)', row);
  const playing = env.video(false);
  const alreadyPaused = env.video(true);
  await env.pause();
  const pauseStyle = env.document.getElementById('__shot_css_pause');
  assert.ok(pauseStyle);
  assert.match(pauseStyle.textContent, /animation-play-state:paused/);
  assert.match(pauseStyle.textContent, /scrollbar-width:none/);
  assert.equal(playing.paused, true);
  assert.equal(alreadyPaused.pauseCalls, 0);
  const firstObserver = env.observers[0];
  await env.resume();
  assert.equal(firstObserver.disconnectCalls, 1);
  assert.equal(env.observed(ticker), false);
  assert.equal(env.document.getElementById('__shot_css_pause'), null);
  assert.equal(env.window.__shotFrozen, null);
  assert.equal(env.window.__shotPausedVideos, null);
  assert.equal(playing.paused, false);
  assert.equal(playing.playCalls, 1);
  assert.equal(alreadyPaused.paused, true);
  assert.equal(alreadyPaused.playCalls, 0);

  ticker.style.transform = 'translateX(70px)';
  row.style.transform = 'translateY(400px)';
  env.flush();
  assert.equal(ticker.style.transform, 'translateX(70px)');
  await env.pause();
  assert.equal(env.observers.length, 2);
  assert.equal(env.window.__shotFrozen.length, 1);
  assert.notEqual(env.observers[1], firstObserver);
  assert.notEqual(env.document.getElementById('__shot_css_pause'), pauseStyle);
  ticker.style.transform = 'translateX(999px)';
  row.style.transform = 'translateY(900px)';
  env.flush();
  assert.equal(ticker.style.transform, 'translateX(70px)');
  assert.equal(row.style.transform, 'translateY(900px)');
  await env.resume();
  assert.ok(env.observers.every(observer => observer.disconnectCalls === 1));
  assert.equal(env.document.getElementById('__shot_css_pause'), null);
  assert.equal(env.window.__shotFrozen, null);
  assert.equal(env.window.__shotPausedVideos, null);
  assert.equal(env.calls.length, 4);
});
