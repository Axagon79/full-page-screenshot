'use strict';

// Actual capture controller + actual Multi Snip queue/write functions.
// Chrome APIs and page layout are simulated; these are not pixel/browser tests.
// Run: node --test tools/test-capture-stop.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'full-page-screenshot-extension');
const controllerSource = readFileSync(path.join(extension, 'capture-control.js'), 'utf8');
const workerSource = readFileSync(path.join(extension, 'sw.js'), 'utf8');
const PNG = 'data:image/png;base64,c2NyZWVuc2hvdA==';
const JPEG = 'data:image/jpeg;base64,Y29tcHJlc3NlZA==';

function productionFunction(name) {
  const start = workerSource.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing production function: ${name}`);
  const tail = workerSource.slice(start);
  const end = tail.search(/^\}/m);
  assert.notEqual(end, -1, `Missing function end: ${name}`);
  return tail.slice(0, end + 1);
}

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Operation never reached: ${label}`);
}

function collection() {
  return { active: true, sessionId: 'existing-session', sourceTabId: 10, editorTabId: 88,
    pieces: [{ img: 'old-image', tipo: 'area', id: 4 }],
    trash: [{ img: 'undone-image', tipo: 'visible', id: 5 }], nextId: 5 };
}

function environment(options = {}) {
  const events = [], hooks = options.hooks || {};
  const store = { multi: clone(options.multi) };
  const outputs = { downloads: [], clipboard: [], widgets: [], errors: [], captures: [], captureProgress: [], writes: [], successes: 0 };
  const iconCanvases = [];
  const iconFixture = Object.assign({ width: 94, height: 94, x: 9, y: 9, w: 76, h: 76, alpha: 255 }, options.iconFixture);
  let context, pageContext, messageListener, actionListener;
  const note = (name, value) => events.push({ name, value: clone(value), locked: !!(context && context.activeCaptureJob) });
  const callHook = async (name, ...args) => { if (hooks[name]) return hooks[name](...args); };
  const attrs = new Set(['data-screenshot-scroll', 'data-screenshot-area-pane']);
  const scroller = { scrollTop: 42, scrollLeft: 3, scrollHeight: 500, scrollWidth: 200,
    clientHeight: 100, clientWidth: 200, isConnected: true,
    scrollTo(pos) { this.scrollTop = pos.top; this.scrollLeft = pos.left; note('page.scroller.restore', pos); },
    removeAttribute(attr) { attrs.delete(attr); } };
  const nodeIds = new Set(['__shot_multi_widget', '__screenshot_bollino']);
  const pageNodes = new Map();
  function connectNode(node, connected) {
    node.isConnected = connected;
    node.children.forEach(child => connectNode(child, connected));
    if (node.shadowRoot) connectNode(node.shadowRoot, connected);
  }
  function pageElement(tag) {
    const properties = new Map(), attributes = new Map(), eventListeners = new Map();
    const node = {
      tagName: tag.toUpperCase(), children: [], parentNode: null, isConnected: false,
      textContent: '', hidden: false, disabled: false,
      style: {
        setProperty(name, value, priority = '') { properties.set(name, { value: String(value), priority }); },
        getPropertyValue(name) { return properties.get(name)?.value || ''; },
        getPropertyPriority(name) { return properties.get(name)?.priority || ''; },
        removeProperty(name) { const value = this.getPropertyValue(name); properties.delete(name); return value; }
      },
      setAttribute(name, value) { attributes.set(name, String(value)); if (name === 'id') this.id = String(value); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      addEventListener(type, fn) {
        if (!eventListeners.has(type)) eventListeners.set(type, []);
        eventListeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        if (eventListeners.has(type)) eventListeners.set(type, eventListeners.get(type).filter(listener => listener !== fn));
      },
      dispatchEvent(event) {
        event.target ||= this;
        event.currentTarget = this;
        event.preventDefault ||= function() { this.defaultPrevented = true; };
        event.stopPropagation ||= function() {};
        event.stopImmediatePropagation ||= function() {};
        for (const listener of eventListeners.get(event.type) || []) listener.call(this, event);
        return !event.defaultPrevented;
      },
      click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); },
      focus() {
        let root = this;
        while (root.parentNode) root = root.parentNode;
        if (root.host) { root.activeElement = this; document.activeElement = root.host; }
        else document.activeElement = this;
      },
      blur() {
        let root = this;
        while (root.parentNode) root = root.parentNode;
        if (root.host && root.activeElement === this) root.activeElement = null;
        document.activeElement = body;
      },
      appendChild(child) {
        this.children.push(child); child.parentNode = this; connectNode(child, this.isConnected);
        if (child.id) { pageNodes.set(child.id, child); nodeIds.add(child.id); }
        return child;
      },
      append(...children) { children.forEach(child => this.appendChild(child)); },
      attachShadow() {
        this.shadowRoot = pageElement('shadow-root'); this.shadowRoot.isConnected = this.isConnected;
        this.shadowRoot.host = this; this.shadowRoot.activeElement = null;
        return this.shadowRoot;
      },
      remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null; connectNode(this, false);
        if (this.id) { pageNodes.delete(this.id); nodeIds.delete(this.id); note('page.remove', this.id); }
      }
    };
    return node;
  }
  const documentElement = pageElement('html');
  documentElement.isConnected = true;
  const body = pageElement('body');
  documentElement.appendChild(body);
  const page = { scrollX: 2, scrollY: 75,
    scrollTo(pos, y) {
      if (typeof pos === 'number') pos = { left: pos, top: y };
      this.scrollX = pos.left; this.scrollY = pos.top; note('page.window.restore', pos);
    } };
  const listeners = new Map();
  const document = {
    title: options.title ?? 'Test page',
    scrollingElement: {}, documentElement, body, activeElement: body,
    createElement(tag) {
      if (tag !== 'canvas') return pageElement(tag);
      return { width: 0, height: 0, getContext() { return { drawImage() {} }; },
        toDataURL() { return options.dataUrl || PNG; } };
    },
    querySelectorAll(selector) {
      if (selector === '*') return [scroller];
      const match = /^\[([^\]]+)\]$/.exec(selector);
      if (match) return attrs.has(match[1]) ? [scroller] : [];
      throw new Error(`Unexpected page selector: ${selector}`);
    },
    getElementById(id) {
      return pageNodes.get(id) || (nodeIds.has(id) ? { remove() { nodeIds.delete(id); note('page.remove', id); } } : null);
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }
  };
  const chrome = {
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      getManifest() { return { name: 'Full Page Screenshot' }; },
      getURL(file) { return 'chrome-extension://test-extension/' + file; },
      async sendMessage(msg) {
        if (msg.action === 'cancelCapture') {
          note('page.cancelRequest', msg);
          let response;
          if (hooks.cancelResponse) response = await callHook('cancelResponse', msg);
          if (response === undefined) response = { cancelled: context.cancelCapture(msg.jobId) };
          note('page.cancelResponse', response);
          return response;
        }
        if (msg.type === 'progress') note('progress', msg);
        if (msg.type === 'success') { outputs.successes++; note('success'); }
        if (msg.type === 'error') outputs.errors.push(msg.message);
      }
    },
    action: { onClicked: { addListener(listener) { actionListener = listener; } } },
    storage: {
      onChanged: { addListener() {} },
      session: {
        async get(key) { await callHook('getSession', key); return { [key]: clone(store[key]) }; },
        async set(data) {
          await callHook('setSession', data);
          for (const [key, value] of Object.entries(data)) store[key] = clone(value);
          outputs.writes.push(clone(data));
          note('storage.set', Object.keys(data));
        },
        async remove(key) { note('storage.remove', key); delete store[key]; }
      },
      local: { async get() { return {}; } }
    },
    tabs: {
      async get(id) { await callHook('getTab', id); return { id, active: options.tabActive !== false, windowId: 7 }; },
      async update(id, data) { note('tabs.update', { id, ...data }); await callHook('updateTab', id, data); return { id, windowId: 7 }; },
      async create(data) { note('tabs.create', data); return { id: 88 }; },
      async captureVisibleTab(windowId, data) {
        const control = page.__shotCaptureControl;
        outputs.captureProgress.push({
          hasProgress: !!control?.progress,
          hasStopButton: !!control?.progress?.stopButton,
          display: control?.progress?.host.style.getPropertyValue('display'),
          depth: control?.progressSnapshotDepth
        });
        outputs.captures.push({ windowId, ...data });
        note('capture.begin', windowId);
        await callHook('capture');
        note('capture.end', windowId);
        return PNG + outputs.captures.length;
      }
    },
    windows: { async update(id, data) { note('windows.update', { id, ...data }); } },
    downloads: { async download(data) {
      outputs.downloads.push(clone(data));
      note('download', data);
      await callHook('download', data);
      return 1;
    } },
    scripting: { async executeScript(spec) {
      const source = spec.func.toString();
      await callHook('executeScript', source, spec.args || []);
      if (options.actualFull && source.includes('var scrollEl = null;')) {
        // Only browser geometry is synthetic. The Full Page loop, retries,
        // masking helper, composition function and save path remain actual.
        return [{ result: { sh: 1200, vh: 600, vw: 800, sy: 75, ch: 600,
          ot: 0, dpr: 1, hasCustomScroll: false } }];
      }
      if (options.actualFull && source.includes('function manageStickiesFP()')) {
        note('slice.begin', spec.args[0]);
        await callHook('slice', spec.args[0]);
        page.scrollY = spec.args[0];
        note('slice.end', spec.args[0]);
        return [{ result: page.scrollY }];
      }
      if (options.actualFull && source.includes('function loadImg(src)')) {
        note('compose');
        await callHook('compose');
      }
      const cleaning = source.includes('delete window.__shotCaptureControl');
      if (cleaning) { note('cleanup.begin'); await callHook('cleanup'); }
      const result = await vm.runInContext(`(${source})(...__args)`,
        Object.assign(pageContext, { __args: spec.args || [] }));
      if (cleaning) note('cleanup.end');
      return [{ result }];
    } }
  };
  for (const method of ['setPopup', 'setIcon', 'setTitle', 'setBadgeBackgroundColor', 'setBadgeTextColor', 'setBadgeText']) {
    chrome.action[method] = async value => { note(`action.${method}`, value); await callHook(method, value); };
  }
  class OffscreenCanvas {
    constructor(width, height) {
      this.width = width; this.height = height;
      this.draws = [];
      const canvas = this;
      this.context = {
        drawImage(source, ...coordinates) { canvas.draws.push({ source, coordinates }); },
        clearRect() {},
        getImageData(x, y, width, height) {
          const data = new Uint8ClampedArray(width * height * 4);
          // Only the source canvas provides fixture pixels; destination scaling
          // is checked through drawImage geometry, not mocked rasterization.
          if (width === iconFixture.width && height === iconFixture.height) {
            for (let row = iconFixture.y; row < iconFixture.y + iconFixture.h; row++) {
              for (let column = iconFixture.x; column < iconFixture.x + iconFixture.w; column++) {
                data[(row * width + column) * 4 + 3] = iconFixture.alpha;
              }
            }
          }
          return { width, height, data };
        }
      };
      iconCanvases.push(this);
    }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  context = vm.createContext({ chrome, console, OffscreenCanvas,
    async fetch(url) {
      note('icon.fetch', url);
      const response = await callHook('iconFetch', url);
      if (response !== undefined) return response;
      return { ok: true, async blob() { return { type: 'image/png' }; } };
    },
    async createImageBitmap(blob) {
      note('icon.bitmap', blob.type);
      await callHook('iconBitmap', blob);
      return { width: iconFixture.width, height: iconFixture.height,
        close() { note('icon.close'); } };
    },
    multiCatturaTab: null, multiTornaAllEditor: false,
    async pauseCssAnims(tabId) { note('pause', tabId); },
    async resumeCssAnims(tabId) { note('resume', tabId); },
    async sleep(ms) { await callHook('sleep', ms); },
    isPaginaNonIniettabile() { return false; },
    async showBollino(tabId, success) { note('resultBadge', { tabId, success }); },
    async registraCatturaRiuscita(tabId) { note('captureRecorded', tabId); },
    async prepareCaptureBackgrounds() { return false; },
    async copyToClipboard(dataUrl, tabId) { outputs.clipboard.push({ dataUrl, tabId }); note('clipboard'); },
    async multiMostraWidget(tabId) { outputs.widgets.push(tabId); note('widget', tabId); },
    async comprimiInJpeg(dataUrl) { note('compress', dataUrl); await callHook('compress'); return JPEG; }
  });
  class Image {
    constructor() { this.width = 800; this.height = 600; }
    set src(value) { this.value = value; queueMicrotask(() => this.onload()); }
  }
  pageContext = vm.createContext({ window: page, document, chrome, Image,
    setTimeout, clearTimeout,
    requestAnimationFrame(callback) { queueMicrotask(() => { note('page.paint'); callback(0); }); return 1; },
    cancelAnimationFrame() {}
  });
  const multiNames = ['conSessione', 'multiSessione', 'multiAggiornaBadge', 'multiAggiungiPezzo', 'multiAggiungiDaEditor',
    'sendProgress', 'sendSuccess', 'sendError'];
  vm.runInContext('var codaMulti = Promise.resolve();\n' + multiNames.map(productionFunction).join('\n'), context);
  vm.runInContext(controllerSource, context, { filename: 'capture-control.js' });

  // Simulate only expensive page acquisition/composition. Checkpoints, frame
  // validation, output, session binding, locks and restoration are production.
  async function pipeline(tabId, mode) {
    note('pipeline', { tabId, mode });
    await callHook('pipeline', tabId, mode);
    for (let i = 0; i < (mode === 'full' ? 2 : 1); i++) {
      context.checkCaptureCancelled();
      await context.captureFrame(tabId);
    }
    note('compose');
    await callHook('compose');
    const output = await context.saveCapturedImage(options.dataUrl || PNG, tabId, mode);
    if (output.rejected) context.sendError('Piece too large for the session');
  }
  context.doFullCapture = tabId => pipeline(tabId, 'full');
  context.doVisibleCapture = tabId => pipeline(tabId, 'visible');
  context.doAreaCapture = tabId => pipeline(tabId, 'area');
  if (options.actualVisible) vm.runInContext(productionFunction('doVisibleCapture'), context);
  if (options.actualFull) vm.runInContext(
    productionFunction('captureStitchedFrame') + '\n' + productionFunction('doFullCapture'), context);
  if (options.actualRoutes) {
    const messageStart = workerSource.indexOf('chrome.runtime.onMessage.addListener(');
    const messageEnd = workerSource.indexOf('// === SESSIONE MULTI SNIP ===', messageStart);
    assert.ok(messageStart >= 0 && messageEnd > messageStart);
    vm.runInContext('var ultimaFotoLente = 0;\n' + workerSource.slice(messageStart, messageEnd), context);
    const clickStart = workerSource.indexOf('chrome.action.onClicked.addListener(');
    const clickEnd = workerSource.indexOf('// Menu contestuale', clickStart);
    assert.ok(clickStart >= 0 && clickEnd > clickStart, 'Missing action click route');
    vm.runInContext(workerSource.slice(clickStart, clickEnd), context);
  }
  function start(mode = 'full', opts) {
    const response = context.startControlledCapture(10, mode, opts);
    return { response, job: context.activeCaptureJob };
  }
  return { context, page, document, scroller, attrs, listeners, nodeIds, pageNodes, store, outputs, events, hooks, start, iconCanvases, iconFixture,
    ready: context.captureRecovery, note, pageContext,
    dispatch(msg, sender = {}) {
      assert.ok(messageListener, 'Load actualRoutes for runtime dispatch');
      let result;
      messageListener(msg, sender, response => { result = response; });
      return result;
    },
    clickAction() { assert.ok(actionListener); actionListener({ id: 10 }); }
  };
}

