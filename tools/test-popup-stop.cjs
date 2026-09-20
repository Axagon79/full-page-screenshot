'use strict';

// Exercise the actual popup launcher with simulated Chrome callbacks/DOM.
// No rendering or browser permission dialog is simulated here.
// Run: node --test tools/test-popup-stop.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '..', 'full-page-screenshot-extension', 'popup.js'), 'utf8');

function popup(options = {}) {
  const messages = [], pending = [], timers = [], elements = new Map();
  const counts = { closed: 0, storageReads: 0, permissionChecks: 0, permissionRequests: 0 };
  let listener;
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        style: {}, textContent: '', events: {},
        classList: {
          add(name) { classes.add(name); },
          contains(name) { return classes.has(name); },
          toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); }
        },
        addEventListener(type, fn) { this.events[type] = fn; },
        getAttribute() { return id; },
        querySelector() { return element('switch'); }
      });
    }
    return elements.get(id);
  }
  const modes = ['full', 'area', 'visible', 'multi'].map(element);
  const chrome = {
    runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      sendMessage(message, callback) {
        messages.push(structuredClone(message));
        if (message.action === 'getCaptureState') callback(options.state || { active: false });
        else if (callback) pending.push({ action: message.action, callback });
      }
    },
    tabs: { query(_query, callback) { callback([{ id: 10 }]); }, create() {} },
    storage: {
      session: { get(_key, callback) { counts.storageReads++; callback({ multi: { active: !!options.multi } }); } },
      local: {
        get(_keys, callback) { counts.storageReads++; callback({ captureMode: options.mode || 'full', mostraPannello: !!options.panel }); },
        set() {}
      }
    },
    permissions: {
      contains(_permission, callback) { counts.permissionChecks++; callback(options.permission !== false); },
      request(_permission, callback) { counts.permissionRequests++; callback(true); }
    }
  };
  const context = vm.createContext({
    chrome,
    document: { getElementById: element, querySelectorAll() { return modes; }, querySelector() { return element('switch'); }, body: element('body') },
    window: { close() { counts.closed++; } },
    setTimeout(fn, ms) { timers.push({ fn, ms }); }
  });
  vm.runInContext(source, context, { filename: 'popup.js' });
  return { messages, counts, timers, context, elements,
    respond(action, response) {
      const at = pending.findIndex(item => item.action === action);
      assert.ok(at >= 0, `No pending response for ${action}`);
      pending.splice(at, 1)[0].callback(response);
    },
    click(mode) { element(mode).events.click.call(element(mode)); },
    emit(message) { listener(message); }
  };
}

function activeState(mode, jobId = 'capture-123') {
  return { active: true, mode, jobId, toolbarStop: mode === 'full' || mode === 'area', tabId: 10 };
}

for (const multi of [false, true]) for (const mode of ['full', 'area', 'visible']) {
  test(`${multi ? 'Multi' : 'normal'} ${mode}: opening an active popup cancels Full/Area, never Visible`, () => {
    const p = popup({ state: activeState(mode), multi });
    assert.equal(p.counts.storageReads, 0, 'An active job never starts collection/mode initialization');
    assert.equal(p.messages.some(message => message.action === 'startCapture'), false);
    if (mode === 'full' || mode === 'area') {
      assert.deepEqual(p.messages.map(message => message.action), ['getCaptureState', 'cancelCapture']);
      assert.equal(p.messages[1].jobId, 'capture-123');
      assert.equal(p.counts.closed, 0);
      p.respond('cancelCapture', { cancelled: true });
    } else {
      assert.deepEqual(p.messages.map(message => message.action), ['getCaptureState']);
      assert.equal(p.elements.get('text').textContent, '', 'Normal icon has no hidden Stop feedback');
    }
    assert.equal(p.counts.closed, 1);
  });
}

for (const mode of ['full', 'area', 'visible']) {
  test(`start race with active ${mode} follows busy response, not requested mode`, () => {
    const p = popup({ mode: mode === 'full' ? 'area' : 'full' });
    assert.equal(p.messages[1].action, 'startCapture');
    p.respond('startCapture', { started: false, ...activeState(mode, 'racing-job') });
    if (mode === 'full' || mode === 'area') {
      assert.equal(p.messages[2].action, 'cancelCapture');
      assert.equal(p.messages[2].jobId, 'racing-job');
      p.respond('cancelCapture', { cancelled: true });
    } else assert.equal(p.messages.length, 2, 'Busy Visible closes without cancelling');
    assert.equal(p.counts.closed, 1);
  });

  test(`${mode}: accepted start closes the launcher so the next icon click is Stop`, () => {
    const p = popup({ mode });
    assert.equal(p.counts.closed, 0);
    p.context.avviaCattura('full');
    assert.equal(p.messages.filter(message => message.action === 'startCapture').length, 1);
    p.respond('startCapture', { started: true, controllable: mode === 'full' || mode === 'area' });
    assert.equal(p.counts.closed, 1);
    assert.equal(p.messages.some(message => message.action === 'cancelCapture'), false);
  });
}

for (const mode of ['full', 'area']) {
  test(`a stale ${mode} snapshot cancels only that explicit id and never retries without it`, () => {
    const p = popup({ state: activeState(mode, 'old-job') });
    assert.deepEqual(p.messages[1], { action: 'cancelCapture', jobId: 'old-job' });
    p.respond('cancelCapture', { cancelled: false });
    assert.equal(p.counts.closed, 1);
    assert.equal(p.messages.length, 2);
  });

  test(`${mode} state without a job id closes safely instead of cancelling any current job`, () => {
    const state = activeState(mode);
    delete state.jobId;
    const p = popup({ state });
    assert.deepEqual(p.messages.map(message => message.action), ['getCaptureState']);
    assert.equal(p.counts.closed, 1);
  });
}

test('quick panel stays open while idle and launches only the clicked mode', () => {
  const p = popup({ panel: true });
  assert.equal(p.messages.length, 1);
  assert.equal(p.counts.closed, 0);
  p.click('visible');
  assert.equal(p.messages[1].mode, 'visible');
  p.respond('startCapture', { started: true, controllable: false });
  assert.equal(p.counts.closed, 1);
});

test('new Multi launcher preserves the existing optional permission flow', () => {
  const p = popup({ mode: 'multi', permission: false });
  assert.equal(p.messages[1].mode, 'multi');
  assert.equal(p.counts.permissionChecks, 1);
  assert.equal(p.counts.permissionRequests, 1);
  assert.equal(p.counts.closed, 1);
  assert.equal(p.messages.some(message => message.action === 'cancelCapture'), false);
});

test('idle existing Multi collection reopens its widget without cancelling or requesting permissions', () => {
  const p = popup({ multi: true });
  assert.equal(p.messages[1].mode, 'multi');
  assert.equal(p.counts.permissionChecks, 0);
  assert.equal(p.messages.some(message => message.action === 'cancelCapture'), false);
  assert.equal(p.timers[0].ms, 600);
});

test('popup ignores progress from another tab', () => {
  const p = popup();
  p.emit({ type: 'progress', tabId: 99, percent: 77, text: 'Another tab' });
  assert.equal(p.elements.get('pct').textContent, '');
  p.emit({ type: 'progress', tabId: 10, percent: 44, text: 'This tab' });
  assert.equal(p.elements.get('pct').textContent, '44%');
});
