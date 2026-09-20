// One capture job for every entry point, including each Multi Snip piece.
// Cancellation is cooperative: finish the in-flight operation, then restore.
// Never race cleanup against a still-running injected scrolling script.
var activeCaptureJob = null;
var captureSequence = 0;

class CaptureCancelledError extends Error {
  constructor() { super('Capture cancelled'); this.name = 'CaptureCancelledError'; }
}

function checkCaptureCancelled(job = activeCaptureJob) {
  if (job && job.cancelled) throw new CaptureCancelledError();
}

function commitCapture(job) {
  checkCaptureCancelled(job);
  // From this point a COMPLETE image is being saved. Stop cannot undo a
  // download/clipboard write already handed to Chrome.
  setCaptureCommitted(job, true);
}

function setCaptureCommitted(job, committed) {
  if (!job) return;
  job.committed = committed;
  job.progressUpdate = (job.progressUpdate || Promise.resolve()).then(function() {
    return updateCaptureProgress(job);
  }).catch(function() {});
}

function captureHasToolbarStop(job = activeCaptureJob) {
  return !!job && (job.mode === 'full' || job.mode === 'area');
}

function captureState() {
  var job = activeCaptureJob;
  return job ? { active: true, jobId: job.id, tabId: job.tabId, mode: job.mode,
    toolbarStop: captureHasToolbarStop(job),
    phase: job.phase, percent: job.percent, text: job.text } : { active: false };
}

var stopIconImageDataPromise = null;

