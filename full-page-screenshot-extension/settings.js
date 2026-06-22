chrome.storage.local.get('captureMode', function(data) {
  setActive(data.captureMode || 'full');
});

// Interruttore "Copia negli appunti": stesso schema di captureMode ma e' un
// on/off, non una scelta radio. Default acceso (true) come da specifica.
chrome.storage.local.get('copyToClipboard', function(data) {
  var enabled = (data.copyToClipboard === undefined) ? true : data.copyToClipboard;
  setClipboardActive(enabled);
});

// Le opzioni-modalita' (data-mode) sono un gruppo radio: una sola attiva.
document.querySelectorAll('.option[data-mode]').forEach(function(opt) {
  opt.addEventListener('click', function() {
    var mode = this.getAttribute('data-mode');
    chrome.storage.local.set({ captureMode: mode });
    setActive(mode);
  });
});

// L'interruttore appunti: click = inverti acceso/spento, salva subito.
document.getElementById('toggleClipboard').addEventListener('click', function() {
  var nowActive = !this.classList.contains('on');
  chrome.storage.local.set({ copyToClipboard: nowActive });
  setClipboardActive(nowActive);
});

document.getElementById('btnSave').addEventListener('click', function() {
  var saved = document.getElementById('saved');
  saved.classList.add('show');
  setTimeout(function() { saved.classList.remove('show'); }, 2000);
});

function setActive(mode) {
  // Solo le opzioni con data-mode: il toggle appunti resta fuori da questo loop.
  document.querySelectorAll('.option[data-mode]').forEach(function(opt) {
    if (opt.getAttribute('data-mode') === mode) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });
}

function setClipboardActive(enabled) {
  var el = document.getElementById('toggleClipboard');
  if (enabled) { el.classList.add('on'); } else { el.classList.remove('on'); }
}
