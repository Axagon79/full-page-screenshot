// One temporary end marker per document. It lives in the extension's isolated
// world, so the capture controller can read it without exposing page globals.
(function() {
  var old = window.__shotEndLine;
  if (old && typeof old.restart === 'function') { old.restart(); return; }

  var host = document.createElement('div');
  host.id = '__shot_end_line';
  host.setAttribute('data-screenshot-ui', 'true');
  var hostStyle = {
    all: 'initial', position: 'fixed', inset: '0', width: '100vw', height: '100vh',
    margin: '0', padding: '0', border: '0', display: 'block', visibility: 'visible',
    opacity: '1', 'pointer-events': 'none', 'z-index': '2147483646',
    transform: 'none', transition: 'none', animation: 'none',
    isolation: 'isolate', 'color-scheme': 'light'
  };
  Object.keys(hostStyle).forEach(function(key) {
    host.style.setProperty(key, hostStyle[key], 'important');
  });
  var root = host.attachShadow({ mode: 'closed' });
  var style = document.createElement('style');
  style.textContent =
    '*{box-sizing:border-box} .line{position:absolute;left:0;width:100%;height:18px;' +
    'cursor:ns-resize;pointer-events:auto;touch-action:none}' +
    '.line::after{content:"";position:absolute;top:8px;left:0;width:100%;height:2px;' +
    'background:#087bdb;box-shadow:0 0 0 1px #fff,0 2px 8px #0005}' +
    '.line.placing{pointer-events:none;cursor:default}' +
    '.card{position:absolute;right:12px;display:flex;align-items:center;gap:7px;' +
    'padding:5px 7px;border:1px solid #b7c7dc;border-radius:8px;background:#fff;' +
    'box-shadow:0 3px 12px #0003;color:#18283c;font:12px/1.3 system-ui,sans-serif;' +
    'direction:ltr;pointer-events:auto;max-width:calc(100vw - 24px)}' +
    '.card.placing{pointer-events:none}' +
    'button{appearance:none;border:0;border-radius:5px;padding:5px 8px;' +
    'font:600 12px/1.3 system-ui,sans-serif;cursor:pointer;white-space:nowrap}' +
    '.capture{background:#087bdb;color:#fff}.remove{background:#edf2f8;color:#25364c}' +
    'button:focus-visible{outline:2px solid #087bdb;outline-offset:2px}' +
    '@media(max-width:390px){.card{right:6px;gap:4px;padding:4px}' +
    'button{padding:5px 6px;font-size:11px}}';
  root.appendChild(style);
  var line = document.createElement('div');
  line.className = 'line placing';
  line.setAttribute('role', 'separator');
  line.setAttribute('aria-label', 'End of screenshot; drag to adjust');
  var card = document.createElement('div');
  card.className = 'card placing';
  var hint = document.createElement('span');
  hint.textContent = 'Click to set end · Esc to cancel';
  var captureButton = document.createElement('button');
  captureButton.className = 'capture';
  captureButton.textContent = 'Capture to here';
  captureButton.title = 'Capture from the top to this line';
  var removeButton = document.createElement('button');
  removeButton.className = 'remove';
  removeButton.textContent = '×';
  removeButton.title = 'Remove end line';
  removeButton.setAttribute('aria-label', 'Remove end line');
  card.appendChild(hint);
  card.appendChild(captureButton);
  card.appendChild(removeButton);
  root.appendChild(line);
  root.appendChild(card);
  (document.documentElement || document.body).appendChild(host);

  var state = {
    placed: false, paused: false, removed: false, hasPointer: false, y: scrollY + innerHeight / 2,
    anchor: null, anchorOffset: 0, lastClientY: innerHeight / 2,
    getY: function() {
      if (this.anchor && this.anchor.isConnected) {
        var top = this.anchor.getBoundingClientRect().top + scrollY;
        return clamp(top + this.anchorOffset);
      }
      return clamp(this.y);
    },
    pause: function() {
      this.paused = true;
      host.style.setProperty('display', 'none', 'important');
    },
    resume: function() {
      if (this.removed) return;
      this.paused = false;
      captureButton.disabled = false;
      host.style.setProperty('display', 'block', 'important');
      draw();
    },
    restart: function() {
      if (this.removed || this.paused) return;
      this.placed = false;
      this.hasPointer = false;
      this.anchor = null;
      this.y = scrollY + this.lastClientY;
      card.classList.add('placing');
      line.classList.add('placing');
      hint.textContent = 'Click to set end · Esc to cancel';
      captureButton.hidden = true;
      removeButton.hidden = true;
      chrome.runtime.sendMessage({ action: 'endLineDisarmed' }).catch(function() {});
      draw();
    },
    remove: function() {
      if (this.removed) return;
      this.removed = true;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onPlace, true);
      document.removeEventListener('pointermove', onDragMove, true);
      document.removeEventListener('pointerup', onDragEnd, true);
      document.removeEventListener('pointercancel', onDragCancel, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', draw, true);
      window.removeEventListener('resize', draw, true);
      if (layoutObserver) layoutObserver.disconnect();
      host.remove();
      if (window.__shotEndLine === this) delete window.__shotEndLine;
      chrome.runtime.sendMessage({ action: 'endLineDisarmed' }).catch(function() {});
    }
  };
  window.__shotEndLine = state;
  captureButton.hidden = true;
  removeButton.hidden = true;

  function clamp(y) {
    var fullHeight = Math.max(document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0, innerHeight);
    return Math.max(1, Math.min(fullHeight, y));
  }

  function draw() {
    if (state.removed || state.paused) return;
    var screenY = (state.placed ? state.getY() : clamp(state.y)) - scrollY;
    var visible = (state.placed || state.hasPointer) && screenY >= 0 && screenY <= innerHeight;
    line.style.display = visible ? 'block' : 'none';
    card.style.display = visible || (!state.placed && !state.hasPointer) ? 'flex' : 'none';
    if (!state.placed && !state.hasPointer) {
      card.style.top = '12px';
      return;
    }
    if (!visible) return;
    line.style.top = (screenY - 9) + 'px';
    card.style.top = Math.max(6, Math.min(innerHeight - 45, screenY + 15)) + 'px';
  }

  function anchorAt(clientX, clientY) {
    // Look through our overlay, then tie the line to content that moves when
    // late-loading elements are inserted above it. Fall back to document Y.
    host.style.setProperty('visibility', 'hidden', 'important');
    var el = document.elementFromPoint(clientX, clientY);
    host.style.setProperty('visibility', 'visible', 'important');
    if (!el || el === document.body || el === document.documentElement) return;
    // A child of a sticky/fixed rail moves with the viewport, not with the
    // document. Keep the absolute coordinate instead of following that rail.
    for (var ancestor = el; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      var pos = getComputedStyle(ancestor).position;
      if (pos === 'fixed' || pos === 'sticky') return;
    }
    state.anchor = el;
    state.anchorOffset = state.y - (el.getBoundingClientRect().top + scrollY);
  }

  function onMove(event) {
    if (state.paused || state.placed || state.removed) return;
    state.hasPointer = true;
    state.lastClientY = event.clientY;
    state.y = clamp(scrollY + event.clientY);
    state.hasPointer = true;
    draw();
  }

  function onPlace(event) {
    if (state.paused || state.placed || state.removed || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.y = clamp(scrollY + event.clientY);
    state.placed = true;
    anchorAt(event.clientX, event.clientY);
    line.classList.remove('placing');
    card.classList.remove('placing');
    hint.textContent = 'End of Full Page';
    captureButton.hidden = false;
    removeButton.hidden = false;
    draw();
    // Avoid forwarding the placement click to the website.
    function swallow(click) {
      click.preventDefault();
      click.stopImmediatePropagation();
      document.removeEventListener('click', swallow, true);
    }
    document.addEventListener('click', swallow, true);
    setTimeout(function() { document.removeEventListener('click', swallow, true); }, 700);
    chrome.runtime.sendMessage({ action: 'endLineArmed' }).then(function(reply) {
      if ((!reply || !reply.armed) && !state.removed) state.remove();
    }).catch(function() { if (!state.removed) state.remove(); });
  }

  function onKey(event) {
    if (state.paused || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.remove();
  }

  var dragging = false;
  line.addEventListener('pointerdown', function(event) {
    if (!state.placed || state.paused || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    line.setPointerCapture(event.pointerId);
    state.anchor = null;
  });
  function onDragMove(event) {
    if (!dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.y = clamp(scrollY + event.clientY);
    draw();
  }
  function onDragEnd(event) {
    if (!dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dragging = false;
    state.y = clamp(scrollY + event.clientY);
    anchorAt(event.clientX, event.clientY);
    draw();
  }
  function onDragCancel() { dragging = false; }
  captureButton.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!state.placed || state.paused) return;
    captureButton.disabled = true;
    chrome.runtime.sendMessage({ action: 'startCaptureToLine' }).then(function(reply) {
      if (!state.removed && (!reply || !reply.started)) captureButton.disabled = false;
    }).catch(function() { if (!state.removed) captureButton.disabled = false; });
  });
  removeButton.addEventListener('click', function(event) {
    event.preventDefault();
    event.stopPropagation();
    state.remove();
  });
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerdown', onPlace, true);
  document.addEventListener('pointermove', onDragMove, true);
  document.addEventListener('pointerup', onDragEnd, true);
  document.addEventListener('pointercancel', onDragCancel, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', draw, true);
  window.addEventListener('resize', draw, true);
  var layoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  if (layoutObserver) {
    layoutObserver.observe(document.documentElement);
    if (document.body) layoutObserver.observe(document.body);
  }
  draw();
})();