function getStopIconImageData() {
  if (!stopIconImageDataPromise) {
    stopIconImageDataPromise = (async function() {
      var response = await fetch(chrome.runtime.getURL('stop_94.png'));
      if (!response.ok) throw new Error('Unable to load Stop icon');
      var bitmap = await createImageBitmap(await response.blob());
      try {
        var source = new OffscreenCanvas(bitmap.width, bitmap.height);
        var sourceContext = source.getContext('2d', { willReadFrequently: true });
        sourceContext.drawImage(bitmap, 0, 0);
        var pixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
        var left = bitmap.width, top = bitmap.height, right = -1, bottom = -1;
        for (var y = 0; y < bitmap.height; y++) {
          for (var x = 0; x < bitmap.width; x++) {
            if (pixels[(y * bitmap.width + x) * 4 + 3] === 0) continue;
            left = Math.min(left, x); top = Math.min(top, y);
            right = Math.max(right, x); bottom = Math.max(bottom, y);
          }
        }
        if (right < left) throw new Error('Stop icon is empty');
        var width = right - left + 1, height = bottom - top + 1;
        var icons = {};
        // Remove ONLY fully transparent padding. Scale the whole sign and its
        // lettering together, preserving their proportions at every density.
        [16, 20, 24, 32, 48].forEach(function(size) {
          var canvas = new OffscreenCanvas(size, size);
          var context = canvas.getContext('2d');
          var scale = size / Math.max(width, height);
          var drawWidth = width * scale, drawHeight = height * scale;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(bitmap, left, top, width, height,
            (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
          icons[size] = context.getImageData(0, 0, size, size);
        });
        return icons;
      } finally { bitmap.close(); }
    })().catch(function(error) {
      stopIconImageDataPromise = null;
      throw error;
    });
  }
  return stopIconImageDataPromise;
}

async function setCaptureAction(stopping) {
  // Keep STOP fully visible: progress belongs to the page HUD, not a badge.
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setPopup({ popup: '' });
  try {
    await chrome.action.setIcon({ imageData: await getStopIconImageData() });
  } catch (error) {
    // A rendering failure must not prevent capture or hide its Stop control.
    console.warn('Stop icon rendering:', error);
    await chrome.action.setIcon({ path: 'stop_94.png' });
  }
  await chrome.action.setTitle({ title: stopping ? 'Stopping capture…' : 'Stop capture (Esc)' });
}

async function restoreCaptureAction() {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setIcon({ path: 'icon_128.png' });
  await chrome.action.setTitle({ title: chrome.runtime.getManifest().name });
  await chrome.action.setPopup({ popup: 'popup.html' });
}


function cancelCapture(jobId) {
  var job = activeCaptureJob;
  if (!job || (jobId && job.id !== jobId) || job.committed) return false;
  job.cancelled = true;
  job.phase = 'stopping';
  job.text = 'Stopping capture…';
  if (captureHasToolbarStop(job)) chrome.action.setTitle({ title: job.text }).catch(function() {});
  job.progressUpdate = (job.progressUpdate || Promise.resolve()).then(function() {
    return updateCaptureProgress(job);
  }).catch(function() {});
  if (job.tabId != null) {
    // Stop the Area drag immediately; the main finally owns all restoration.
    chrome.scripting.executeScript({
      target: { tabId: job.tabId },
      func: function(id) {
        var control = window.__shotCaptureControl;
        if (!control || control.id !== id) return;
        control.cancelled = true;
        if (control.cancelSelection) control.cancelSelection();
      }, args: [job.id]
    }).catch(function() {});
  }
  return true;
}

function startControlledCapture(tabId, mode, options) {
  if (activeCaptureJob) return Object.assign({ started: false }, captureState());
  if (!['full', 'visible', 'area'].includes(mode)) return { started: false, active: false };
  var job = { id: Date.now() + '-' + (++captureSequence), tabId: tabId, mode: mode,
    phase: 'starting', percent: 0, text: 'Starting capture…', cancelled: false,
    committed: false, fromMulti: false, options: options || {} };
  activeCaptureJob = job; // Claim BEFORE any await, including widget/editor starts.
  job.done = runControlledCapture(job);
  return { started: true, controllable: captureHasToolbarStop(job) };
}

async function installCaptureControl(job) {
  var result = await chrome.scripting.executeScript({
    target: { tabId: job.tabId },
    func: function(id) {
      var control = { id: id, cancelled: false, x: window.scrollX, y: window.scrollY, scrollers: [] };
      document.querySelectorAll('*').forEach(function(el) {
        if (el !== document.scrollingElement &&
            (el.scrollTop || el.scrollLeft || el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
          control.scrollers.push({ el: el, x: el.scrollLeft, y: el.scrollTop });
        }
      });
      control.requestStop = function() {
        if (window.__shotCaptureControl !== control || control.cancelled || control.stopPending || control.committed) return;
        control.stopPending = true;
        // The worker owns the save boundary. A request arriving after commit
        // must not cancel the page locally or leave a retry permanently stuck.
        return chrome.runtime.sendMessage({ action: 'cancelCapture', jobId: id }).then(function(result) {
          if (window.__shotCaptureControl !== control) return;
          control.stopPending = false;
          if (result && result.cancelled) {
            control.cancelled = true;
            if (control.cancelSelection) control.cancelSelection();
          }
        }).catch(function() {
          if (window.__shotCaptureControl !== control) return;
          control.stopPending = false;
        });
      };
      control.onKey = function(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        control.requestStop();
      };
      window.__shotCaptureControl = control;
      document.addEventListener('keydown', control.onKey, true);
      var widget = document.getElementById('__shot_multi_widget');
      if (widget) widget.remove();
      var oldBadge = document.getElementById('__screenshot_bollino');
      if (oldBadge) oldBadge.remove();
      return true;
    }, args: [job.id]
  });
  job.hasPageControl = !!(result[0] && result[0].result);
}

async function createCaptureProgress(job) {
  if (!job.hasPageControl || !captureHasToolbarStop(job)) return;
  await chrome.scripting.executeScript({
    target: { tabId: job.tabId },
    func: function(id) {
      var control = window.__shotCaptureControl;
      if (!control || control.id !== id || control.cancelled || control.progress) return;
      var host = document.createElement('div');
      host.id = '__shot_capture_progress';
      host.setAttribute('data-screenshot-ui', 'true');
      var css = {
        all: 'initial', position: 'fixed', top: '16px', right: '16px',
        bottom: 'auto', left: 'auto', width: '124px', 'max-width': 'calc(100vw - 32px)',
        height: 'auto', display: 'block', visibility: 'visible', opacity: '1',
        'z-index': '2147483647', 'pointer-events': 'none', margin: '0', padding: '0',
        border: '0', transform: 'none', transition: 'none', animation: 'none',
        isolation: 'isolate', 'color-scheme': 'light'
      };
      Object.keys(css).forEach(function(key) { host.style.setProperty(key, css[key], 'important'); });
      var root = host.attachShadow({ mode: 'closed' });
      var style = document.createElement('style');
      style.textContent = '.panel{box-sizing:border-box;padding:8px 12px;border-radius:10px;' +
        'background:#fff;border:1px solid #cbd1dc;box-shadow:0 4px 20px #0002;' +
        'font:12px/1.4 system-ui,sans-serif;text-align:center;direction:ltr}' +
        '.percent{font-size:24px;font-weight:750;font-variant-numeric:tabular-nums;color:#007d9c;white-space:nowrap}' +
        '.track{height:4px;background:#dfe7ef;border-radius:4px;margin-top:9px;overflow:hidden}' +
        '.bar{height:100%;width:0%;background:#007d9c;border-radius:inherit}';
      var panel = document.createElement('div'); panel.className = 'panel';
      var percent = document.createElement('div'); percent.className = 'percent'; percent.textContent = '0%';
      var track = document.createElement('div'); track.className = 'track';
      var bar = document.createElement('div'); bar.className = 'bar';
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Screenshot progress');
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', '0');
      track.appendChild(bar); panel.appendChild(percent); panel.appendChild(track);
      root.appendChild(style); root.appendChild(panel);
      control.progress = { host: host, root: root, percentEl: percent, bar: bar };
      control.progressSnapshotDepth = 0;
      document.documentElement.appendChild(host);
    }, args: [job.id]
  });
}

// Document navigation is content, not a repeating viewport decoration. Unfold
// only sticky navigation scrollers, before Full measures the page or Area lets
// the user select it. Independent app/feed/dialog scrollers keep their engine.
async function prepareCaptureSidebars(job) {
  if (!job.hasPageControl || !captureHasToolbarStop(job)) return;
  await chrome.scripting.executeScript({
    target: { tabId: job.tabId },
    func: function(id) {
      var control = window.__shotCaptureControl;
      var vh = window.innerHeight;
      if (!control || control.id !== id || control.cancelled || control.sidebars || !(vh > 0)) return;
      var doc = document.scrollingElement;
      if (!doc || doc.scrollHeight - vh < vh * 0.5) return;
      if ([document.documentElement, document.body].some(function(el) {
        return el && /^(hidden|clip)$/.test(getComputedStyle(el).overflowY);
      })) return;
      var appOrModal = Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"], [role="feed"]')).some(function(el) {
        var r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && css.visibility === 'visible' && css.display !== 'none';
      });
      if (appOrModal) return;
      var state = { changes: [], scrolls: [] };
      var savedX = window.scrollX, savedY = window.scrollY;
      state.restore = function() {
        for (var i = state.changes.length - 1; i >= 0; i--) {
          var rec = state.changes[i];
          rec.properties.forEach(function(prop) {
            if (prop.value) rec.el.style.setProperty(prop.name, prop.value, prop.priority);
            else rec.el.style.removeProperty(prop.name);
          });
          if (!rec.hadStyle && !rec.el.style.length) rec.el.removeAttribute('style');
        }
        state.scrolls.forEach(function(rec) {
          if (rec.el.isConnected) rec.el.scrollTo({ left: rec.x, top: rec.y, behavior: 'instant' });
        });
        delete control.sidebars;
      };
      control.sidebars = state; // Cleanup can restore even a partially prepared tree.
      function change(el, values) {
        var rec = state.changes.find(function(item) { return item.el === el; });
        if (!rec) {
          rec = { el: el, hadStyle: el.hasAttribute('style'), properties: [] };
          state.changes.push(rec);
        }
        Object.keys(values).forEach(function(name) {
          if (!rec.properties.some(function(prop) { return prop.name === name; })) {
            rec.properties.push({ name: name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) });
          }
          el.style.setProperty(name, values[name], 'important');
        });
      }
      try {
        // Inspect the top even when capture starts near the footer, where a
        // sticky sidebar can already have been pushed offscreen by its parent.
        window.scrollTo({ top: 0, left: savedX, behavior: 'instant' });
        if (window.scrollY !== 0) return;
        var navigation = 'nav, [role="navigation"], [role="tree"]';
        var candidates = [];
        document.querySelectorAll('*').forEach(function(el) {
          if (el === doc || el === document.body || el === document.documentElement) return;
          var css = getComputedStyle(el);
          if (!/^(auto|scroll)$/.test(css.overflowY) || el.scrollHeight <= el.clientHeight + 2) return;
          if (!(el.matches(navigation) || el.querySelector(navigation) || el.closest(navigation))) return;
          if (el.closest('dialog, [role="dialog"], [aria-modal="true"], [role="feed"], .vue-recycle-scroller')) return;
          var root = null, path = [], node = el;
          while (node && node !== document.body && node !== document.documentElement) {
            var style = getComputedStyle(node);
            if (style.position === 'fixed') return;
            if (node !== el && /^(auto|scroll)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2) return;
            path.push(node);
            if (style.position === 'sticky') { root = node; break; }
            node = node.parentElement;
          }
          if (!root) return;
          // An app shell or a feed containing navigation is not a sidebar.
          if (root.querySelector('main, article, [role="main"], [role="feed"], textarea, [contenteditable="true"], video')) return;
          for (node = root.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
            var ancestorCss = getComputedStyle(node);
            if (ancestorCss.position === 'fixed' || (/^(auto|scroll)$/.test(ancestorCss.overflowY) && node.scrollHeight > node.clientHeight + 2)) return;
          }
          var r = root.getBoundingClientRect();
          if (r.width < 80 || r.width > innerWidth * 0.45 || r.height < vh * 0.4 ||
              r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= innerWidth ||
              css.visibility !== 'visible' || css.display === 'none') return;
          candidates.push({ el: el, root: root, path: path });
        });
        candidates.forEach(function(candidate) {
          state.scrolls.push({ el: candidate.el, x: candidate.el.scrollLeft, y: candidate.el.scrollTop });
          candidate.path.forEach(function(el) {
            var values = { height: 'auto', 'max-height': 'none', 'block-size': 'auto', 'max-block-size': 'none',
              'overflow-x': 'visible', 'overflow-y': 'visible' };
            if (el === candidate.root) {
              Object.assign(values, { position: 'relative', top: 'auto', bottom: 'auto',
                'inset-block-start': 'auto', 'inset-block-end': 'auto', 'align-self': 'start' });
            }
            change(el, values);
          });
          candidate.el.scrollTo({ top: 0, left: candidate.el.scrollLeft, behavior: 'instant' });
        });
      } catch (error) {
        state.restore();
        throw error;
      } finally {
        window.scrollTo({ top: savedY, left: savedX, behavior: 'instant' });
        if (!state.changes.length && control.sidebars === state) delete control.sidebars;
      }
    }, args: [job.id]
  });
}

