// Changelog per versione: solo le voci rivolte all'utente (niente dettagli
// tecnici). Aggiungere una riga qui ad ogni versione con novita' visibili.
var CHANGELOG = {
  '9.9': [
    'New: Multi Snip — grab several pieces one after another, even from different tabs, then save them as one stitched image or as separate files.',
    'New: Pixel magnifier — a zoom lens with a pixel grid while you select an area, so you can land on the exact edge.',
    'New: Quick panel — clicking the icon opens the mode panel; turn it off in settings to capture instantly with your saved mode.',
    'Fixed: webmail now captures properly — Gmail, Yahoo and Libero, where the message list scrolls inside its own panel.',
    'Fixed: Select Area is far more precise — no more cut or repeated rows where slices join, and no drift when your selection starts above a scrolling list.'
  ],
  '9.8': [
    'Fixed: Full Page and Select Area now work correctly on pages that scroll their whole body (some sports/stats sites).',
    'Fixed: apps with an internal scroll area no longer lose content or repeat the sidebar in Full Page and Select Area captures.'
  ]
};

chrome.storage.local.get('captureMode', function(data) {
  var m = data.captureMode || 'full';
  setActive(m);
  aggiornaQuickPanel(m);
});

// Versione nell'intestazione: presa dal manifest, così non c'e' un numero
// scritto a mano che resta indietro a ogni pubblicazione.
var badgeVer = document.getElementById('verBadge');
if (badgeVer) badgeVer.textContent = 'v' + chrome.runtime.getManifest().version;

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
    aggiornaQuickPanel(mode);
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

// Interruttore "Pixel magnifier": la lente nella selezione area. Default
// acceso; chi la trova d'intralcio la spegne qui.
chrome.storage.local.get('lentePixel', function(data) {
  var enabled = (data.lentePixel === undefined) ? true : data.lentePixel;
  setLenteActive(enabled);
});
document.getElementById('toggleLente').addEventListener('click', function() {
  var nowActive = !this.classList.contains('on');
  chrome.storage.local.set({ lentePixel: nowActive });
  setLenteActive(nowActive);
});
function setLenteActive(enabled) {
  var el = document.getElementById('toggleLente');
  if (enabled) { el.classList.add('on'); } else { el.classList.remove('on'); }
}

// Interruttore "Quick panel": il click sull'icona apre il pannello delle
// modalità (default) oppure parte subito con la modalità salvata, come una
// volta. Il widget di raccolta Multi Snip non c'entra: resta sempre uguale.
// Lo stato iniziale lo decide aggiornaQuickPanel (che tiene conto anche
// della modalità scelta): qui non serve più leggerlo a parte.
document.getElementById('togglePannello').addEventListener('click', function() {
  // Con Multi Snip l'interruttore è neutralizzato: il click non fa nulla.
  if (document.getElementById('rigaPannello').classList.contains('bloccata')) return;
  var nowActive = !this.classList.contains('on');
  chrome.storage.local.set({ mostraPannello: nowActive });
  setPannelloActive(nowActive);
});
function setPannelloActive(enabled) {
  var el = document.getElementById('togglePannello');
  if (enabled) { el.classList.add('on'); } else { el.classList.remove('on'); }
}

// Multi Snip si porta già il suo pannellino SULLA pagina: tenere acceso
// anche il quick panel significherebbe un click in più a ogni cattura, per
// arrivare comunque allo stesso posto. Quando Multi Snip è la modalità
// scelta l'interruttore si spegne e si blocca; scegliendo un'altra modalità
// torna com'era — la preferenza dell'utente NON viene sovrascritta, resta
// salvata e si riprende da lì.
function aggiornaQuickPanel(mode) {
  var riga = document.getElementById('rigaPannello');
  if (!riga) return;
  var bloccato = (mode === 'multi');
  riga.classList.toggle('bloccata', bloccato);
  if (bloccato) {
    setPannelloActive(false);
    return;
  }
  chrome.storage.local.get('mostraPannello', function(d) {
    setPannelloActive((d.mostraPannello === undefined) ? true : d.mostraPannello);
  });
}

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