function noOutput(e) {
  assert.equal(e.outputs.downloads.length, 0);
  assert.equal(e.outputs.clipboard.length, 0);
}
function restored(e) {
  assert.equal(e.context.captureState().active, false);
  assert.equal(e.page.__shotCaptureControl, undefined);
  assert.equal(e.nodeIds.has('__shot_capture_progress'), false);
  assert.equal(e.listeners.has('keydown'), false);
  assert.equal(e.store.captureJob, undefined);
  assert.ok(e.events.some(event => event.name === 'action.setPopup' && event.value.popup === 'popup.html'));
}

test('synchronous lock rejects a second start; immediate Stop produces no output', async () => {
  const e = environment();
  const first = e.start();
  assert.equal(first.response.started, true);
  assert.equal(e.start('visible').response.started, false);
  assert.equal(e.context.cancelCapture(), true);
  await first.job.done;
  assert.equal(e.outputs.captures.length, 0);
  noOutput(e);
  restored(e);
});

for (const mode of ['full', 'visible']) test(`${mode}: normal completion saves once in the source window`, async () => {
  const e = environment({ actualFull: mode === 'full', actualVisible: mode === 'visible' });
  const { job } = e.start(mode);
  await job.done;
  assert.equal(job.committed, true);
  assert.equal(job.cancelled, false);
  assert.equal(e.outputs.downloads.length, 1);
  assert.equal(e.outputs.clipboard.length, 1);
  assert.equal(e.outputs.captures.length, mode === 'full' ? 2 : 1);
  assert.ok(e.outputs.captures.every(call => call.windowId === 7));
  assert.equal(e.outputs.errors.length, 0);
  restored(e);
});