// Updates never change visibility: only the screenshot gate may hide/show HUD.
async function updateCaptureProgress(job) {
  if (!job || job !== activeCaptureJob || !captureHasToolbarStop(job) || job.phase === 'restoring') return;
  var percent = Math.min(100, Math.max(0, Math.round(Number(job.percent) || 0)));
  await chrome.action.setTitle({ title: job.cancelled ? 'Stopping capture…' :
    job.committed ? 'Saving capture…' : 'Stop capture (Esc) — ' + percent + '%' });
  // Keep Escape's local save boundary synchronized too.
  if (!job.hasPageControl) return;
  await chrome.scripting.executeScript({
    target: { tabId: job.tabId },
    func: function(id, stopping, saving, percent) {
      var control = window.__shotCaptureControl;
      if (!control || control.id !== id) return;
      if (stopping) control.cancelled = true;
      control.committed = !!saving;
      if (!control.progress) return;
      control.progress.percentEl.textContent = percent + '%';
      control.progress.bar.style.width = percent + '%';
      control.progress.bar.setAttribute('aria-valuenow', String(percent));
    }, args: [job.id, job.cancelled, job.committed, percent]
  });
}

async function setCaptureProgressSnapshot(tabId, jobId, hidden) {
  if (!jobId) return;
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(id, hide) {
      var control = window.__shotCaptureControl;
      if (!control || control.id !== id || !control.progress) return;
      control.progressSnapshotDepth = Math.max(0, (control.progressSnapshotDepth || 0) + (hide ? 1 : -1));
      control.progress.host.style.setProperty('display', control.progressSnapshotDepth ? 'none' : 'block', 'important');
      if (!hide) return;
      return new Promise(function(resolve) {
        var frame, timeout;
        function done() { cancelAnimationFrame(frame); clearTimeout(timeout); resolve(); }
        timeout = setTimeout(done, 250);
        frame = requestAnimationFrame(function() { frame = requestAnimationFrame(done); });
      });
    }, args: [jobId, hidden]
  });
}

