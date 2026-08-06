var water = document.getElementById('water');
var pct = document.getElementById('pct');
var text = document.getElementById('text');
var waterbody = document.getElementById('waterbody');

// Ascolta aggiornamenti dal service worker (progresso cattura full page)
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type === 'progress') {
    water.style.height = Math.min(msg.percent, 100) + '%';
    pct.textContent = Math.round(msg.percent) + '%';
    text.textContent = msg.text;
    if (msg.percent > 50) {
      pct.style.color = 'white';
      pct.style.textShadow = '0 1px 3px rgba(0,0,0,0.3)';
    } else {
      pct.style.color = '#1e3a5f';
      pct.style.textShadow = '0 1px 2px rgba(255,255,255,0.5)';
    }
  } else if (msg.type === 'success') {
    pct.textContent = '✓';
    text.textContent = 'Screenshot salvato!';
    document.body.classList.add('success');
    setTimeout(function() { window.close(); }, 1500);
  } else if (msg.type === 'error') {
    pct.textContent = '✗';
    text.textContent = msg.message || 'Errore';
    document.body.classList.add('error');
    setTimeout(function() { window.close(); }, 3000);
  }
});

function vistaCattura() {
  document.getElementById('pannello').style.display = 'none';
  document.getElementById('cattura').style.display = 'flex';
}

// Avvia la cattura nella modalità scelta (il popup fa da launcher).
function avviaCattura(mode) {
  vistaCattura();
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs[0]) return;
    var tabId = tabs[0].id;
    if (mode === 'multi') {
      pct.textContent = '▦';
      pct.style.fontSize = '28px';
      text.textContent = 'Multi Snip...';
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode });
      // Permesso "segui tra le schede": il click sul pannellino è un gesto
      // valido, quindi la richiesta parte diretta. Se già concesso Chrome
      // non mostra nulla; se rifiutato tutto funziona col click per scheda.
      chrome.permissions.contains({ origins: ['<all_urls>'] }, function(ok) {
        void chrome.runtime.lastError;
        if (ok) {
          setTimeout(function() { window.close(); }, 600);
          return;
        }
        chrome.permissions.request({ origins: ['<all_urls>'] }, function() {
          void chrome.runtime.lastError;
          window.close();
        });
      });
    } else if (mode === 'area') {
      pct.textContent = '✂';
      pct.style.fontSize = '28px';
      text.textContent = 'Seleziona l\'area';
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode });
      setTimeout(function() { window.close(); }, 800);
    } else if (mode === 'visible') {
      pct.textContent = '\u{1F4F7}';
      pct.style.fontSize = '28px';
      text.textContent = 'Cattura...';
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode });
      setTimeout(function() { window.close(); }, 600);
    } else {
      // full page: il popup resta aperto e mostra il progresso
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode });
    }
  });
}

// ---- PANNELLO DI COMANDO ----

function evidenziaModo(mode) {
  document.querySelectorAll('.modo').forEach(function(m) {
    m.classList.toggle('attiva', m.getAttribute('data-mode') === mode);
  });
}

function setSw(id, on) {
  var sw = document.querySelector('#' + id + ' .sw');
  if (sw) sw.classList.toggle('on', !!on);
}

document.querySelectorAll('.modo').forEach(function(m) {
  m.addEventListener('click', function() {
    var mode = this.getAttribute('data-mode');
    chrome.storage.local.set({ captureMode: mode });
    evidenziaModo(mode);
    avviaCattura(mode);
  });
});

document.getElementById('pClip').addEventListener('click', function() {
  var sw = this.querySelector('.sw');
  var on = !sw.classList.contains('on');
  sw.classList.toggle('on', on);
  chrome.storage.local.set({ copyToClipboard: on });
});

document.getElementById('pLente').addEventListener('click', function() {
  var sw = this.querySelector('.sw');
  var on = !sw.classList.contains('on');
  sw.classList.toggle('on', on);
  chrome.storage.local.set({ lentePixel: on });
});

document.getElementById('linkImpostazioni').addEventListener('click', function() {
  chrome.tabs.create({ url: 'settings.html' });
  window.close();
});

// ---- AVVIO ----
// Sessione Multi Snip ATTIVA: l'icona evoca il widget di raccolta sulla
// scheda corrente, come sempre — niente pannello. Altrimenti: pannello di
// comando con la modalità attiva accesa e i due interruttori.
chrome.storage.session.get('multi', function(sm) {
  var inSessione = !!(sm && sm.multi && sm.multi.active);
  if (inSessione) {
    vistaCattura();
    pct.textContent = '▦';
    pct.style.fontSize = '28px';
    text.textContent = 'Multi Snip...';
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!tabs[0]) return;
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabs[0].id, mode: 'multi' });
      setTimeout(function() { window.close(); }, 600);
    });
    return;
  }
  chrome.storage.local.get(['captureMode', 'copyToClipboard', 'lentePixel'], function(d) {
    evidenziaModo(d.captureMode || 'full');
    setSw('pClip', (d.copyToClipboard === undefined) ? true : d.copyToClipboard);
    setSw('pLente', (d.lentePixel === undefined) ? true : d.lentePixel);
  });
});