test('Stop during an in-flight frame waits for it, discards it, then restores', async () => {
  const gate = deferred();
  const e = environment({ hooks: { capture: () => gate.promise } });
  const { job } = e.start();
  await until(() => e.outputs.captures.length === 1, 'capture started');
  assert.equal(e.context.cancelCapture(), true);
  assert.equal(e.context.captureState().active, true);
  assert.equal(e.start().response.active, true);
  assert.equal(e.events.some(event => event.name === 'cleanup.begin'), false);
  gate.resolve();
  await job.done;
  assert.equal(e.outputs.captures.length, 1);
  assert.ok(e.events.findIndex(event => event.name === 'cleanup.begin') >
    e.events.findIndex(event => event.name === 'capture.end'));
  noOutput(e);
  restored(e);
});

test('Stop during composition prevents download and clipboard writes', async () => {
  const gate = deferred();
  const e = environment({ hooks: { compose: () => gate.promise } });
  const { job } = e.start();
  await until(() => e.events.some(event => event.name === 'compose'), 'composition');
  e.context.cancelCapture();
  gate.resolve();
  await job.done;
  noOutput(e);
  assert.equal(e.outputs.errors.length, 0);
  restored(e);
});

test('cleanup restores DOM/scroll before icon restoration and unlock', async () => {
  const captureGate = deferred(), cleanupGate = deferred();
  const e = environment({ hooks: { capture: () => captureGate.promise, cleanup: () => cleanupGate.promise } });
  const { job } = e.start();
  await until(() => e.outputs.captures.length, 'capture');
  const header = { style: { visibility: 'hidden' } };
  e.page.__screenshotHidden = [{ el: header, oldVisibility: 'visible' }];
  e.page.__screenshotBackgrounds = { restore() { delete e.page.__screenshotBackgrounds; } };
  e.page.scrollY = 900;
  e.scroller.scrollTop = 800;
  e.nodeIds.add('__screenshot_area_overlay');
  e.context.cancelCapture();
  captureGate.resolve();
  await until(() => e.events.some(event => event.name === 'cleanup.begin'), 'cleanup');
  assert.equal(e.context.captureState().phase, 'restoring');
  assert.equal(e.start('visible').response.started, false);
  cleanupGate.resolve();
  await job.done;
  assert.equal(header.style.visibility, 'visible');
  assert.equal(e.page.__screenshotBackgrounds, undefined);
  assert.equal(e.nodeIds.has('__screenshot_area_overlay'), false);
  assert.equal(e.attrs.size, 0);
  assert.equal(e.page.scrollY, 75);
  assert.equal(e.scroller.scrollTop, 42);
  const cleanup = e.events.findIndex(event => event.name === 'cleanup.end');
  const resume = e.events.findIndex(event => event.name === 'resume');
  const action = e.events.findLastIndex(event => event.name === 'action.setPopup' && event.value.popup === 'popup.html');
  assert.ok(cleanup < resume && resume < action);
  assert.ok(e.events[action].locked);
  restored(e);
});

test('Escape uses the installed page control and cancels only its own job', async () => {
  const gate = deferred();
  const e = environment({ hooks: { capture: () => gate.promise } });
  const { job } = e.start('area');
  await until(() => e.outputs.captures.length, 'capture');
  assert.equal(e.context.cancelCapture('older-job-id'), false);
  let prevented = 0, stopped = 0;
  e.listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(job.cancelled, true);
  gate.resolve();
  await job.done;
  noOutput(e);
  restored(e);
});

test('changed active tab aborts rather than photographing another tab', async () => {
  const e = environment({ tabActive: false });
  const { job } = e.start('visible');
  await job.done;
  assert.equal(job.cancelled, true);
  assert.equal(e.outputs.captures.length, 0);
  noOutput(e);
  restored(e);
});

test('save boundary: Stop cannot undo a complete image already handed to Chrome', async () => {
  let e, stopResult;
  e = environment({ hooks: { download() { stopResult = e.context.cancelCapture(); } } });
  const { job } = e.start('visible');
  await job.done;
  assert.equal(stopResult, false);
  assert.equal(job.committed, true);
  assert.equal(e.outputs.downloads.length, 1);
  assert.equal(e.outputs.clipboard.length, 1);
  restored(e);
});

test('empty canvas output never reaches downloads or clipboard', async () => {
  const e = environment({ dataUrl: 'data:,' });
  const { job } = e.start();
  await job.done;
  noOutput(e);
  assert.equal(job.failed, true);
  assert.match(e.outputs.errors[0], /too large/i);
  restored(e);
});

test('completed Multi piece uses the real queue/write path, never ordinary output', async () => {
  const original = collection();
  const e = environment({ multi: original, actualVisible: true });
  const { job } = e.start('visible');
  await job.done;
  noOutput(e);
  assert.equal(e.store.multi.pieces.length, 2);
  assert.deepEqual(e.store.multi.pieces[0], original.pieces[0]);
  assert.equal(e.store.multi.pieces[1].id, 6);
  assert.equal(e.store.multi.trash.length, 0);
  assert.deepEqual(e.outputs.widgets, [10]);
  restored(e);
});

