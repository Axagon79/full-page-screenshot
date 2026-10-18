'use strict';

// Production update/message handlers and badge function; Chrome APIs adapted.
// No browser profile, installed extension or Store access.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../full-page-screenshot-extension/sw.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../full-page-screenshot-extension/settings.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function environment(multi = null) {
  const local = { newsUnread: '9.13' }, badges = [];
  let installed, message;
  const context = vm.createContext({ console, activeCaptureJob: null,
    multiSessione: async () => multi,
    chrome: {
      runtime: { onInstalled: { addListener(fn) { installed = fn; } },
        onMessage: { addListener(fn) { message = fn; } } },
      contextMenus: { removeAll(fn) { fn(); }, create() {} },
      storage: { local: { async remove(key) { delete local[key]; } } },
      action: { async setBadgeText(value) { badges.push(value.text); },
        async setBadgeBackgroundColor() {}, async setBadgeTextColor() {} }
    }
  });
  const badgeStart = source.indexOf('async function multiAggiornaBadge(');
  const badgeEnd = source.indexOf('\n}', badgeStart) + 2;
  assert(badgeStart >= 0 && badgeEnd > badgeStart);
  vm.runInContext(source.slice(badgeStart, badgeEnd), context);
  const installStart = source.indexOf('chrome.runtime.onInstalled.addListener(');
  const installEnd = source.indexOf('chrome.contextMenus.onClicked.addListener(', installStart);
  assert(installStart >= 0 && installEnd > installStart);
  vm.runInContext(source.slice(installStart, installEnd), context);
  const messageStart = source.indexOf('chrome.runtime.onMessage.addListener(');
  const messageEnd = source.indexOf('// === SESSIONE MULTI SNIP ===', messageStart);
  assert(messageStart >= 0 && messageEnd > messageStart);
  vm.runInContext(source.slice(messageStart, messageEnd), context);
  return { context, local, badges, installed: details => installed(details),
    legacySettings: () => message({ action: 'clearNewsBadge' }, {}, () => {}) };
}

for (const reason of ['install', 'update']) {
  test(`${reason}: no NEW badge, including a previously unread version`, async () => {
    const e = environment();
    e.installed({ reason, previousVersion: '9.13' });
    await tick();
    assert.deepEqual(e.badges, ['']);
    assert.equal(e.local.newsUnread, undefined);
  });
}

for (const count of [0, 3]) {
  test(`update preserves the active Multi Snip count (${count})`, async () => {
    const e = environment({ active: true, pieces: Array(count).fill({}) });
    e.installed({ reason: 'update' });
    await tick();
    assert.deepEqual(e.badges, [String(count)]);
  });
}

test('startup/closing a collection ignores any old unread marker', async () => {
  const e = environment({ active: false, pieces: [] });
  await e.context.multiAggiornaBadge();
  assert.equal(e.local.newsUnread, '9.13');
  assert.deepEqual(e.badges, ['']);
});

test('an older open Settings tab does not erase the Multi Snip count', async () => {
  const e = environment({ active: true, pieces: [{}, {}] });
  e.legacySettings();
  await tick();
  assert.equal(e.local.newsUnread, undefined);
  assert.deepEqual(e.badges, ['2']);
});

test('update, legacy Settings and badge refresh cannot disturb capture/Stop', async () => {
  const e = environment({ active: true, pieces: [{}, {}] });
  e.context.activeCaptureJob = { mode: 'area', phase: 'capturing' };
  e.installed({ reason: 'update' });
  e.legacySettings();
  await e.context.multiAggiornaBadge();
  await tick();
  assert.deepEqual(e.badges, []);
  assert.equal(e.context.activeCaptureJob.phase, 'capturing');
});

test('Settings keep the release notes without sending an automatic badge message', () => {
  assert(settings.includes('var CHANGELOG = {'));
  assert(settings.includes("'9.14': ["));
  assert(settings.includes("newsBtn.addEventListener('click'"));
  assert(!settings.includes("sendMessage({ action: 'clearNewsBadge' })"));
});
