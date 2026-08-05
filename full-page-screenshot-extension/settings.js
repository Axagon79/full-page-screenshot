// Changelog per versione: solo le voci rivolte all'utente (niente dettagli
// tecnici). Aggiungere una riga qui ad ogni versione con novita' visibili.
var CHANGELOG = {
  '9.8': [
    'Fixed: Full Page and Select Area now work correctly on pages that scroll their whole body (some sports/stats sites).',
    'Fixed: apps with an internal scroll area no longer lose content or repeat the sidebar in Full Page and Select Area captures.'
  ]
};

chrome.storage.local.get('captureMode', function(data) {
  setActive(data.captureMode || 'full');
});

// Mostra "What's new" solo se c'e' una versione non ancora vista con un
// changelog scritto, poi spegne subito il badge NEW sull'icona.
chrome.storage.local.get('newsUnread', function(data) {
  var v = data.newsUnread;
  var voci = v && CHANGELOG[v];
  if (voci && voci.length) {
    document.getElementById('newsVersion').textContent = "What's new in " + v;
    var ul = document.getElementById('newsList');
    voci.forEach(function(riga) {
      var li = document.createElement('li');
      li.textContent = riga;
      ul.appendChild(li);
    });
    document.getElementById('news').classList.add('show');
  }
  chrome.runtime.sendMessage({ action: 'clearNewsBadge' });
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
    // Multi Snip: chiede UNA volta per sempre l'accesso ai siti, così il
    // pannellino di raccolta segue l'utente quando cambia scheda. Se già
    // concesso Chrome non mostra nulla; se rifiutato tutto funziona lo
    // stesso, col click sull'icona scheda per scheda.
    if (mode === 'multi' && chrome.permissions && chrome.permissions.request) {
      chrome.permissions.request({ origins: ['<all_urls>'] }, function() {
        void chrome.runtime.lastError;  // rifiuto: nessun problema
      });
    }
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