test('cancelled Multi piece preserves pieces, trash and counter exactly', async () => {
  const original = collection(), gate = deferred();
  const e = environment({ multi: original, hooks: { compose: () => gate.promise } });
  const { job } = e.start('area');
  await until(() => e.events.some(event => event.name === 'compose'), 'composition');
  e.context.cancelCapture();
  gate.resolve();
  await job.done;
  assert.deepEqual(e.store.multi, original);
  assert.deepEqual(e.outputs.widgets, [10]);
  noOutput(e);
  restored(e);
});

for (const fromEditor of [false, true]) test(`Multi ${fromEditor ? 'editor' : 'widget'} routes source and returns correctly`, async () => {
  const e = environment({ multi: collection(), actualVisible: true });
  const response = await e.context.multiAggiungiDaEditor('visible', fromEditor ? 88 : 23);
  assert.equal(response.started, true);
  const job = e.context.activeCaptureJob;
  await job.done;
  assert.equal(job.tabId, fromEditor ? 10 : 23);
  assert.equal(e.store.multi.sourceTabId, fromEditor ? 10 : 23);
  const activated = e.events.filter(event => event.name === 'tabs.update').map(event => event.value.id);
  assert.deepEqual(activated, fromEditor ? [10, 88] : [23]);
  assert.deepEqual(e.outputs.widgets, fromEditor ? [] : [23]);
  noOutput(e);
  restored(e);
});

for (const replaced of [false, true]) test(`Multi session ${replaced ? 'replaced' : 'removed'} while composing cannot redirect output`, async () => {
  const gate = deferred();
  const e = environment({ multi: collection(), hooks: { compose: () => gate.promise } });
  const { job } = e.start();
  await until(() => e.events.some(event => event.name === 'compose'), 'composition');
  const replacement = { ...collection(), sessionId: 'new-session' };
  if (replaced) e.store.multi = clone(replacement);
  else delete e.store.multi;
  gate.resolve();
  await job.done;
  assert.equal(job.cancelled, true);
  assert.deepEqual(e.store.multi, replaced ? replacement : undefined);
  assert.equal(e.outputs.widgets.length, 0);
  noOutput(e);
  restored(e);
});

test('Multi request with no collection does not fall back to a normal capture', async () => {
  const e = environment();
  await e.context.multiAggiungiDaEditor('full', 23);
  const job = e.context.activeCaptureJob;
  await job.done;
  assert.equal(job.cancelled, true);
  assert.equal(e.outputs.captures.length, 0);
  noOutput(e);
  restored(e);
});

test('Stop while a Multi piece waits for its write queue preserves the collection', async () => {
  const compose = deferred(), queue = deferred();
  const original = collection();
  const e = environment({ multi: original, hooks: { compose: () => compose.promise } });
  const { job } = e.start('visible');
  await until(() => e.events.some(event => event.name === 'compose'), 'composition');
  const blocker = e.context.conSessione(() => queue.promise);
  compose.resolve();
  await new Promise(resolve => setImmediate(resolve));
  e.context.cancelCapture();
  queue.resolve();
  await blocker;
  await job.done;
  assert.deepEqual(e.store.multi, original);
  noOutput(e);
  restored(e);
});

test('quota failure reopens cancellation during JPEG compression without losing trash', async () => {
  const gate = deferred(), original = collection();
  let multiAttempts = 0;
  const e = environment({ multi: original, hooks: {
    setSession(data) { if (data.multi) { multiAttempts++; throw new Error('QUOTA_BYTES'); } },
    compress: () => gate.promise
  } });
  const { job } = e.start('visible');
  await until(() => e.events.some(event => event.name === 'compress'), 'compression retry');
  assert.equal(job.committed, false);
  assert.equal(e.context.cancelCapture(), true);
  gate.resolve();
  await job.done;
  assert.equal(multiAttempts, 1);
  assert.deepEqual(e.store.multi, original);
  noOutput(e);
  restored(e);
});

test('successful quota retry commits just one compressed Multi piece', async () => {
  let attempts = 0;
  const e = environment({ multi: collection(), hooks: {
    setSession(data) { if (data.multi && ++attempts === 1) throw new Error('QUOTA_BYTES'); }
  } });
  const { job } = e.start('visible');
  await job.done;
  assert.equal(attempts, 2);
  assert.equal(job.committed, true);
  assert.equal(e.store.multi.pieces.length, 2);
  assert.equal(e.store.multi.pieces[1].img, JPEG);
  assert.equal(e.store.multi.nextId, 6);
  noOutput(e);
  restored(e);
});

test('two quota failures do not rewrite or mutate the original collection', async () => {
  const original = collection();
  let attempts = 0;
  const e = environment({ multi: original, hooks: {
    setSession(data) { if (data.multi) { attempts++; throw new Error('QUOTA_BYTES'); } }
  } });
  const { job } = e.start('visible');
  await job.done;
  assert.equal(attempts, 2);
  assert.equal(job.committed, false);
  assert.deepEqual(e.store.multi, original);
  assert.equal(e.outputs.errors.length, 1);
  noOutput(e);
  restored(e);
});

for (const fromEditor of [false, true]) test(`Multi early Stop before association restores ${fromEditor ? 'source widget for editor request' : 'clicked widget'}`, async () => {
  const gate = deferred(), original = collection();
  const e = environment({ multi: original, hooks: {
    setIcon(data) { if (data.imageData) return gate.promise; }
  } });
  await e.context.multiAggiungiDaEditor('full', fromEditor ? 88 : 23);
  const job = e.context.activeCaptureJob;
  await until(() => e.events.some(event => event.name === 'action.setIcon' && event.value.imageData), 'Stop icon setup');
  assert.equal(job.fromMulti, false);
  e.context.cancelCapture();
  gate.resolve();
  await job.done;
  assert.deepEqual(e.store.multi, original);
  assert.deepEqual(e.outputs.widgets, [fromEditor ? 10 : 23]);
  assert.equal(e.outputs.captures.length, 0);
  noOutput(e);
  restored(e);
});

test('editor focus restoration finishes before another capture can claim the job', async () => {
  const gate = deferred();
  const e = environment({ multi: collection(), hooks: {
    updateTab(id) { if (id === 88) return gate.promise; }
  } });
  await e.context.multiAggiungiDaEditor('visible', 88);
  const job = e.context.activeCaptureJob;
  await until(() => e.events.some(event => event.name === 'tabs.update' && event.value.id === 88), 'editor focus');
  assert.equal(e.context.captureState().active, true);
  assert.equal(e.start().response.started, false);
  gate.resolve();
  await job.done;
  restored(e);
});

test('actual Visible function aborts an in-flight shot without success or output', async () => {
  const gate = deferred();
  const e = environment({ actualVisible: true, hooks: { capture: () => gate.promise } });
  const { job } = e.start('visible');
  await until(() => e.outputs.captures.length, 'Visible frame');
  e.context.cancelCapture();
  gate.resolve();
  await job.done;
  assert.equal(e.outputs.successes, 0);
  assert.equal(e.outputs.errors.length, 0);
  noOutput(e);
  restored(e);
});

test('actual Full loop does not capture again after Stop during an injected scroll step', async () => {
  const gate = deferred();
  const e = environment({ actualFull: true, hooks: { slice: () => gate.promise } });
  const { job } = e.start('full');
  await until(() => e.events.some(event => event.name === 'slice.begin'), 'Full scroll step');
  e.context.cancelCapture();
  assert.equal(e.events.some(event => event.name === 'cleanup.begin'), false);
  gate.resolve();
  await job.done;
  assert.equal(e.outputs.captures.length, 0);
  assert.equal(e.outputs.successes, 0);
  noOutput(e);
  restored(e);
});