async function cleanupCaptureJob(job, restoreScroll) {
  if (!job.hasPageControl || job.tabId == null) return;
  try {
    var cleaned = await chrome.scripting.executeScript({
      target: { tabId: job.tabId },
      func: function(id, resetScroll) {
        var control = window.__shotCaptureControl;
        // Do not touch a new document after navigation.
        if (!control || control.id !== id) return false;
        if (control.titleProgress && document.title === control.titleProgress.displayedTitle) {
          document.title = control.titleProgress.siteTitle;
        }
        if (control.progress) control.progress.host.remove();
        if (control.cancelSelection) control.cancelSelection();
        document.removeEventListener('keydown', control.onKey, true);
        if (window.__screenshotBackgrounds) window.__screenshotBackgrounds.restore();
        (window.__screenshotCaptureMasks || []).forEach(function(rec) {
          if (rec.opacity) rec.el.style.setProperty('opacity', rec.opacity, rec.opacityPriority);
          else rec.el.style.removeProperty('opacity');
        });
        ['__screenshotHidden', '__screenshotStickies', '__screenshotMultiFixed'].forEach(function(key) {
          (window[key] || []).forEach(function(rec) {
            rec.el.style.visibility = rec.oldVisibility !== undefined ? rec.oldVisibility : rec.oldVis;
            if (rec.tallSticky) {
              rec.el.style.setProperty('position', rec.oldPosition, rec.oldPositionPriority);
              rec.el.style.setProperty('top', rec.oldTop, rec.oldTopPriority);
              rec.el.style.setProperty('bottom', rec.oldBottom, rec.oldBottomPriority);
              rec.el.style.setProperty('inset-block-start', rec.oldInsetBlockStart, rec.oldInsetBlockStartPriority);
              rec.el.style.setProperty('inset-block-end', rec.oldInsetBlockEnd, rec.oldInsetBlockEndPriority);
              rec.el.style.setProperty('height', rec.oldHeight, rec.oldHeightPriority);
              rec.el.style.setProperty('max-height', rec.oldMaxHeight, rec.oldMaxHeightPriority);
            }
          });
          delete window[key];
        });
        if (control.sidebars) control.sidebars.restore();
        delete window.__screenshotCaptureMasks;
        delete window.__screenshotArea;
        delete window.__screenshotAreaPanes;
        ['__screenshot_area_overlay', '__screenshot_noselect', '__screenshot_area_scrollbars'].forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.remove();
        });
        ['data-screenshot-scroll', 'data-screenshot-pane', 'data-screenshot-area-scroll',
          'data-screenshot-area-pane', 'data-screenshot-area-scrollbar', 'data-screenshot-start-sticky'].forEach(function(attr) {
          document.querySelectorAll('[' + attr + ']').forEach(function(el) { el.removeAttribute(attr); });
        });
        if (resetScroll) {
          control.scrollers.forEach(function(rec) {
            if (rec.el.isConnected) rec.el.scrollTo({ left: rec.x, top: rec.y, behavior: 'instant' });
          });
          window.scrollTo({ left: control.x, top: control.y, behavior: 'instant' });
        }
        delete window.__shotCaptureControl;
        return true;
      }, args: [job.id, restoreScroll]
    });
    if (cleaned[0] && cleaned[0].result) await resumeCssAnims(job.tabId);
  } catch (closedOrNavigated) {}
}


