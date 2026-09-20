var water = document.getElementById('water');
var pct = document.getElementById('pct');
var text = document.getElementById('text');
var waterbody = document.getElementById('waterbody');
var popupPronto = false;
var avvioInCorso = false;
var captureTabId = null;
var launchTab = null;

// Il popup resta aperto solo durante l'avvio. Full Page e Area mostrano
// l'icona Stop, senza numeri sovrapposti; Visible la lascia normale.
chrome.runtime.onMessage.addListener(function(msg) {
  if (captureTabId === null || (msg.tabId !== undefined && msg.tabId !== captureTabId)) return;
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

function erroreAvvio(message) {
  vistaCattura();
  pct.textContent = '✗';
  text.textContent = message || 'Unable to start capture';
  document.body.classList.add('error');
  setTimeout(function() { window.close(); }, 3000);
}

function fermaCattura(state) {
  avvioInCorso = true;
  vistaCattura();
  pct.textContent = '■';
  text.textContent = 'Stopping capture…';
  // Si ferma soltanto la cattura in corso, non la raccolta Multi Snip.
  chrome.runtime.sendMessage({ action: 'cancelCapture', jobId: state.jobId }, function() {
    var error = chrome.runtime.lastError;
    if (error) { erroreAvvio('Unable to stop capture'); return; }
    window.close();
  });
}

function catturaGiaAttiva(state) {
  // Un clic sull'icona normale non deve essere uno Stop nascosto. Non
  // avviare un secondo lavoro durante Visible: chiudi soltanto il popup.
  if (state.toolbarStop && state.jobId) fermaCattura(state);
  else window.close();
}

function catturaAvviata(response, mode) {
  var error = chrome.runtime.lastError;
  if (error) { erroreAvvio('Unable to start capture'); return; }
  // Un altro avvio puo essere arrivato dopo il controllo iniziale: in
  // questa gara vale la modalita del lavoro attivo, non quella richiesta.
  if (response && response.active && !response.started) {
    catturaGiaAttiva(response);
    return;
  }
  if (response && response.started) {
    // L'avanzamento vive nel pannellino sulla pagina: questo launcher deve
    // chiudersi subito, così l'icona Stop funziona già al primo clic.
    window.close();
    return;
  }
  erroreAvvio(response && response.message);
}

// Avvia la cattura nella modalità scelta (il popup fa da launcher).
function avviaCattura(mode) {
  if (avvioInCorso) return;
  avvioInCorso = true;
  vistaCattura();
  function launchInTab(tabs) {
    var error = chrome.runtime.lastError;
    if (error || !tabs || !tabs[0]) { erroreAvvio('No tab available'); return; }
    var tabId = tabs[0].id;
    captureTabId = tabId;
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
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode }, function(response) {
        catturaAvviata(response, mode);
      });
    } else if (mode === 'visible') {
      pct.textContent = '\u{1F4F7}';
      pct.style.fontSize = '28px';
      text.textContent = 'Cattura...';
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode }, function(response) {
        catturaAvviata(response, mode);
      });
    } else {
      chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabId, mode: mode }, function(response) {
        catturaAvviata(response, mode);
      });
    }
  }
  // Reuse the source tab resolved when the mode buttons became available.
  if (launchTab) launchInTab([launchTab]);
  else chrome.tabs.query({ active: true, currentWindow: true }, launchInTab);
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
    if (!popupPronto || avvioInCorso) return;
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
function apriPopup() {
  chrome.storage.session.get('multi', function(sm) {
    var inSessione = !!(sm && sm.multi && sm.multi.active);
    if (inSessione) {
      avvioInCorso = true;
      vistaCattura();
      pct.textContent = '▦';
      pct.style.fontSize = '28px';
      text.textContent = 'Multi Snip...';
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        var error = chrome.runtime.lastError;
        if (error || !tabs || !tabs[0]) { erroreAvvio('No tab available'); return; }
        captureTabId = tabs[0].id;
        chrome.runtime.sendMessage({ action: 'startCapture', tabId: tabs[0].id, mode: 'multi' });
        setTimeout(function() { window.close(); }, 600);
      });
      return;
    }
    chrome.storage.local.get(['captureMode', 'copyToClipboard', 'lentePixel', 'mostraPannello'], function(d) {
      // Quick panel spento: comportamento classico, si parte subito con la
      // modalità salvata senza mostrare il pannello di comando.
      var modo = d.captureMode || 'full';
      var pannello = (d.mostraPannello === undefined) ? false : d.mostraPannello;
      // Multi Snip si porta il pannellino SULLA pagina: aprire anche il quick
      // panel qui sarebbe un doppione e costringerebbe a un click in più a
      // ogni cattura per arrivare comunque allo stesso posto.
      if (!pannello || modo === 'multi') {
        avviaCattura(modo);
        return;
      }
      evidenziaModo(modo);
      setSw('pClip', (d.copyToClipboard === undefined) ? true : d.copyToClipboard);
      setSw('pLente', (d.lentePixel === undefined) ? false : d.lentePixel);
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs[0]) { erroreAvvio('No tab available'); return; }
        launchTab = tabs[0];
        popupPronto = true;
      });
    });
  });
}

// Anche un popup gia in apertura puo aver preceduto setPopup('') del worker.
// Controllare il lavoro attivo prima di leggere il modo salvato evita che
// quel secondo click avvii un altro pezzo. Full Page e Area interpretano Stop.
chrome.runtime.sendMessage({ action: 'getCaptureState' }, function(state) {
  var error = chrome.runtime.lastError;
  if (error || !state || typeof state.active !== 'boolean') {
    erroreAvvio('Unable to read capture status');
    return;
  }
  if (state.active) {
    captureTabId = state.tabId;
    catturaGiaAttiva(state);
    return;
  }
  apriPopup();
});