test('actual Full composition result is discarded after Stop', async () => {
  const gate = deferred();
  const e = environment({ actualFull: true, hooks: { compose: () => gate.promise } });
  const { job } = e.start();
  await until(() => e.events.some(event => event.name === 'compose'), 'Full composition');
  assert.equal(e.context.captureState().percent, 92);
  assert.equal(e.events.findLast(event => event.name === 'progress').value.tabId, 10);
  e.context.cancelCapture();
  gate.resolve();
  await job.done;
  assert.equal(e.outputs.successes, 0);
  noOutput(e);
  restored(e);
});

test('actual Full MAX_CAPTURE retry honors Stop before another Chrome capture', async () => {
  const retry = deferred();
  let retrying = false;
  const e = environment({ actualFull: true, hooks: {
    capture() { throw new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND'); },
    sleep(ms) { if (ms === 600) { retrying = true; return retry.promise; } }
  } });
  const { job } = e.start();
  await until(() => retrying, 'capture quota retry');
  e.context.cancelCapture();
  retry.resolve();
  await job.done;
  assert.equal(e.outputs.captures.length, 1);
  assert.equal(e.outputs.errors.length, 0);
  noOutput(e);
  restored(e);
});

test('actual runtime/action routes report active job and reject stale page cancellation', async () => {
  const gate = deferred();
  const e = environment({ actualRoutes: true, actualFull: true, hooks: { capture: () => gate.promise } });
  assert.equal(e.dispatch({ action: 'getCaptureState' }).active, false);
  assert.equal(e.dispatch({ action: 'startCapture', tabId: 10, mode: 'full' }).started, true);
  const job = e.context.activeCaptureJob;
  await until(() => e.outputs.captures.length, 'runtime capture');
  assert.equal(e.dispatch({ action: 'getCaptureState' }).tabId, 10);
  assert.equal(e.dispatch({ action: 'startCapture', tabId: 10, mode: 'full' }).started, false);
  assert.equal(e.dispatch({ action: 'cancelCapture', jobId: job.id }, { tab: { id: 99 } }).cancelled, false);
  assert.equal(e.dispatch({ action: 'cancelCapture', jobId: 'old-job' }, { tab: { id: 10 } }).cancelled, false);
  assert.equal(job.cancelled, false);
  e.clickAction();
  assert.equal(job.cancelled, true);
  gate.resolve();
  await job.done;
  noOutput(e);
  restored(e);
});

for (const multi of [false, true]) for (const mode of ['full', 'area', 'visible']) {
  test(`${multi ? 'Multi' : 'normal'} ${mode}: Full/Area leave Stop unobstructed and cancel on the first click`, async () => {
    const gate = deferred();
    const original = multi ? collection() : undefined;
    const e = environment({ multi: original, actualRoutes: true, hooks: { capture: () => gate.promise } });
    const { response, job } = e.start(mode, multi ? { multi: true, sourceRequestTabId: 10 } : undefined);
    const toolbarStop = mode === 'full' || mode === 'area';
    assert.equal(response.controllable, toolbarStop);
    await until(() => e.outputs.captures.length, `${mode} capture`);
    const state = e.context.captureState();
    assert.equal(state.active, true);
    assert.equal(state.mode, mode);
    assert.equal(state.toolbarStop, toolbarStop);
    assert.equal(e.context.captureHasToolbarStop(), toolbarStop);

    const busy = e.start('full').response;
    assert.equal(busy.started, false);
    assert.equal(busy.active, true);
    assert.equal(busy.mode, mode);
    assert.equal(busy.toolbarStop, toolbarStop);
    assert.equal(e.context.activeCaptureJob, job);

    e.context.sendProgress('Capturing...', 37);
    await job.progressUpdate;
    assert.equal(e.events.some(event => event.name === 'action.setIcon' && event.value.imageData), toolbarStop);
    assert.equal(e.events.some(event => event.name === 'action.setIcon' && event.value.path === 'stop_94.png'), false,
      'The unchanged PNG path is only a fallback when enlarged rendering fails');
    assert.equal(e.events.some(event => event.name === 'icon.fetch' &&
      event.value === 'chrome-extension://test-extension/stop_94.png'), toolbarStop,
      'Render the supplied PNG, not the old generated red square');
    assert.equal(e.events.some(event => event.name === 'action.setPopup' && event.value.popup === ''), toolbarStop);
    assert.equal(e.events.some(event => event.name === 'action.setTitle' && /Stop capture/.test(event.value.title)), toolbarStop);
    assert.equal(e.events.some(event => event.name === 'action.setTitle' && event.value.title === 'Stop capture (Esc) — 37%'), toolbarStop);
    assert.equal(e.events.some(event => event.name === 'action.setBadgeText' && event.value.text), false);
    assert.equal(e.document.title, 'Test page');
    if (toolbarStop) assert.equal(e.page.__shotCaptureControl.progress.percentEl.textContent, '37%');

    e.clickAction();
    assert.equal(job.cancelled, toolbarStop, 'Visible must have no hidden toolbar Stop');
    if (!toolbarStop) {
      assert.equal(e.context.captureState().active, true);
      e.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
      assert.equal(job.cancelled, true, 'Internal cancellation remains available without a toolbar Stop');
    }
    gate.resolve();
    await job.done;
    if (multi) assert.deepEqual(e.store.multi, original);
    assert.equal(e.document.title, 'Test page', 'Stop restores the site title');
    assert.equal(e.events.findLast(event => event.name === 'action.setBadgeText').value.text,
      multi ? String(original.pieces.length) : '', 'Stop restores the previous badge');
    noOutput(e);
    restored(e);
  });
}

for (const mode of ['full', 'area']) for (const fromEditor of [false, true]) {
  test(`actual multiAdd ${mode} from ${fromEditor ? 'editor' : 'widget'} exposes Stop and preserves the collection`, async () => {
    const gate = deferred();
    const e = environment({ multi: collection(), actualRoutes: true, hooks: { compose: () => gate.promise } });
    e.dispatch({ action: 'multiAdd', kind: mode }, { tab: { id: fromEditor ? 88 : 23 } });
    const job = e.context.activeCaptureJob;
    assert.ok(job);
    await until(() => e.events.some(event => event.name === 'compose'), 'Multi composition');
    assert.equal(job.tabId, fromEditor ? 10 : 23);
    assert.equal(e.dispatch({ action: 'getCaptureState' }).toolbarStop, true);
    assert.ok(e.events.some(event => event.name === 'action.setIcon' && event.value.imageData));
    e.clickAction();
    assert.equal(job.cancelled, true);
    gate.resolve();
    await job.done;
    assert.deepEqual(e.store.multi, collection());
    noOutput(e);
    restored(e);
  });
}

test('stale popup job id cannot cancel a later Full capture in the same worker', async () => {
  let gate = deferred();
  const e = environment({ actualRoutes: true, hooks: { capture: () => gate.promise } });
  const first = e.start('full').job;
  await until(() => e.outputs.captures.length === 1, 'first Full capture');
  const oldState = e.dispatch({ action: 'getCaptureState' });
  assert.equal(oldState.jobId, first.id);
  e.context.cancelCapture(first.id);
  gate.resolve();
  await first.done;

  gate = deferred();
  const second = e.start('full').job;
  await until(() => e.outputs.captures.length === 2, 'later Full capture');
  assert.notEqual(second.id, oldState.jobId);
  assert.equal(e.dispatch({ action: 'cancelCapture', jobId: oldState.jobId }).cancelled, false);
  assert.equal(second.cancelled, false);
  assert.equal(e.context.captureState().active, true);
  e.context.cancelCapture(second.id);
  gate.resolve();
  await second.done;
  noOutput(e);
  restored(e);
});

for (const mode of ['full', 'area', 'visible']) for (const origin of ['normal', 'widget', 'editor']) {
  test(`${origin} ${mode}: compact white progress is hidden in every captured frame`, async () => {
    const gate = deferred(), multi = origin !== 'normal';
    const e = environment({ multi: multi ? collection() : undefined, hooks: { pipeline: () => gate.promise } });
    let job;
    if (multi) {
      const response = await e.context.multiAggiungiDaEditor(mode, origin === 'editor' ? 88 : 23);
      assert.equal(response.started, true);
      job = e.context.activeCaptureJob;
    } else job = e.start(mode).job;
    await until(() => e.events.some(event => event.name === 'pipeline'), `${origin} ${mode} preparation`);
    const hasProgress = mode !== 'visible';
    const ui = e.page.__shotCaptureControl.progress;
    assert.equal(!!ui, hasProgress);
    assert.equal(e.nodeIds.has('__shot_capture_progress'), hasProgress);
    if (ui) {
      assert.equal(ui.host.style.getPropertyValue('width'), '124px');
      assert.equal(ui.host.style.getPropertyValue('top'), '16px');
      assert.equal(ui.host.style.getPropertyValue('right'), '16px');
      assert.equal(ui.host.style.getPropertyValue('pointer-events'), 'none');
    }
    e.context.sendProgress('Capturing test frames', 37);
    await job.progressUpdate;
    assert.equal(e.document.title, 'Test page');
    if (ui) assert.equal(ui.percentEl.textContent, '37%');
    gate.resolve();
    await job.done;
    assert.equal(job.committed, true);
    assert.equal(e.document.title, 'Test page', 'Completion restores the site title');
    assert.ok(e.outputs.captureProgress.length);
    for (const snapshot of e.outputs.captureProgress) {
      assert.equal(snapshot.hasProgress, hasProgress);
      if (hasProgress) {
        assert.equal(snapshot.display, 'none');
        assert.ok(snapshot.depth > 0);
      }
      assert.equal(snapshot.hasStopButton, false);
    }
    if (multi) {
      assert.equal(e.store.multi.pieces.length, 2);
      noOutput(e);
    } else assert.equal(e.outputs.downloads.length, 1);
    assert.equal(e.events.findLast(event => event.name === 'action.setBadgeText').value.text,
      multi ? '2' : '', 'Completion restores the collection count or clears the badge');
    const badgeUpdates = e.events.filter(event => event.name === 'action.setBadgeText').length;
    await e.context.updateCaptureProgress(job);
    assert.equal(e.document.title, 'Test page', 'Late updates cannot reapply the title prefix');
    assert.equal(e.events.filter(event => event.name === 'action.setBadgeText').length, badgeUpdates,
      'A late update cannot restore a completed capture percentage');
    restored(e);
  });
}

for (const cancel of [false, true]) for (const changeBeforeCleanup of [false, true]) {
  test(`title preserves live site changes: cancel=${cancel}, last-minute change=${changeBeforeCleanup}`, async () => {
    const gate = deferred();
    const e = environment({ title: 'Match 0–0', hooks: { pipeline: () => gate.promise } });
    const { job } = e.start('full');
    await until(() => e.events.some(event => event.name === 'pipeline'), 'title installed');
    assert.equal(e.document.title, 'Match 0–0');
    e.document.title = 'Match 1–0';
    e.context.sendProgress('Capturing', 42);
    await job.progressUpdate;
    assert.equal(e.document.title, 'Match 1–0');
    if (cancel) {
      e.context.cancelCapture(job.id);
      await job.progressUpdate;
    }
    if (changeBeforeCleanup) e.document.title = 'Match 2–0';
    gate.resolve();
    await job.done;
    assert.equal(e.document.title, changeBeforeCleanup ? 'Match 2–0' : 'Match 1–0');
    restored(e);
  });
}

test('progress leaves an empty site title untouched', async () => {
  const gate = deferred();
  const e = environment({ title: '', hooks: { pipeline: () => gate.promise } });
  const { job } = e.start('area');
  await until(() => e.events.some(event => event.name === 'pipeline'), 'empty title');
  assert.equal(e.document.title, '');
  gate.resolve();
  await job.done;
  assert.equal(e.document.title, '');
});

test('Stop PNG is loaded and rendered once for concurrent and later requests', async () => {
  const gate = deferred();
  const e = environment({ hooks: { iconFetch: () => gate.promise } });
  await e.ready;
  const first = e.context.getStopIconImageData();
  const second = e.context.getStopIconImageData();
  assert.equal(first, second, 'Concurrent requests share the same rendering promise');
  assert.equal(e.events.filter(event => event.name === 'icon.fetch').length, 1);
  gate.resolve();
  const rendered = await first;
  assert.deepEqual(Object.keys(rendered), ['16', '20', '24', '32', '48']);
  assert.equal(await e.context.getStopIconImageData(), rendered);
  assert.equal(e.events.filter(event => event.name === 'icon.fetch').length, 1);
  assert.equal(e.events.filter(event => event.name === 'icon.bitmap').length, 1);
  assert.equal(e.events.filter(event => event.name === 'icon.close').length, 1);
  assert.equal(e.iconCanvases.length, 6, 'One source canvas and five toolbar resolutions');
});

for (const bounds of [
  { x: 9, y: 9, w: 76, h: 76, alpha: 255 },
  { x: 4, y: 12, w: 80, h: 50, alpha: 1 }
]) test(`Stop crop ${bounds.w}×${bounds.h}: preserves every nontransparent edge, proportions and centering`, async () => {
  const e = environment({ iconFixture: bounds });
  await e.ready;
  const rendered = await e.context.getStopIconImageData();
  assert.deepEqual(e.iconCanvases[0].draws[0].coordinates, [0, 0], 'Read the entire original PNG');
  const bitmap = e.iconCanvases[0].draws[0].source;
  for (const canvas of e.iconCanvases.slice(1)) {
    const size = canvas.width;
    assert.equal(canvas.height, size);
    assert.equal(canvas.draws.length, 1);
    assert.equal(canvas.draws[0].source, bitmap, 'Scale the whole sign and lettering together from the original bitmap');
    const [x, y, width, height, dx, dy, dw, dh] = canvas.draws[0].coordinates;
    assert.deepEqual([x, y, width, height], [bounds.x, bounds.y, bounds.w, bounds.h]);
    assert.ok(Math.abs(dw / dh - bounds.w / bounds.h) < 1e-12, 'Never stretch the sign');
    assert.ok(Math.abs(dx + dw / 2 - size / 2) < 1e-12);
    assert.ok(Math.abs(dy + dh / 2 - size / 2) < 1e-12);
    assert.ok(Math.abs(Math.max(dw, dh) - size) < 1e-12, 'Remove transparent padding to use the full icon slot');
    assert.equal(canvas.context.imageSmoothingEnabled, true);
    assert.equal(canvas.context.imageSmoothingQuality, 'high');
    assert.equal(rendered[size].width, size);
    assert.equal(rendered[size].height, size);
  }
});

test('empty icon closes its bitmap and resets the cache so a later request can recover', async () => {
  const e = environment({ iconFixture: { alpha: 0 } });
  await e.ready;
  await assert.rejects(e.context.getStopIconImageData(), /Stop icon is empty/);
  assert.equal(e.context.stopIconImageDataPromise, null);
  assert.equal(e.events.filter(event => event.name === 'icon.close').length, 1);
  e.iconFixture.alpha = 255;
  const rendered = await e.context.getStopIconImageData();
  assert.ok(rendered[16]);
  assert.equal(e.events.filter(event => event.name === 'icon.fetch').length, 2);
  assert.equal(e.events.filter(event => event.name === 'icon.close').length, 2);
});

test('an unsuccessful icon response is rejected before decoding and can be retried', async () => {
  let missing = true;
  const e = environment({ hooks: { iconFetch() { if (missing) return { ok: false }; } } });
  await e.ready;
  await assert.rejects(e.context.getStopIconImageData(), /Unable to load Stop icon/);
  assert.equal(e.context.stopIconImageDataPromise, null);
  assert.equal(e.events.filter(event => event.name === 'icon.bitmap').length, 0);
  missing = false;
  assert.ok((await e.context.getStopIconImageData())[16]);
  assert.equal(e.events.filter(event => event.name === 'icon.fetch').length, 2);
  assert.equal(e.events.filter(event => event.name === 'icon.close').length, 1);
});

for (const mode of ['full', 'area']) for (const multi of [false, true]) {
  test(`${multi ? 'Multi' : 'normal'} ${mode}: rendering failure retains usable PNG Stop and cancellation`, async () => {
    const gate = deferred(), original = multi ? collection() : undefined;
    const e = environment({ multi: original, actualRoutes: true, hooks: {
      iconFetch() { throw new Error('Synthetic icon loading failure'); },
      capture: () => gate.promise
    } });
    const { job } = e.start(mode);
    await until(() => e.outputs.captures.length, 'capture with fallback icon');
    assert.equal(e.context.stopIconImageDataPromise, null);
    assert.ok(e.events.some(event => event.name === 'action.setIcon' && event.value.path === 'stop_94.png'));
    assert.equal(e.events.some(event => event.name === 'action.setIcon' && event.value.imageData), false);
    assert.equal(e.events.some(event => event.name === 'action.setBadgeText' && event.value.text), false);
    assert.equal(e.outputs.errors.length, 0);
    e.clickAction();
    assert.equal(job.cancelled, true);
    gate.resolve();
    await job.done;
    if (multi) assert.deepEqual(e.store.multi, original);
    noOutput(e);
    restored(e);
  });
}

test('Chrome rejection of rendered image data falls back to the PNG without invalidating cached pixels', async () => {
  let rejectImageData = true;
  const e = environment({ hooks: {
    setIcon(data) { if (data.imageData && rejectImageData) throw new Error('Synthetic setIcon rejection'); }
  } });
  await e.ready;
  await e.context.setCaptureAction(false);
  assert.ok(e.events.some(event => event.name === 'action.setIcon' && event.value.path === 'stop_94.png'));
  assert.ok(e.context.stopIconImageDataPromise);
  rejectImageData = false;
  await e.context.setCaptureAction(false);
  assert.equal(e.events.findLast(event => event.name === 'action.setIcon').value.path, undefined);
  assert.ok(e.events.findLast(event => event.name === 'action.setIcon').value.imageData);
  assert.equal(e.events.filter(event => event.name === 'icon.fetch').length, 1);
  assert.equal(e.events.filter(event => event.name === 'icon.close').length, 1);
});

for (const mode of ['full', 'area']) for (const origin of ['normal', 'widget', 'editor']) {
  test.skip(`${origin} ${mode}: obsolete in-page Stop button`, async () => {
    const gate = deferred(), multi = origin !== 'normal', original = multi ? collection() : undefined;
    const e = environment({ multi: original, hooks: { pipeline: () => gate.promise } });
    let job;
    if (multi) {
      await e.context.multiAggiungiDaEditor(mode, origin === 'editor' ? 88 : 23);
      job = e.context.activeCaptureJob;
    } else job = e.start(mode).job;
    await until(() => e.events.some(event => event.name === 'pipeline'), `${origin} ${mode} panel`);
    const control = e.page.__shotCaptureControl, ui = control.progress, button = ui.stopButton;
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, '■ STOP');
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-label'), 'Stop capture');
    assert.equal(button.title, 'Stop capture (Esc)');
    assert.equal(button.isConnected, true);
    assert.equal(ui.host.style.getPropertyValue('pointer-events'), 'none', 'The rest of the progress panel must not block selection');
    let cancelledSelection = 0;
    control.cancelSelection = () => { cancelledSelection++; };
    e.page.scrollY = 700;
    button.click();
    assert.equal(control.cancelled, false, 'Do not cancel page selection before the worker accepts');
    assert.equal(control.stopPending, true);
    assert.equal(job.cancelled, true);
    assert.equal(button.disabled, true, 'Disable synchronously, before a worker update can arrive');
    assert.equal(button.textContent, 'Stopping…');
    assert.equal(ui.labelEl.textContent, 'Stopping…');
    assert.equal(cancelledSelection, 0);
    button.click();
    control.requestStop();
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1);
    await until(() => control.cancelled && !control.stopPending, 'accepted panel cancellation');
    assert.ok(cancelledSelection > 0);
    await job.progressUpdate;
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Stopping…');
    gate.resolve();
    await job.done;
    assert.equal(e.page.scrollY, 75);
    assert.equal(button.isConnected, false);
    assert.equal(e.outputs.captures.length, 0);
    assert.equal(e.outputs.errors.length, 0);
    if (multi) assert.deepEqual(e.store.multi, original);
    noOutput(e);
    restored(e);
  });
}