// A suspended/restarted worker must not leave a stale red action or page state.
var captureRecovery = Promise.resolve().then(async function() {
  var saved = await chrome.storage.session.get('captureJob');
  if (saved.captureJob) await cleanupCaptureJob(saved.captureJob, true);
  await restoreCaptureAction();
  await chrome.storage.session.remove('captureJob');
  if (!activeCaptureJob) await multiAggiornaBadge();
}).catch(function(error) { console.warn('Capture recovery:', error); });

async function runControlledCapture(job) {
  try {
    await captureRecovery;
    checkCaptureCancelled(job);
    // Full Page and Area expose Stop, including inside Multi Snip. Visible
    // keeps the ordinary icon; internal cancellation and the job lock apply.
    if (captureHasToolbarStop(job)) await setCaptureAction(false);
    var session = await conSessione(async function() {
      var m = await multiSessione();
      checkCaptureCancelled(job);
      if (m && m.active && !m.sessionId) {
        m.sessionId = job.id;
        await chrome.storage.session.set({ multi: m });
      }
      return m;
    });
    checkCaptureCancelled(job);
    if (job.options.multi && (!session || !session.active)) throw new CaptureCancelledError();
    if (session && session.active) {
      job.fromMulti = true;
      job.multiSessionId = session.sessionId;
      job.editorTabId = session.editorTabId;
      if (job.options.multi) {
        var source = job.options.sourceRequestTabId;
        job.returnToEditor = source != null && source === session.editorTabId;
        job.tabId = source != null && !job.returnToEditor ? source : session.sourceTabId;
      }
      multiCatturaTab = job.tabId;
    }
    var tab = await chrome.tabs.get(job.tabId);
    job.windowId = tab.windowId;
    checkCaptureCancelled(job);
    if (job.options.multi) {
      await chrome.tabs.update(job.tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    job.phase = 'capturing';
    // Persist before changing the page, so recovery can find its control id.
    await chrome.storage.session.set({ captureJob: { id: job.id, tabId: job.tabId, hasPageControl: true } });
    checkCaptureCancelled(job);
    try { await installCaptureControl(job); }
    catch (notInjectable) { if (!isPaginaNonIniettabile(notInjectable)) throw notInjectable; }
    checkCaptureCancelled(job);
    await createCaptureProgress(job);
    await updateCaptureProgress(job);
    await pauseCssAnims(job.tabId);
    checkCaptureCancelled(job);
    await prepareCaptureSidebars(job);
    checkCaptureCancelled(job);
    await sleep(150); // The launch popup/widget must disappear before the shot.
    if (job.mode === 'full') await doFullCapture(job.tabId);
    else if (job.mode === 'area') await doAreaCapture(job.tabId);
    else await doVisibleCapture(job.tabId);
  } catch (error) {
    if (error.name === 'CaptureCancelledError' || job.cancelled) job.cancelled = true;
    else { job.failed = true; sendError(error.message); }
  } finally {
    job.phase = 'restoring';
    // Drain pending progress updates before removing the HUD and restoring the icon.
    // Late updates must not resurrect a completed capture's percentage.
    if (job.progressUpdate) await job.progressUpdate;
    await cleanupCaptureJob(job, job.cancelled || job.failed || !job.committed);
    // Keep the job locked until all in-flight work and restoration are done.
    try { await restoreCaptureAction(); } catch (error) { console.warn(error); }
    try { await chrome.storage.session.remove('captureJob'); } catch (error) { console.warn(error); }
    var widgetTab = null;
    try {
      // The launcher is closed during capture: failures must still be visible.
      if (job.failed && !job.cancelled && job.tabId != null) {
        try { await showBollino(job.tabId, false, job.errorMessage || 'Unable to complete capture'); }
        catch (notInjectable) {}
      }
      if (job.fromMulti || job.options.multi) {
        var m = await multiSessione();
        if (m && m.active && (!job.multiSessionId || m.sessionId === job.multiSessionId)) {
          if (job.returnToEditor && m.editorTabId != null) {
            // Still locked: an old job must never change tabs under a new one.
            try { await chrome.tabs.update(m.editorTabId, { active: true }); } catch (closedEditor) {}
          } else {
            var requestedTab = job.options.sourceRequestTabId;
            widgetTab = job.tabId != null ? job.tabId :
              (requestedTab != null && requestedTab !== m.editorTabId ? requestedTab : m.sourceTabId);
          }
        }
      }
    } catch (sessionUnavailable) { console.warn(sessionUnavailable); }
    if (activeCaptureJob === job) activeCaptureJob = null;
    multiCatturaTab = null;
    multiTornaAllEditor = false;
    try {
      await multiAggiornaBadge();
      if (widgetTab != null) await multiMostraWidget(widgetTab);
    } catch (uiUnavailable) { console.warn(uiUnavailable); }
  }
}

async function captureFrame(tabId) {
  var job = activeCaptureJob;
  checkCaptureCancelled(job);
  var tab = await chrome.tabs.get(tabId);
  checkCaptureCancelled(job);
  if (!tab.active || (job && job.windowId !== undefined && tab.windowId !== job.windowId)) {
    if (job) job.cancelled = true;
    throw new CaptureCancelledError();
  }
  var progressJobId = job && job.hasPageControl && captureHasToolbarStop(job) ? job.id : null;
  var snapshotRequested = false;
  try {
    if (job && job.progressUpdate) await job.progressUpdate;
    checkCaptureCancelled(job);
    if (progressJobId) {
      snapshotRequested = true;
      await setCaptureProgressSnapshot(tabId, progressJobId, true);
    }
    checkCaptureCancelled(job);
    var image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    checkCaptureCancelled(job);
    return image;
  } finally {
    if (snapshotRequested) {
      try { await setCaptureProgressSnapshot(tabId, progressJobId, false); } catch (closedTab) {}
    }
  }
}

async function saveCapturedImage(dataUrl, tabId, kind) {
  var job = activeCaptureJob;
  checkCaptureCancelled(job);
  // Do not hand an empty canvas result (data:,) to downloads or Multi Snip.
  if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,.+/.test(dataUrl)) {
    throw new Error('Image too large to save. Please capture a shorter section.');
  }
  var m = await multiSessione();
  checkCaptureCancelled(job);
  if (job ? job.fromMulti : (m && m.active)) {
    if (!m || !m.active || (job && m.sessionId !== job.multiSessionId)) throw new CaptureCancelledError();
    var accepted = await multiAggiungiPezzo(dataUrl, tabId, kind, job);
    return { multi: true, rejected: accepted === false };
  }
  commitCapture(job);
  var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({ url: dataUrl, filename: 'screenshots/screenshot_' + ts + '.png', saveAs: false });
  await copyToClipboard(dataUrl, tabId);
  return { multi: false, rejected: false };
}
