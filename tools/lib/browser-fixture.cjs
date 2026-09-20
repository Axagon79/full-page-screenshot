'use strict';
// Isolated headless browser for approved local checks. Never uses the user's profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openBrowser(width = 1280, height = 800, options = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-area-sidebar-'));
  if (options.zoom !== undefined) {
    if (!(options.zoom >= 0.25 && options.zoom <= 5)) throw Error('Invalid browser zoom');
    // Chromium's default storage partition has key "x". This is a fresh test
    // profile only, never the user's preferences. Unlike emulated DPR, browser
    // zoom also quantizes scrolling and produces fractional CSS viewport sizes.
    fs.mkdirSync(path.join(profile, 'Default'));
    fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
      partition: { default_zoom_level: { x: Math.log(options.zoom) / Math.log(1.2) } }
    }));
  }
  const child = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--window-size=' + width + ',' + (height + 87), '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]; }
      catch (error) { if (!['ENOENT','EBUSY'].includes(error.code)) throw error; }
      if (/^\d+$/.test(port || '')) break;
      await wait(100);
    }
    if (!/^\d+$/.test(port || '')) throw Error('Browser did not publish its debugging port');
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map();
    socket.onclose = () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        // Browser.close may close the transport before sending its reply.
        if (entry.method === 'Browser.close') entry.resolve({});
        else entry.reject(Error('Browser disconnected during ' + entry.method));
      }
      pending.clear();
    };
    socket.onmessage = event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      message.error ? entry.reject(Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Timed out: ' + method)); }, 25000);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await cdp('Page.enable');
    if (options.zoom === undefined) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    } else {
      // Headless window borders differ across Chromium builds. Calibrate the
      // physical content viewport, leaving genuine browser zoom untouched.
      const png = Buffer.from((await cdp('Page.captureScreenshot', {format:'png'})).data, 'base64');
      const {windowId, bounds} = await cdp('Browser.getWindowForTarget');
      await cdp('Browser.setWindowBounds', {windowId, bounds: {
        width: bounds.width + width - png.readUInt32BE(16),
        height: bounds.height + height - png.readUInt32BE(20)
      }});
    }
    return { cdp, evaluate, profile, async close() {
      try { await cdp('Browser.close'); } finally { socket.close(); child.kill(); }
    } };
  } catch (error) { if (socket) socket.close(); child.kill(); throw error; }
}
module.exports = { openBrowser, wait };