test.skip('obsolete detached in-page Stop button', async () => {
  let gate = deferred();
  const e = environment({ hooks: { pipeline: () => gate.promise } });
  const first = e.start('full').job;
  await until(() => e.events.filter(event => event.name === 'pipeline').length === 1, 'first Stop button');
  const oldControl = e.page.__shotCaptureControl, oldButton = oldControl.progress.stopButton;
  gate.resolve();
  await first.done;
  assert.equal(first.committed, true);
  assert.equal(oldControl.cancelled, false, 'Exercise stale identity protection, not only the cancelled flag');
  oldControl.committed = false; // Isolate the identity guard from the completed-image guard.
  assert.equal(oldButton.isConnected, false);
  gate = deferred();
  const second = e.start('area').job;
  await until(() => e.events.filter(event => event.name === 'pipeline').length === 2, 'second Stop button');
  oldButton.dispatchEvent({ type: 'click' });
  oldControl.requestStop();
  assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 0);
  assert.equal(second.cancelled, false);
  assert.equal(e.page.__shotCaptureControl.cancelled, false);
  e.page.__shotCaptureControl.progress.stopButton.click();
  gate.resolve();
  await second.done;
  assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1);
  assert.equal(e.outputs.downloads.length, 1, 'Only the already completed first image was saved');
  assert.equal(e.outputs.clipboard.length, 1);
  restored(e);
});

for (const mode of ['full', 'area']) for (const key of [' ', 'Enter']) {
  test.skip(`${mode}: obsolete keyboard focus on in-page Stop button`, async () => {
    const gate = deferred();
    const e = environment({ hooks: { pipeline: () => gate.promise } });
    const { job } = e.start(mode);
    await until(() => e.events.some(event => event.name === 'pipeline'), 'keyboard Stop panel');
    const ui = e.page.__shotCaptureControl.progress;
    let prevented = 0, stopped = 0;
    function keyEvent() { return { key, preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } }; }
    e.listeners.get('keydown')(keyEvent());
    assert.equal(prevented, 0, 'Do not steal the existing Area Space shortcut');
    assert.equal(stopped, 0);
    assert.equal(job.cancelled, false);
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 0);
    ui.stopButton.focus();
    assert.equal(ui.root.activeElement, ui.stopButton);
    e.listeners.get('keydown')(keyEvent());
    assert.equal(prevented, 1, 'Prevent a default Space scroll or extra synthesized click');
    assert.equal(stopped, 1, 'The focused Stop shortcut must not reach Area scrolling');
    assert.equal(job.cancelled, true);
    assert.equal(ui.stopButton.disabled, true);
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1);
    await until(() => e.page.__shotCaptureControl.cancelled, 'accepted keyboard cancellation');
    gate.resolve();
    await job.done;
    noOutput(e);
    restored(e);
  });
}

test.skip('obsolete synchronization with in-page Stop button', async () => {
  const gate = deferred();
  const e = environment({ actualRoutes: true, hooks: { pipeline: () => gate.promise } });
  const { job } = e.start('area');
  await until(() => e.events.some(event => event.name === 'pipeline'), 'Area panel');
  const button = e.page.__shotCaptureControl.progress.stopButton;
  e.clickAction();
  await job.progressUpdate;
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Stopping…');
  button.click();
  assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 0, 'Disabled button emits no duplicate page request');
  gate.resolve();
  await job.done;
  noOutput(e);
  restored(e);
});

for (const mode of ['full', 'area']) {
  test.skip(`${mode}: obsolete local in-page Stop at save boundary`, async () => {
    const saving = deferred();
    let e, localControl, cancelledSelection = 0;
    e = environment({ hooks: {
      download() {
        localControl = e.page.__shotCaptureControl;
        assert.equal(e.context.activeCaptureJob.committed, true);
        assert.notEqual(localControl.committed, true, 'Model a click before the queued Saving UI update');
        localControl.cancelSelection = () => { cancelledSelection++; };
        localControl.progress.stopButton.click();
        assert.equal(localControl.stopPending, true);
        assert.equal(localControl.cancelled, false);
        return saving.promise;
      }
    } });
    const { job } = e.start(mode);
    await until(() => localControl && !localControl.stopPending && localControl.committed, 'rejected Stop and Saving UI');
    const button = localControl.progress.stopButton;
    assert.equal(job.cancelled, false);
    assert.equal(localControl.cancelled, false);
    assert.equal(cancelledSelection, 0);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Saving…');
    assert.deepEqual(e.events.findLast(event => event.name === 'page.cancelResponse').value, { cancelled: false });
    button.dispatchEvent({ type: 'click' });
    e.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1, 'A committed local UI cannot send another Stop');
    saving.resolve();
    await job.done;
    assert.equal(job.cancelled, false);
    assert.equal(e.outputs.downloads.length, 1);
    assert.equal(e.outputs.clipboard.length, 1);
    assert.equal(e.outputs.errors.length, 0);
    restored(e);
  });
}

for (const failure of ['refused', 'connection error']) {
  test.skip(`obsolete local in-page Stop ${failure}`, async () => {
    const pipeline = deferred(), answer = deferred();
    const e = environment({ hooks: { pipeline: () => pipeline.promise, cancelResponse: () => answer.promise } });
    const { job } = e.start('area');
    await until(() => e.events.some(event => event.name === 'pipeline'), 'Area Stop ready');
    const control = e.page.__shotCaptureControl, button = control.progress.stopButton;
    let cancelledSelection = 0;
    control.cancelSelection = () => { cancelledSelection++; };
    button.click();
    assert.equal(control.stopPending, true);
    assert.equal(control.cancelled, false);
    assert.equal(job.cancelled, false);
    assert.equal(cancelledSelection, 0);
    assert.equal(button.disabled, true);
    button.dispatchEvent({ type: 'click' });
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1, 'Pending requests remain idempotent');
    if (failure === 'refused') answer.resolve({ cancelled: false });
    else answer.reject(new Error('Synthetic worker connection error'));
    await until(() => !control.stopPending, 'Stop failure response');
    assert.equal(control.cancelled, false);
    assert.equal(job.cancelled, false);
    assert.equal(cancelledSelection, 0);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, '■ STOP');
    assert.equal(control.progress.labelEl.textContent, 'Select an area');
    delete e.hooks.cancelResponse;
    button.click();
    await until(() => control.cancelled && !control.stopPending, 'accepted retry');
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 2);
    assert.ok(cancelledSelection > 0);
    pipeline.resolve();
    await job.done;
    noOutput(e);
    restored(e);
  });
}

for (const mode of ['full', 'area']) {
  test.skip(`Multi ${mode}: obsolete in-page Stop after quota rollback`, async () => {
    const write = deferred(), compression = deferred(), original = collection();
    let attempts = 0;
    const e = environment({ multi: original, hooks: {
      async setSession(data) {
        if (data.multi) {
          attempts++;
          await write.promise;
          throw new Error('QUOTA_BYTES');
        }
      },
      compress: () => compression.promise
    } });
    const { job } = e.start(mode);
    await until(() => attempts === 1, 'first Multi storage attempt');
    await job.progressUpdate;
    const control = e.page.__shotCaptureControl, button = control.progress.stopButton;
    assert.equal(job.committed, true);
    assert.equal(control.committed, true);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Saving…');
    write.resolve();
    await until(() => e.events.some(event => event.name === 'compress'), 'compression after quota rollback');
    await job.progressUpdate;
    assert.equal(job.committed, false);
    assert.equal(control.committed, false);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, '■ STOP');
    button.click();
    await until(() => control.cancelled && !control.stopPending, 'Stop after quota rollback');
    compression.resolve();
    await job.done;
    assert.equal(attempts, 1);
    assert.deepEqual(e.store.multi, original);
    noOutput(e);
    restored(e);
  });
}

test.skip('obsolete Area drag over in-page Stop', async () => {
  const gate = deferred();
  const e = environment({ hooks: { pipeline: () => gate.promise } });
  const { job } = e.start('area');
  await until(() => e.events.some(event => event.name === 'pipeline'), 'Area drag Stop');
  const control = e.page.__shotCaptureControl, button = control.progress.stopButton;
  button.dispatchEvent({ type: 'mouseup', button: 0 });
  assert.equal(control.stopPending, true);
  button.dispatchEvent({ type: 'click' });
  assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 1, 'Mouseup and following click are one request');
  await until(() => control.cancelled && !control.stopPending, 'accepted drag release Stop');
  gate.resolve();
  await job.done;
  noOutput(e);
  restored(e);
});

for (const scenario of [{ mode: 'full', mouseButton: 0 }, { mode: 'area', mouseButton: 2 }]) {
  test.skip(`${scenario.mode}: obsolete mouseup over in-page Stop`, async () => {
    const gate = deferred();
    const e = environment({ hooks: { pipeline: () => gate.promise } });
    const { job } = e.start(scenario.mode);
    await until(() => e.events.some(event => event.name === 'pipeline'), 'Stop mouseup check');
    const control = e.page.__shotCaptureControl;
    control.progress.stopButton.dispatchEvent({ type: 'mouseup', button: scenario.mouseButton });
    assert.equal(job.cancelled, false);
    assert.equal(e.events.filter(event => event.name === 'page.cancelRequest').length, 0);
    control.progress.stopButton.click();
    await until(() => control.cancelled && !control.stopPending, 'normal Stop click');
    gate.resolve();
    await job.done;
    noOutput(e);
    restored(e);
  });
}
