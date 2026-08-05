// Menu contestuale per Capture Mode
chrome.runtime.onInstalled.addListener(function(details) {
  chrome.contextMenus.removeAll(function() {
    chrome.contextMenus.create({
      id: 'captureMode',
      title: 'Capture Mode',
      contexts: ['action']
    });
  });

  // Changelog in-app: dopo un AGGIORNAMENTO accendi il badge NEW sull'icona e
  // segna la versione come "da leggere". Il badge si spegne quando l'utente
  // apre le impostazioni (che mostrano le novita'). Mai al primo install:
  // le novita' hanno senso solo per chi gia' usava l'estensione.
  if (details.reason === 'update') {
    var v = chrome.runtime.getManifest().version;
    if (details.previousVersion !== v) {
      chrome.storage.local.set({ newsUnread: v });
      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#00d4ff' });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: '#1a1a2e' });
      }
    }
  }
});

chrome.contextMenus.onClicked.addListener(function(info) {
  if (info.menuItemId === 'captureMode') {
    chrome.tabs.create({ url: 'settings.html' });
  }
});

// Ricevi messaggio dal popup per avviare cattura
chrome.runtime.onMessage.addListener(function(msg, sender) {
  if (msg.action === 'clearNewsBadge') {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.remove('newsUnread');
    return;
  }
  if (msg.action === 'startCapture') {
    // Pausa animazioni CSS + video appena clicchi (non tocca il motore JS).
    pauseCssAnims(msg.tabId).then(function() {
      if (msg.mode === 'full') {
        doFullCapture(msg.tabId);
      } else if (msg.mode === 'visible') {
        doVisibleCapture(msg.tabId);
      } else if (msg.mode === 'area') {
        doAreaCapture(msg.tabId);
      } else if (msg.mode === 'multi') {
        // MULTI SNIP: apre (o riprende) la sessione e mostra il WIDGET di
        // raccolta direttamente SULLA pagina — si scelgono tipo e pezzi
        // senza mai lasciare la pagina; l'editor si apre solo al "Compose".
        multiApriSessione(msg.tabId).then(function() {
          return multiMostraWidget(msg.tabId);
        });
      }
    });
  }
  // L'editor (o il widget su una scheda qualsiasi) chiede un altro pezzo:
  // si cattura col tipo richiesto e il pezzo arriva in sessione.
  if (msg.action === 'multiAdd') {
    multiAggiungiDaEditor(msg.kind, sender && sender.tab ? sender.tab.id : null);
    return;
  }
  // Il widget sulla pagina chiede di comporre: si apre l'editor.
  if (msg.action === 'multiCompose') {
    multiMostraEditor();
    return;
  }
  // Il widget chiede di buttare fuori l'ultimo pezzo (cattura sbagliata):
  // finisce nel cestino della sessione, da cui il redo può ripescarlo.
  if (msg.action === 'multiUndo') {
    conSessione(async function() {
      var m = await multiSessione();
      if (!m || !m.pieces.length) return;
      m.trash = m.trash || [];
      m.trash.push(m.pieces.pop());
      await chrome.storage.session.set({ multi: m });
      await multiAggiornaBadge();
      var tid = (sender && sender.tab && sender.tab.id != null) ? sender.tab.id : m.sourceTabId;
      await multiMostraWidget(tid);
    });
    return;
  }
  // Redo: l'ultimo pezzo tolto per sbaglio torna nel mucchio.
  if (msg.action === 'multiRedo') {
    conSessione(async function() {
      var m = await multiSessione();
      if (!m || !m.trash || !m.trash.length) return;
      m.pieces.push(m.trash.pop());
      await chrome.storage.session.set({ multi: m });
      await multiAggiornaBadge();
      var tid = (sender && sender.tab && sender.tab.id != null) ? sender.tab.id : m.sourceTabId;
      await multiMostraWidget(tid);
    });
    return;
  }
  // L'editor ha salvato (o annullato): la sessione si chiude.
  if (msg.action === 'multiDone') {
    chrome.storage.session.remove('multi').then(function() {
      multiAggiornaBadge();
      multiRimuoviWidgetOvunque();
    });
    return;
  }
});

// === SESSIONE MULTI SNIP ===
// La sessione vive in chrome.storage.session (muore alla chiusura del
// browser): { active, sourceTabId, editorTabId, pieces: [{img, tipo}] }.
// Finché è attiva, OGNI cattura completata viene dirottata all'editor
// invece che scaricata: è ciò che permette di mischiare Area / Schermo /
// Pagina intera nello stesso collage.

async function multiSessione() {
  var st = await chrome.storage.session.get('multi');
  return st.multi || null;
}

// Le MODIFICHE alla sessione passano tutte da qui, in coda (una alla volta):
// due click ravvicinati su undo/redo — o un click mentre arriva una cattura —
// non devono leggere lo stesso stato e sovrascriversi a vicenda.
var codaMulti = Promise.resolve();
function conSessione(fn) {
  var p = codaMulti.then(function() { return fn(); });
  codaMulti = p.catch(function() {});  // un errore non blocca la coda
  return p;
}

// Badge sull'icona: durante la sessione mostra il conteggio pezzi (così la
// sessione resta visibile anche cambiando scheda); a sessione chiusa torna
// il badge "NEW" delle novità, se ancora da leggere, o niente.
async function multiAggiornaBadge() {
  var m = await multiSessione();
  if (m && m.active) {
    chrome.action.setBadgeBackgroundColor({ color: '#00d4ff' });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#1a1a2e' });
    }
    chrome.action.setBadgeText({ text: String(m.pieces.length) });
  } else {
    var st = await chrome.storage.local.get('newsUnread');
    chrome.action.setBadgeText({ text: st.newsUnread ? 'NEW' : '' });
  }
}

async function multiApriSessione(tabId) {
  return conSessione(async function() {
    var m = (await multiSessione()) || { active: true, sourceTabId: tabId, editorTabId: null, pieces: [], trash: [] };
    m.active = true;
    // Se l'icona viene cliccata sulla scheda dell'EDITOR, la sorgente resta
    // quella vecchia: non ha senso catturare l'editor stesso.
    if (m.editorTabId == null || tabId !== m.editorTabId) {
      m.sourceTabId = tabId;
    }
    await chrome.storage.session.set({ multi: m });
    await multiAggiornaBadge();
  });
}

// Mostra l'editor: riattiva la scheda se esiste, altrimenti la crea.
async function multiMostraEditor() {
  var m = await multiSessione();
  if (!m) return;
  if (m.editorTabId != null) {
    try {
      await chrome.tabs.update(m.editorTabId, { active: true });
      return;
    } catch (schedaSparita) {
      m.editorTabId = null;
    }
  }
  var tab = await chrome.tabs.create({ url: 'editor.html' });
  m.editorTabId = tab.id;
  await chrome.storage.session.set({ multi: m });
}

async function multiAggiungiPezzo(dataUrl, tabId, tipo) {
  return conSessione(async function() {
  var m = await multiSessione();
  if (!m) return false;
  // Una nuova cattura azzera il redo (semantica classica) e libera quota —
  // ma SOLO se l'aggiunta riesce: su fallimento il cestino torna com'era.
  var cestinoPrima = m.trash || [];
  m.trash = [];
  m.nextId = (m.nextId || 0) + 1;
  m.pieces.push({ img: dataUrl, tipo: tipo, id: m.nextId });
  m.sourceTabId = tabId;
  try {
    await chrome.storage.session.set({ multi: m });
  } catch (quotaErr) {
    // storage.session ha un tetto di ~10MB: se il pezzo non ci sta (pagine
    // intere enormi), lo si converte in JPEG di qualità alta e si riprova.
    try {
      var ridotto = await comprimiInJpeg(dataUrl);
      m.pieces[m.pieces.length - 1].img = ridotto;
      await chrome.storage.session.set({ multi: m });
    } catch (e2) {
      // Il pezzo proprio non ci sta: si scarta, il cestino si ripristina e
      // il widget ricompare (si era tolto da solo prima della cattura).
      m.pieces.pop();
      m.trash = cestinoPrima;
      await chrome.storage.session.set({ multi: m });
      await multiMostraWidget(tabId);
      return false;
    }
  }
  await multiAggiornaBadge();
  // Se l'editor è GIÀ aperto si torna lì (fase di composizione); altrimenti
  // si resta sulla pagina e si riaggiorna il widget di raccolta col nuovo
  // conteggio — niente ping-pong con l'editor mentre si raccolgono i pezzi.
  var editorVivo = false;
  if (m.editorTabId != null) {
    try {
      await chrome.tabs.get(m.editorTabId);
      editorVivo = true;
    } catch (schedaChiusa) {
      m.editorTabId = null;
      await chrome.storage.session.set({ multi: m });
    }
  }
  if (editorVivo) {
    try { await chrome.tabs.update(m.editorTabId, { active: true }); } catch (e) {}
  } else {
    await multiMostraWidget(tabId);
  }
  return true;
  });
}

// Widget di raccolta SULLA pagina: scegli il tipo di cattura, vedi quanti
// pezzi hai, componi quando decidi tu. Si toglie da solo al click (per non
// finire dentro lo screenshot) e riappare aggiornato dopo ogni pezzo.
async function multiMostraWidget(tabId) {
  var m = await multiSessione();
  if (!m) return;
  try {
    var ultimo = m.pieces.length ? m.pieces[m.pieces.length - 1].tipo : null;
    var ripristinabile = (m.trash && m.trash.length) ? m.trash[m.trash.length - 1].tipo : null;
    // Capienza: il magazzino di sessione ha un tetto (~10MB) — la barra sul
    // widget mostra quanto è pieno il recipiente e quanti MB restano.
    var QUOTA = chrome.storage.session.QUOTA_BYTES || 10485760;
    var usati = 0;
    try {
      usati = await chrome.storage.session.getBytesInUse(null);
    } catch (senzaMisura) {
      m.pieces.forEach(function(p) { usati += p.img.length; });
      (m.trash || []).forEach(function(p) { usati += p.img.length; });
    }
    var pctPieno = Math.min(100, Math.round(usati / QUOTA * 100));
    var mbTesto = (usati / 1048576).toFixed(1) + ' / ' + Math.round(QUOTA / 1048576) + ' MB';
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      args: [m.pieces.length, ultimo, ripristinabile, pctPieno, mbTesto],
      func: function(quanti, ultimoTipo, redoTipo, pctPieno, mbTesto) {
        var old = document.getElementById('__shot_multi_widget');
        if (old) old.remove();
        var w = document.createElement('div');
        w.id = '__shot_multi_widget';
        // Hover sugli elementi cliccabili: senza feedback non si capisce
        // dove si sta per cliccare. (Stile scoped sull'id del widget.)
        var stile = document.createElement('style');
        stile.textContent =
          '#__shot_multi_widget button,#__shot_multi_widget .mw-icn{transition:background .12s,filter .12s,color .12s;}' +
          '#__shot_multi_widget button:not(:disabled):not(.mw-primario):hover{background:rgba(0,212,255,0.18) !important;}' +
          '#__shot_multi_widget button.mw-primario:not(:disabled):hover{filter:brightness(1.15);}' +
          '#__shot_multi_widget .mw-icn:hover{background:rgba(255,255,255,0.14);border-radius:5px;color:#fff !important;}';
        w.appendChild(stile);
        w.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;' +
          'background:#16162a;border:1px solid rgba(0,212,255,0.45);border-radius:12px;' +
          'padding:10px;font-family:Segoe UI,sans-serif;color:#eee;' +
          'box-shadow:0 6px 24px rgba(0,0,0,0.45);display:flex;flex-direction:column;gap:6px;width:200px;';

        function bott(testo, css, fn) {
          var b = document.createElement('button');
          b.textContent = testo;
          b.style.cssText = 'border:1px solid rgba(0,212,255,0.4);background:transparent;color:#00d4ff;' +
            'font-family:inherit;font-size:12px;font-weight:600;padding:6px 8px;border-radius:7px;cursor:pointer;' + css;
          b.addEventListener('click', fn);
          return b;
        }

        var testa = document.createElement('div');
        testa.style.cssText = 'display:flex;align-items:center;gap:4px;';
        var tit = document.createElement('div');
        tit.textContent = 'Multi Snip · ' + quanti + (quanti === 1 ? ' piece' : ' pieces');
        tit.style.cssText = 'font-size:12px;font-weight:700;flex:1;';
        var chiudi = document.createElement('span');
        chiudi.textContent = '✕';
        chiudi.title = 'End session';
        chiudi.className = 'mw-icn';
        chiudi.style.cssText = 'cursor:pointer;color:#888;font-size:12px;padding:2px 4px;';
        chiudi.addEventListener('click', function() {
          w.remove();
          chrome.runtime.sendMessage({ action: 'multiDone' });
        });
        testa.appendChild(tit);
        // Frecce undo/redo sempre visibili; spente (grigie) quando non
        // c'è nulla da annullare o ripristinare.
        var nomi = { area: 'Area', visible: 'Screen', full: 'Page' };
        function freccia(ch, attiva, tip, azione) {
          var s = document.createElement('span');
          s.textContent = ch;
          s.title = tip;
          s.style.cssText = 'font-size:15px;line-height:1;padding:2px 4px;' +
            (attiva ? 'cursor:pointer;color:#00d4ff;' : 'cursor:default;color:#4a5262;');
          if (attiva) s.className = 'mw-icn';
          if (attiva) {
            s.addEventListener('click', function() {
              chrome.runtime.sendMessage({ action: azione });
            });
          }
          return s;
        }
        testa.appendChild(freccia('↶', quanti > 0,
          quanti > 0
            ? 'Undo — remove last piece' + (nomi[ultimoTipo] ? ' (' + nomi[ultimoTipo] + ')' : '')
            : 'Nothing to undo',
          'multiUndo'));
        testa.appendChild(freccia('↷', !!redoTipo,
          redoTipo
            ? 'Redo — restore removed piece' + (nomi[redoTipo] ? ' (' + nomi[redoTipo] + ')' : '')
            : 'Nothing to redo',
          'multiRedo'));
        testa.appendChild(chiudi);
        w.appendChild(testa);

        // Recipiente che si riempie: quota di sessione usata dai pezzi.
        var serb = document.createElement('div');
        serb.style.cssText = 'display:flex;align-items:center;gap:6px;';
        serb.title = 'Session space used by your pieces (' + pctPieno + '%)';
        var barra = document.createElement('div');
        barra.style.cssText = 'flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,0.12);overflow:hidden;';
        var pieno = document.createElement('div');
        var colore = pctPieno >= 90 ? '#ff5c5c' : (pctPieno >= 70 ? '#ffb020' : '#00d4ff');
        pieno.style.cssText = 'height:100%;width:0;border-radius:4px;background:' + colore + ';transition:width 0.6s ease;';
        barra.appendChild(pieno);
        var eti = document.createElement('div');
        eti.textContent = mbTesto;
        eti.style.cssText = 'font-size:9px;color:#8a93a6;white-space:nowrap;';
        serb.appendChild(barra);
        serb.appendChild(eti);
        w.appendChild(serb);
        requestAnimationFrame(function() {
          pieno.style.width = (quanti ? Math.max(pctPieno, 2) : pctPieno) + '%';
        });

        var riga = document.createElement('div');
        riga.style.cssText = 'display:flex;gap:5px;';
        [['Area', 'area'], ['Screen', 'visible'], ['Page', 'full']].forEach(function(v) {
          riga.appendChild(bott('+ ' + v[0], 'flex:1;padding:6px 2px;', function() {
            w.remove();
            chrome.runtime.sendMessage({ action: 'multiAdd', kind: v[1] });
          }));
        });
        w.appendChild(riga);

        var comp = bott('✓ Save & Compose (' + quanti + ')',
          'background:#00d4ff;color:#0d1220;font-weight:700;border-color:#00d4ff;', function() {
          w.remove();
          chrome.runtime.sendMessage({ action: 'multiCompose' });
        });
        comp.className = 'mw-primario';
        if (!quanti) {
          comp.disabled = true;
          comp.style.opacity = '0.4';
          comp.style.cursor = 'default';
        }
        w.appendChild(comp);

        document.body.appendChild(w);
      }
    });
  } catch (nonIniettabile) {
    // pagina protetta (chrome:// ecc.): il widget non si può mostrare
  }
}

// Ricompressione di emergenza in JPEG via OffscreenCanvas (il service worker
// non ha document/Image: si passa da fetch -> blob -> createImageBitmap).
async function comprimiInJpeg(dataUrl) {
  var blob = await (await fetch(dataUrl)).blob();
  var bmp = await createImageBitmap(blob);
  var canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  var out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return await new Promise(function(res, rej) {
    var r = new FileReader();
    r.onload = function() { res(r.result); };
    r.onerror = rej;
    r.readAsDataURL(out);
  });
}

async function multiAggiungiDaEditor(kind, daTabId) {
  var m = await multiSessione();
  if (!m) return;
  // Se il click arriva dal widget su una scheda qualunque (pannellino che
  // segue tra le tab), è QUELLA la pagina da catturare.
  if (daTabId != null && daTabId !== m.editorTabId && daTabId !== m.sourceTabId) {
    m.sourceTabId = daTabId;
    await chrome.storage.session.set({ multi: m });
  }
  try {
    var tab = await chrome.tabs.get(m.sourceTabId);
    await chrome.tabs.update(m.sourceTabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (tabSparita) {
    return; // la pagina di origine non esiste più: niente da catturare
  }
  await sleep(300);  // lascia alla scheda il tempo di tornare a fuoco
  await pauseCssAnims(m.sourceTabId);
  if (kind === 'full') {
    doFullCapture(m.sourceTabId);
  } else if (kind === 'visible') {
    doVisibleCapture(m.sourceTabId);
  } else {
    doAreaCapture(m.sourceTabId);
  }
}

// Se l'utente chiude la scheda dell'editor, la sessione muore con lei:
// le catture successive tornano al normale scarica+copia.
chrome.tabs.onRemoved.addListener(function(tabId) {
  chrome.storage.session.get('multi').then(function(st) {
    if (st.multi && st.multi.editorTabId === tabId) {
      chrome.storage.session.remove('multi').then(function() {
        multiAggiornaBadge();
        multiRimuoviWidgetOvunque();
      });
    }
  });
});

// A sessione chiusa il pannellino va tolto da TUTTE le schede dove era
// comparso (col permesso multi-tab può essere ovunque). Sulle schede non
// accessibili fallisce in silenzio.
function multiRimuoviWidgetOvunque() {
  chrome.tabs.query({}, function(tabs) {
    (tabs || []).forEach(function(t) {
      chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: function() {
          var el = document.getElementById('__shot_multi_widget');
          if (el) el.remove();
        }
      }).catch(function() {});
    });
  });
}

// Il pannellino SEGUE l'utente tra le schede solo se ha concesso l'accesso
// ai siti (permesso opzionale, richiesto dalle impostazioni quando si
// sceglie Multi Snip). Senza permesso resta il giro classico: click
// sull'icona sulla scheda nuova.
function multiPuoSeguire() {
  return new Promise(function(res) {
    try {
      chrome.permissions.contains({ origins: ['<all_urls>'] }, function(ok) {
        void chrome.runtime.lastError;
        res(!!ok);
      });
    } catch (e) { res(false); }
  });
}

// Cambio scheda: sessione attiva + permesso concesso = il pannellino
// compare da solo sulla scheda nuova (pagine protette: fallisce zitto).
chrome.tabs.onActivated.addListener(function(info) {
  multiSessione().then(function(m) {
    if (!m || !m.active || info.tabId === m.editorTabId) return;
    multiPuoSeguire().then(function(ok) {
      if (ok) multiMostraWidget(info.tabId);
    });
  });
});

// Fine caricamento pagina: il widget non sopravvive alle navigazioni,
// quindi sulla scheda attiva lo si ripianta.
chrome.tabs.onUpdated.addListener(function(tabId, change, tab) {
  if (change.status !== 'complete' || !tab || !tab.active) return;
  multiSessione().then(function(m) {
    if (!m || !m.active || tabId === m.editorTabId) return;
    multiPuoSeguire().then(function(ok) {
      if (ok) multiMostraWidget(tabId);
    });
  });
});

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function sendProgress(text, percent) {
  chrome.runtime.sendMessage({ type: 'progress', text: text, percent: percent }).catch(function() {});
}

function sendSuccess() {
  chrome.runtime.sendMessage({ type: 'success' }).catch(function() {});
}

function sendError(msg) {
  chrome.runtime.sendMessage({ type: 'error', message: msg }).catch(function() {});
}

// === CONGELA ANIMAZIONI DURANTE LA CATTURA ===
// Tre cose, tutte REVERSIBILI e SENZA toccare requestAnimationFrame (che
// romperebbe la cattura):
//  1) animazioni CSS in pausa (animation-play-state:paused);
//  2) video in pausa;
//  3) elementi mossi via JS (transform inline tipo ticker/carosello): si
//     INTERCETTA la proprietà transform di quell'elemento con defineProperty
//     (get = valore congelato, set = ignora). Il JS del sito continua a girare
//     ma le sue scritture su transform cadono nel vuoto → l'elemento resta fermo.
async function pauseCssAnims(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',  // serve per intercettare le scritture transform del JS del sito
      func: function() {
        // 1) animazioni CSS
        var st = document.getElementById('__shot_css_pause');
        if (!st) {
          st = document.createElement('style');
          st.id = '__shot_css_pause';
          st.textContent = '*,*::before,*::after{animation-play-state:paused !important;}' +
            // Nasconde la scrollbar del contenitore interno durante la cattura
            // Full Page: comparirebbe come colonna grigia sul bordo destro di
            // ogni slice. (Solo Full Page: in Area nasconderla farebbe riallargare
            // il contenuto DOPO che l'utente ha già disegnato il rettangolo.)
            '[data-screenshot-scroll]{scrollbar-width:none !important;}' +
            '[data-screenshot-scroll]::-webkit-scrollbar{display:none !important;}';
          (document.head || document.documentElement).appendChild(st);
        }
        // 2) video
        window.__shotPausedVideos = [];
        document.querySelectorAll('video').forEach(function(v) {
          if (!v.paused) { try { v.pause(); window.__shotPausedVideos.push(v); } catch (e) {} }
        });
        // 3) elementi con transform inline (ticker/caroselli JS): congela il
        // transform con un MutationObserver. NON si tocca la proprietà nativa:
        // si SORVEGLIA l'elemento e ogni volta che il loop del sito riscrive il
        // transform lo si rimette al valore congelato. Allo "stop" si disconnette
        // l'observer e il loop del sito riprende a muovere l'elemento da solo.
        // Questo metodo è reversibile a ogni scatto (niente residui), a differenza
        // di defineProperty/delete che dopo il 1° giro non si ri-aggancia più.
        window.__shotFrozen = [];
        document.querySelectorAll('[style*="transform"]').forEach(function(el) {
          var cur = el.style.transform;
          if (!cur || cur === 'none') return;
          try {
            var frozenVal = cur;            // valore a cui inchiodare l'elemento
            var obs = new MutationObserver(function() {
              // ogni tentativo del sito di muoverlo viene annullato.
              if (el.style.transform !== frozenVal) el.style.transform = frozenVal;
            });
            obs.observe(el, { attributes: true, attributeFilter: ['style'] });
            window.__shotFrozen.push({ el: el, obs: obs });
          } catch (e) {}
        });
      }
    });
  } catch (e) {}
}

async function resumeCssAnims(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',  // stesso mondo del freeze, per ritrovare lo stato e ripristinare
      func: function() {
        // 1) animazioni CSS
        var st = document.getElementById('__shot_css_pause');
        if (st) st.remove();
        // 2) video
        if (window.__shotPausedVideos) {
          window.__shotPausedVideos.forEach(function(v) { try { v.play(); } catch (e) {} });
          window.__shotPausedVideos = null;
        }
        // 3) sblocca il transform: DISCONNETTE l'observer che sorvegliava
        // l'elemento. Da quel momento il loop del sito torna libero di riscrivere
        // il transform → il ticker riparte. Nessun residuo: al prossimo screenshot
        // si installa un observer nuovo e tutto ricongela come la prima volta.
        if (window.__shotFrozen) {
          window.__shotFrozen.forEach(function(rec) {
            try { rec.obs.disconnect(); } catch (e) {}
          });
          window.__shotFrozen = null;
        }
      }
    });
  } catch (e) {}
}

// === COPIA NEGLI APPUNTI (dalla pagina attiva) ===
// In Manifest V3 il service worker non puo' accedere a navigator.clipboard, e
// un documento offscreen invisibile non puo' usarlo perche' non ha il focus
// ("Document is not focused"). La pagina attiva invece il focus ce l'ha:
// iniettiamo li' un piccolo script che scrive l'immagine negli appunti con
// ClipboardItem. E' il metodo affidabile per copiare immagini da un'estensione.

// Copia il dataURL negli appunti, SOLO se l'interruttore copyToClipboard e'
// acceso (default: true). Non lancia mai: in caso di errore lo logga e basta,
// per non rompere il flusso del download gia' avvenuto.
async function copyToClipboard(dataUrl, tabId) {
  try {
    var store = await chrome.storage.local.get('copyToClipboard');
    var enabled = (store.copyToClipboard === undefined) ? true : store.copyToClipboard;
    if (!enabled) return;
    if (!dataUrl || !tabId) return;

    // navigator.clipboard.write esige che la pagina abbia il FOCUS. Quando la
    // cattura parte dal popup dell'estensione (es. modalita' Visible), il focus
    // ce l'ha il popup, non la pagina -> "Document is not focused". Quindi prima
    // di copiare riportiamo il focus alla tab e alla sua finestra.
    try {
      var tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tabId, { active: true });
      if (tab && tab.windowId !== undefined) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
    } catch (focusErr) {
      // se fallisce il focus proviamo lo stesso a copiare
    }

    var res = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async function(durl) {
        function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
        async function writeOnce() {
          var resp = await fetch(durl);
          var blob = await resp.blob();
          var item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
        }
        try {
          window.focus();           // la pagina prende il focus
          try {
            await writeOnce();
          } catch (e1) {
            // Il focus puo' arrivare con un attimo di ritardo: un retry breve.
            if (String(e1 && e1.message || e1).indexOf('not focused') !== -1) {
              await delay(150);
              window.focus();
              await writeOnce();
            } else {
              throw e1;
            }
          }
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) };
        }
      },
      args: [dataUrl]
    });

    var out = res && res[0] && res[0].result;
    if (out && out.ok === false) {
      console.warn('Copia negli appunti fallita:', out.error);
    }
  } catch (err) {
    console.warn('Copia negli appunti fallita:', err && err.message || err);
  }
}

// === INVITO A RECENSIRE ===
// Dopo N catture riuscite (momento di massima soddisfazione), UNA volta sola,
// banner discreto sulla pagina. NIENTE "review gating" (vietato dalle policy
// dello store): entrambi i link sempre visibili — stella sullo store E
// feedback via email. Se la pagina non e' iniettabile l'invito slitta alla
// cattura successiva (il flag si salva solo a banner mostrato davvero).
var SOGLIA_INVITO_RECENSIONE = 15;
var URL_RECENSIONI = 'https://chromewebstore.google.com/detail/napeefngooaeinknhnngbnokkadmmomj/reviews';
var MAIL_FEEDBACK = 'mailto:lollotj@gmail.com?subject=Full%20Page%20Screenshot%20feedback';

async function registraCatturaRiuscita(tabId) {
  try {
    var st = await chrome.storage.local.get(['captureCount', 'reviewInviteShown']);
    var n = (st.captureCount || 0) + 1;
    await chrome.storage.local.set({ captureCount: n });
    if (st.reviewInviteShown || n < SOGLIA_INVITO_RECENSIONE || !tabId) return;

    var res = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(urlReviews, urlMail) {
        if (document.getElementById('__shot_review_invite')) return true;

        // Tutto costruito con createElement/textContent: niente innerHTML,
        // che sui siti con Trusted Types (GitHub ecc.) viene bloccato.
        var box = document.createElement('div');
        box.id = '__shot_review_invite';
        box.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;' +
          'background:#1a1a2e;color:#eee;font-family:Segoe UI,sans-serif;font-size:13px;' +
          'padding:14px 16px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,0.35);' +
          'max-width:280px;opacity:0;transition:opacity 0.4s;border:1px solid rgba(0,212,255,0.35);';

        var close = document.createElement('span');
        close.textContent = '✕';
        close.style.cssText = 'position:absolute;top:8px;right:10px;cursor:pointer;color:#888;font-size:12px;';
        close.addEventListener('click', function() { box.remove(); });
        box.appendChild(close);

        var msg = document.createElement('div');
        msg.textContent = 'If I helped you, leave a star or a comment ⭐';
        msg.style.cssText = 'font-weight:600;margin:0 14px 10px 0;line-height:1.4;';
        box.appendChild(msg);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

        var star = document.createElement('a');
        star.textContent = '★ Leave a star';
        star.href = urlReviews;
        star.target = '_blank';
        star.rel = 'noopener';
        star.style.cssText = 'display:block;text-align:center;background:#00d4ff;color:#0d1220;' +
          'font-weight:700;padding:8px 10px;border-radius:8px;text-decoration:none;font-size:13px;';
        row.appendChild(star);

        var fb = document.createElement('a');
        fb.textContent = 'Tell me what to improve';
        fb.href = urlMail;
        fb.style.cssText = 'display:block;text-align:center;color:#00d4ff;font-weight:600;' +
          'padding:6px 10px;border-radius:8px;text-decoration:none;font-size:12px;' +
          'border:1px solid rgba(0,212,255,0.4);';
        row.appendChild(fb);

        box.appendChild(row);
        document.body.appendChild(box);
        requestAnimationFrame(function() { box.style.opacity = '1'; });
        setTimeout(function() {
          box.style.opacity = '0';
          setTimeout(function() { box.remove(); }, 400);
        }, 30000);
        return true;
      },
      args: [URL_RECENSIONI, MAIL_FEEDBACK]
    });

    if (res && res[0] && res[0].result === true) {
      await chrome.storage.local.set({ reviewInviteShown: true });
    }
  } catch (e) {
    // pagina non iniettabile (chrome:// ecc.): l'invito riprovera' piu' avanti
  }
}

// === FULL PAGE ===
async function doFullCapture(tabId) {
  try {
    sendProgress('Preparazione...', 5);

    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var scrollEl = null;
        // PROVA PRATICA invece del confronto di altezze: su alcuni siti (es.
        // betexplorer) scrolla il BODY con overflow proprio, non la finestra —
        // il documento risulta alto ma window.scrollTo non muove nulla. Quindi:
        // scrollo di 1px e guardo se la finestra si è mossa DAVVERO. behavior
        // 'instant' per non farsi ingannare da CSS scroll-behavior:smooth
        // (renderebbe il movimento asincrono e la lettura darebbe falso fermo).
        var y0 = window.scrollY;
        window.scrollTo({ top: (y0 > 0 ? y0 - 1 : y0 + 1), left: window.scrollX, behavior: 'instant' });
        var windowScrolls = window.scrollY !== y0;
        window.scrollTo({ top: y0, left: window.scrollX, behavior: 'instant' });

        if (!windowScrolls) {
          var all = document.querySelectorAll('*');
          for (var j = 0; j < all.length; j++) {
            var el = all[j];
            var style = window.getComputedStyle(el);
            var ov = style.overflowY;
            if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              if (!scrollEl || el.scrollHeight > scrollEl.scrollHeight) {
                scrollEl = el;
              }
            }
          }
        }

        // Il BODY è un target VALIDO (siti col body-scroller: si muove via
        // body.scrollTop come qualunque contenitore custom). Solo l'html resta
        // equivalente alla finestra.
        var useWindow = !scrollEl || scrollEl === document.documentElement;
        var target = useWindow ? null : scrollEl;

        var sy = target ? target.scrollTop : window.scrollY;

        if (target) {
          target.setAttribute('data-screenshot-scroll', 'true');
          target.scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }

        // Altezza misurata DOPO aver marcato il target: da quel momento il CSS
        // di cattura nasconde la scrollbar del contenitore, il contenuto si
        // riallarga di ~15px e l'altezza totale può cambiare leggermente.
        var sh = target ? target.scrollHeight : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

        // Geometria del contenitore A SCHERMO: dove inizia (ot) e quanto è
        // alta la sua parte visibile (ch). Sulle pagine dove il contenitore
        // NON riempie il viewport (barra admin sopra, margini — es. console
        // Mistral) avanzare di window.innerHeight salta contenuto, e impilare
        // i frame interi duplica le bande fuori dal contenitore.
        var ch = window.innerHeight, ot = 0;
        if (target) {
          var rTgt = target.getBoundingClientRect();
          // clientTop: il bordo superiore dell'elemento non fa parte
          // dell'area di contenuto che scorre.
          ot = Math.max(0, Math.round(rTgt.top + (target.clientTop || 0)));
          // Solo la parte DENTRO lo schermo: clientHeight può sporgere sotto
          // il viewport (body con margini, scroller alto 100vh sotto una
          // barra) e senza questo clamp ogni giuntura perderebbe una striscia
          // di contenuto lasciando una banda trasparente al suo posto.
          ch = Math.min(target.clientHeight, window.innerHeight - ot);
          // Contenitore collassato o quasi fuori schermo: il passo di scroll
          // sarebbe inutilizzabile (con 0 addirittura rows=Infinity = cattura
          // che non termina MAI). Ripiego sul passo-viewport: cattura
          // degradata ma sempre finita.
          if (!(ch >= 50)) { ch = window.innerHeight; ot = 0; }
        }

        return {
          sh: sh,
          vh: window.innerHeight,
          vw: window.innerWidth,
          sy: sy,
          ch: ch,
          ot: ot,
          dpr: window.devicePixelRatio || 1,
          hasCustomScroll: !useWindow
        };
      }
    });

    var d = results[0].result;
    // Passo di avanzamento: l'altezza VISIBILE del contenitore scrollato
    // (per lo scroll di finestra coincide con l'altezza del viewport).
    var stepH = d.hasCustomScroll ? d.ch : d.vh;
    var rows = Math.ceil(d.sh / stepH);
    var captures = [];

    for (var i = 0; i < rows; i++) {
      var pct = Math.round(((i + 1) / rows) * 85) + 5;
      sendProgress('Cattura ' + (i + 1) + ' di ' + rows + '...', pct);

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(y, custom, row) {
          // Censimento sticky/fixed una sola volta (prima slice), con la
          // visibility originale salvata per il ripristino finale.
          if (row === 0) {
            window.__screenshotHidden = [];
            var scrollAnc = custom ? document.querySelector('[data-screenshot-scroll]') : null;
            var allEls = document.querySelectorAll('*');
            for (var k = 0; k < allEls.length; k++) {
              var st = window.getComputedStyle(allEls[k]);
              if (st.position === 'fixed' || st.position === 'sticky') {
                // MAI censire il contenitore che scrolliamo o un suo antenato:
                // visibility si eredita, nasconderlo cancella TUTTO il contenuto.
                // (Dashboard con "scocca" fixed a schermo intero e scroll interno:
                // dalle slice 2+ restava visibile solo lo sfondo.)
                if (scrollAnc && allEls[k].contains(scrollAnc)) continue;
                // MAI censire un elemento grande quasi quanto lo schermo: è la
                // scocca dell'app o uno sfondo decorativo, non una barra fissa.
                var rc = allEls[k].getBoundingClientRect();
                if (rc.width >= window.innerWidth * 0.9 && rc.height >= window.innerHeight * 0.9) continue;
                window.__screenshotHidden.push({
                  el: allEls[k],
                  oldVisibility: allEls[k].style.visibility
                });
              }
            }

            // BARRE LATERALI/HEADER IN-FLOW FUORI DAL CONTENITORE SCROLLATO
            // (solo scroll interno): non essendo fixed/sticky sfuggono al
            // censimento qui sopra, ma non si muovono mai col contenuto e si
            // ripetono identici in ogni slice (es. sidebar DeepSeek Platform).
            // Censisco i FIGLI dei "fratelli" degli antenati del contenitore
            // (i figli, non il fratello: così sfondo e bordo della colonna
            // restano visibili come nella pagina vera). Sarà poi il micro-scroll
            // di test a confermarli ancorati e nasconderli dalla slice 2 in poi.
            // Chi si SOVRAPPONE al contenitore viene saltato: è uno sfondo
            // decorativo dietro al contenuto, nasconderlo creerebbe buchi.
            if (scrollAnc) {
              var cr = scrollAnc.getBoundingClientRect();
              var nodeUp = scrollAnc;
              while (nodeUp && nodeUp !== document.body && nodeUp.parentElement) {
                var par = nodeUp.parentElement;
                for (var q = 0; q < par.children.length; q++) {
                  var sib = par.children[q];
                  if (sib === nodeUp || sib.contains(scrollAnc)) continue;
                  var sr = sib.getBoundingClientRect();
                  var iw = Math.min(sr.right, cr.right) - Math.max(sr.left, cr.left);
                  var ih = Math.min(sr.bottom, cr.bottom) - Math.max(sr.top, cr.top);
                  if (iw > 8 && ih > 8) continue;
                  for (var w = 0; w < sib.children.length; w++) {
                    window.__screenshotHidden.push({
                      el: sib.children[w],
                      oldVisibility: sib.children[w].style.visibility
                    });
                  }
                }
                nodeUp = par;
              }
            }
          }

          // Gestione robusta (come la modalità Area): NON filtra per altezza, ma
          // con un micro-scroll di test capisce quali elementi sono ANCORATI al
          // viewport (non si muovono) e li nasconde. Così becca anche i menu
          // laterali ALTI (Indice/Aspetto Wikipedia) che il filtro altezza
          // lasciava passare, facendoli ripetere ad ogni slice.
          function manageStickiesFP() {
            var list = window.__screenshotHidden || [];
            // ripristina visibility originale di tutti prima di decidere
            for (var s = 0; s < list.length; s++) { list[s].el.style.visibility = list[s].oldVisibility; }
            // PRIMA slice (row 0): lascia visibili gli header/barre fisse, così
            // compaiono UNA volta in cima (es. barra AI-DESK del sito). Le slice
            // successive li nascondono per non ripeterli.
            if (row === 0) return;

            function getS() { return custom ? document.querySelector('[data-screenshot-scroll]').scrollTop : window.scrollY; }
            function setS(v) { if (custom) { document.querySelector('[data-screenshot-scroll]').scrollTop = v; } else { window.scrollTo(0, v); } }
            var base = getS();
            var tops1 = [];
            for (var s = 0; s < list.length; s++) { tops1.push(list[s].el.getBoundingClientRect().top); }
            var probe = (base > 20) ? base - 12 : base + 12;
            setS(probe);
            var realProbe = getS();
            var tops2 = [];
            for (var s = 0; s < list.length; s++) { tops2.push(list[s].el.getBoundingClientRect().top); }
            setS(base);  // ripristina lo scroll esatto della slice
            var scrollMoved = Math.abs(realProbe - base) > 1;
            for (var s = 0; s < list.length; s++) {
              var anchored = scrollMoved && (Math.abs(tops1[s] - tops2[s]) < 2);
              if (anchored) list[s].el.style.visibility = 'hidden';
            }
          }

          if (custom) {
            var el = document.querySelector('[data-screenshot-scroll]');
            if (el) {
              el.scrollTo({ top: y, behavior: 'smooth' });
            }
          } else {
            window.scrollTo({ top: y, behavior: 'smooth' });
          }
          return new Promise(function(resolve) {
            var checks = 0;
            var lastY = -1;
            var interval = setInterval(function() {
              var currentY = custom
                ? document.querySelector('[data-screenshot-scroll]').scrollTop
                : window.scrollY;
              checks++;
              // Fermati anche se lo scroll non si muove più (clampato al fondo):
              // sull'ultima slice il target chiesto può superare il fondo pagina
              // e senza questo check si aspettava sempre il timeout pieno (1.5s).
              var fermo = (checks > 3 && Math.abs(currentY - lastY) < 1);
              lastY = currentY;
              if (Math.abs(currentY - y) < 2 || fermo || checks > 30) {
                clearInterval(interval);
                manageStickiesFP();  // nascondi gli ancorati a QUESTA slice
                resolve(true);
              }
            }, 50);
          });
        },
        args: [i * stepH, d.hasCustomScroll, i]
      });

      await sleep(350);

      var dataUrl = null;
      for (var retry = 0; retry < 3; retry++) {
        try {
          dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
          break;
        } catch (captureErr) {
          if (retry < 2 && captureErr.message.indexOf('MAX_CAPTURE') !== -1) {
            await sleep(600);
          } else {
            throw captureErr;
          }
        }
      }
      captures.push(dataUrl);
    }

    sendProgress('Composizione...', 92);

    var compResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(imgs, pw, ph, viewH, ratio, custom, ch, ot) {
        // Carica tutte le immagini PRIMA di disegnare, così conosciamo l'altezza
        // REALE in pixel di ogni slice (img.height). A zoom non-interi (110%,
        // 150%) viewH*ratio non è intero e impilando per calcolo si perde 1 riga
        // di pixel nelle giunzioni. Impilando per img.height reale, le slice si
        // toccano pixel-per-pixel e il buco sparisce.
        function loadImg(src) {
          return new Promise(function(res, rej) {
            var im = new Image();
            im.onload = function() { res(im); };
            im.onerror = rej;
            im.src = src;
          });
        }

        return Promise.all(imgs.map(loadImg)).then(function(loaded) {
          var total = loaded.length;
          // Larghezza canvas = larghezza reale della cattura (tutte uguali).
          var cw = loaded[0].width;

          // CONTENITORE INTERNO: ogni cattura è il viewport intero, ma il
          // contenuto NUOVO sta solo nella fascia del contenitore a schermo
          // (da ot a ot+ch, in px CSS). Se il contenitore non riempie il
          // viewport (barra admin sopra, margini) impilare i frame interi
          // taglia pezzi e duplica bande: qui si ritaglia la fascia giusta.
          // La prima slice tiene anche ciò che sta SOPRA il contenitore
          // (top bar della pagina), una volta sola, come per gli header fissi.
          if (custom) {
            var k = loaded[0].height / viewH;          // CSS -> pixel reali
            var bandTop = Math.round(ot * k);
            var bandH = Math.round(ch * k);
            var firstH = bandTop + Math.round(Math.min(ph, ch) * k);
            // Cintura di sicurezza sugli arrotondamenti: mai leggere oltre il
            // fondo del frame — drawImage clipperebbe la sorgente ma il
            // cursore avanzerebbe comunque, lasciando una riga trasparente
            // per giuntura.
            if (bandTop + bandH > loaded[0].height) bandH = loaded[0].height - bandTop;
            if (firstH > loaded[0].height) firstH = loaded[0].height;
            var lastRem = ph - (total - 1) * ch;       // contenuto nuovo dell'ultima slice (CSS)
            var lastH = Math.round(lastRem * k);
            if (lastH < 0) lastH = 0;
            if (lastH > bandH) lastH = bandH;

            var totalH = firstH;
            for (var q = 1; q < total; q++) totalH += (q === total - 1) ? lastH : bandH;
            var canvasC = document.createElement('canvas');
            canvasC.width = cw;
            canvasC.height = totalH;
            var ctxC = canvasC.getContext('2d');

            var yC = 0;
            for (var j = 0; j < total; j++) {
              var imC = loaded[j];
              var srcY, srcH;
              if (j === 0) { srcY = 0; srcH = firstH; }
              else if (j === total - 1) { srcH = lastH; srcY = bandTop + bandH - lastH; }
              else { srcY = bandTop; srcH = bandH; }
              if (srcH <= 0) continue;
              ctxC.drawImage(imC, 0, srcY, imC.width, srcH, 0, yC, imC.width, srcH);
              yC += srcH;
            }
            return canvasC.toDataURL('image/png');
          }
          // Altezza totale = somma delle altezze reali da disegnare per ogni slice.
          // L'ultima slice usa solo la parte rimanente (rem), in pixel reali.
          var lastRemCss = ph - (total - 1) * viewH;   // residuo CSS ultima slice
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          // somma: (total-1) slice piene a img.height + ultima a quota proporzionale
          var fullH = loaded[0].height;
          var lastH = Math.round(fullH * (lastRemCss / viewH));
          canvas.height = fullH * (total - 1) + lastH;
          var ctx = canvas.getContext('2d');

          var destY = 0;   // accumulatore: niente moltiplicazioni che accumulano errore
          for (var i = 0; i < total; i++) {
            var img = loaded[i];
            var last = (i === total - 1);
            if (last) {
              // disegna solo la parte bassa dell'ultima cattura (quella nuova)
              var srcOff = img.height - lastH;
              ctx.drawImage(img, 0, srcOff, img.width, lastH, 0, destY, img.width, lastH);
              destY += lastH;
            } else {
              ctx.drawImage(img, 0, 0, img.width, img.height, 0, destY, img.width, img.height);
              destY += img.height;
            }
          }
          return canvas.toDataURL('image/png');
        });
      },
      args: [captures, d.vw, d.sh, d.vh, d.dpr, d.hasCustomScroll, d.ch, d.ot]
    });

    // MULTI SNIP: a sessione attiva il pezzo va all'editor, non al download.
    var multiF = await multiSessione();
    if (multiF && multiF.active) {
      await multiAggiungiPezzo(compResult[0].result, tabId, 'full');
    } else {
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      chrome.downloads.download({
        url: compResult[0].result,
        filename: 'screenshots/screenshot_' + ts + '.png',
        saveAs: false
      });

      await copyToClipboard(compResult[0].result, tabId);
    }

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(y, custom) {
        if (window.__screenshotHidden) {
          for (var k = 0; k < window.__screenshotHidden.length; k++) {
            var item = window.__screenshotHidden[k];
            item.el.style.visibility = item.oldVisibility;
          }
          window.__screenshotHidden = null;
        }
        if (custom) {
          var el = document.querySelector('[data-screenshot-scroll]');
          if (el) { el.scrollTop = y; el.removeAttribute('data-screenshot-scroll'); }
        } else {
          window.scrollTo(0, y);
        }
      },
      args: [d.sy, d.hasCustomScroll]
    });

    await resumeCssAnims(tabId);
    sendSuccess();
    if (!(multiF && multiF.active)) {
      await registraCatturaRiuscita(tabId);
    }

  } catch (err) {
    console.error('Screenshot error:', err);
    await resumeCssAnims(tabId);
    // FALLBACK: su pagine non iniettabili (chrome://, errore) catturo il visibile.
    if (isPaginaNonIniettabile(err)) { await doVisibleCapture(tabId); return; }
    sendError(err.message);
  }
}

// Bollino sulla pagina: verde (successo) o rosso (errore)
async function showBollino(tabId, success, errorMsg) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(ok, msg) {
      var old = document.getElementById('__screenshot_bollino');
      if (old) old.remove();

      var b = document.createElement('div');
      b.id = '__screenshot_bollino';
      b.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;align-items:center;gap:8px;pointer-events:none;opacity:0;transition:opacity 0.3s;';

      var dot = document.createElement('div');
      dot.style.cssText = 'width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;color:white;box-shadow:0 2px 10px rgba(0,0,0,0.3);' + (ok ? 'background:#10b981;' : 'background:#ef4444;');
      dot.textContent = ok ? '\u2713' : '\u2717';
      b.appendChild(dot);

      if (!ok && msg) {
        var txt = document.createElement('div');
        txt.style.cssText = 'font-family:Segoe UI,sans-serif;font-size:12px;font-weight:600;color:#ef4444;background:rgba(255,255,255,0.95);padding:4px 10px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,0.15);max-width:200px;';
        txt.textContent = msg;
        b.appendChild(txt);
      }

      document.body.appendChild(b);
      requestAnimationFrame(function() { b.style.opacity = '1'; });
      setTimeout(function() {
        b.style.opacity = '0';
        setTimeout(function() { b.remove(); }, 300);
      }, ok ? 1500 : 3000);
    },
    args: [success, errorMsg || '']
  });
}

// Riconosce gli errori delle pagine dove NON si può iniettare script (chrome://,
// pagine di errore "sito irraggiungibile", store estensioni). Su queste Full Page
// e Area non possono lavorare, ma captureVisibleTab sì: ripieghiamo sul visibile.
function isPaginaNonIniettabile(err) {
  var m = String((err && err.message) || err || '').toLowerCase();
  return m.indexOf('cannot access') !== -1
      || m.indexOf('cannot be scripted') !== -1
      || m.indexOf('chrome://') !== -1
      || m.indexOf('chrome-extension://') !== -1
      || m.indexOf('extensions gallery') !== -1
      || m.indexOf('showing error page') !== -1;
}

// === VISIBLE ONLY ===
async function doVisibleCapture(tabId) {
  try {
    var dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    // MULTI SNIP: a sessione attiva il pezzo va all'editor, non al download.
    var multiV = await multiSessione();
    if (multiV && multiV.active) {
      await multiAggiungiPezzo(dataUrl, tabId, 'visible');
      await resumeCssAnims(tabId);
      sendSuccess();
      return;
    }
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chrome.downloads.download({
      url: dataUrl,
      filename: 'screenshots/screenshot_' + ts + '.png',
      saveAs: false
    });
    await copyToClipboard(dataUrl, tabId);
    await resumeCssAnims(tabId);
    sendSuccess();
    await showBollino(tabId, true);
    await registraCatturaRiuscita(tabId);
  } catch (err) {
    console.error('Screenshot error:', err);
    await resumeCssAnims(tabId);
    sendError(err.message);
    await showBollino(tabId, false, err.message);
  }
}

// === AREA SELECTION (Step 1 + 2 + 3) ===
async function doAreaCapture(tabId) {
  try {
    // (le animazioni JS sono già congelate dal listener startCapture)
    // In sessione Multi Snip l'overlay mostra un testo dedicato, così si
    // capisce che il pezzo finirà nell'editor e non nel download.
    var sessioneMulti = await multiSessione();
    var inMulti = !!(sessioneMulti && sessioneMulti.active);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      args: [inMulti],
      func: function(inMulti) {
        var old = document.getElementById('__screenshot_area_overlay');
        if (old) old.remove();
        var oldNoSel = document.getElementById('__screenshot_noselect');
        if (oldNoSel) oldNoSel.remove();

        var overlay = document.createElement('div');
        overlay.id = '__screenshot_area_overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;cursor:crosshair;background:rgba(19,19,16,0);transition:background 0.8s ease;';

        var box = document.createElement('div');
        box.style.cssText = 'position:absolute;border:2px dashed #00d4ff;box-shadow:0 0 0 9999px rgba(19, 19, 16, 0.65);display:none;pointer-events:none;';
        overlay.appendChild(box);

        // Etichetta dimensioni live: mostra "larghezza x altezza px" vicino al
        // rettangolo, aggiornata in tempo reale durante il trascinamento.
        var dim = document.createElement('div');
        dim.style.cssText = 'position:absolute;font-family:Segoe UI,sans-serif;font-size:12px;font-weight:700;color:#fff;background:#00d4ff;padding:3px 8px;border-radius:6px;display:none;pointer-events:none;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
        overlay.appendChild(dim);

        var info = document.createElement('div');
        info.style.cssText = 'position:fixed;top:8px;right:8px;font-family:Segoe UI,sans-serif;font-size:12px;font-weight:600;color:white;background:rgba(0,0,0,0.7);padding:8px 14px;border-radius:8px;pointer-events:none;';
        info.textContent = inMulti
          ? 'Multi Snip: drag to select a piece — it will be added to the editor'
          : 'Trascina per selezionare l\'area';
        overlay.appendChild(info);

        var startX = 0, startY_doc = 0, dragging = false;
        var currentX = 0, currentMouseY_vp = 0;

        // === AUTO-SCROLL durante il drag (Step 1) ===
        var SCROLL_TRIGGER_ZONE = 80;
        var SCROLL_SPEED_MIN = 2;
        var SCROLL_SPEED_MAX = 15;
        var lastMouseY = 0;
        // L'auto-scroll verso un bordo si attiva solo se il mouse è ENTRATO nella zona
        // venendo da fuori, non se ci era già all'inizio (es. selezione partita dalla
        // top bar, che sta nella zona di trigger superiore).
        var leftTopZone = false, leftBottomZone = false;
        var scrollRAF = null;
        var scrollTarget = null;
        var scrollTargetResolved = false;

        function resolveScrollTarget(mx, my) {
          if (scrollTargetResolved) return;
          scrollTargetResolved = true;
          // Se la finestra scrolla DAVVERO, usa window (pagine normali). Prova
          // pratica invece del confronto di altezze: sui siti col BODY-scroller
          // (es. betexplorer) il documento è alto ma window è inchiodata — lì
          // il target giusto è il body/contenitore, non la finestra.
          var y0 = window.scrollY;
          window.scrollTo({ top: (y0 > 0 ? y0 - 1 : y0 + 1), left: window.scrollX, behavior: 'instant' });
          var winMoved = window.scrollY !== y0;
          window.scrollTo({ top: y0, left: window.scrollX, behavior: 'instant' });
          if (winMoved) {
            scrollTarget = null;
            return;
          }
          // App con scroll custom (claude.ai, Notion, Gmail): parti dall'elemento
          // sotto il punto di partenza del mouse e risali fino al PRIMO contenitore
          // scrollabile. Questo becca il contenitore reale, non lo "spacer" fantasma.
          var prevPE = overlay.style.pointerEvents;
          overlay.style.pointerEvents = 'none';
          var el = document.elementFromPoint(mx, my);
          overlay.style.pointerEvents = prevPE;
          while (el && el !== document.body && el !== document.documentElement) {
            var st = window.getComputedStyle(el);
            var ov = st.overflowY;
            if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              scrollTarget = el;
              return;
            }
            el = el.parentElement;
          }
          // Fallback: il div con scrollHeight più grande (vecchio metodo)
          var all = document.querySelectorAll('*');
          var best = null;
          for (var j = 0; j < all.length; j++) {
            var e2 = all[j];
            if (e2.id === '__screenshot_area_overlay') continue;
            var s2 = window.getComputedStyle(e2);
            var o2 = s2.overflowY;
            if ((o2 === 'auto' || o2 === 'scroll') && e2.scrollHeight > e2.clientHeight + 10) {
              if (!best || e2.scrollHeight > best.scrollHeight) best = e2;
            }
          }
          scrollTarget = best;
        }

        function getScrollY() {
          return scrollTarget ? scrollTarget.scrollTop : window.scrollY;
        }

        // === Step 2: box in coordinate documento
        function updateBox() {
          var scrollY = getScrollY();
          var currentY_doc = currentMouseY_vp + scrollY;
          var top_doc = Math.min(startY_doc, currentY_doc);
          var bottom_doc = Math.max(startY_doc, currentY_doc);
          var top_vp = top_doc - scrollY;
          var height = bottom_doc - top_doc;
          var x = Math.min(currentX, startX);
          var w = Math.abs(currentX - startX);
          box.style.left = x + 'px';
          box.style.top = top_vp + 'px';
          box.style.width = w + 'px';
          box.style.height = height + 'px';

          // Etichetta dimensioni: arrotonda a interi e posiziona sopra il box
          // (o sotto, se troppo vicino al bordo alto della finestra).
          dim.textContent = Math.round(w) + ' × ' + Math.round(height) + ' px';
          dim.style.display = 'block';
          var labelTop = top_vp - 26;            // sopra il rettangolo
          if (labelTop < 4) labelTop = top_vp + 6; // niente spazio sopra -> dentro/sotto
          dim.style.left = x + 'px';
          dim.style.top = labelTop + 'px';
        }

        function autoScrollLoop() {
          if (!dragging) { scrollRAF = null; return; }
          resolveScrollTarget(currentX, currentMouseY_vp);

          var vh = window.innerHeight;
          // Aggiorna i flag: il mouse è "uscito" da una zona quando si trova fuori da essa
          if (lastMouseY >= SCROLL_TRIGGER_ZONE) leftTopZone = true;
          if (lastMouseY <= vh - SCROLL_TRIGGER_ZONE) leftBottomZone = true;
          var speed = 0;
          // TURBO: nell'ultima fascia vicino al bordo (30px) si corre forte;
          // nel resto della zona la velocita' resta dolce come prima, per
          // mirare con precisione. 10px erano troppo pochi: nella pratica il
          // mouse non ci stava mai dentro e il turbo non partiva.
          var TURBO_ZONE = 30;
          var TURBO_SPEED = 50;
          if (leftBottomZone && lastMouseY > vh - SCROLL_TRIGGER_ZONE) {
            var distFromBottom = vh - lastMouseY;
            if (distFromBottom <= TURBO_ZONE) {
              speed = TURBO_SPEED;
            } else {
              var ratio = 1 - (distFromBottom / SCROLL_TRIGGER_ZONE);
              speed = SCROLL_SPEED_MIN + ratio * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN);
            }
          } else if (leftTopZone && lastMouseY < SCROLL_TRIGGER_ZONE) {
            if (lastMouseY <= TURBO_ZONE) {
              speed = -TURBO_SPEED;
            } else {
              var ratio2 = 1 - (lastMouseY / SCROLL_TRIGGER_ZONE);
              speed = -(SCROLL_SPEED_MIN + ratio2 * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN));
            }
          }
          if (speed !== 0) {
            // behavior 'instant': su siti con CSS scroll-behavior:smooth ogni
            // scrollBy per-frame diventerebbe un'animazione che riparte da capo,
            // strozzando la velocita' reale qualunque sia il passo richiesto.
            if (scrollTarget) {
              scrollTarget.scrollBy({ top: speed, left: 0, behavior: 'instant' });
            } else {
              window.scrollBy({ top: speed, left: 0, behavior: 'instant' });
            }
            updateBox();
          }
          scrollRAF = requestAnimationFrame(autoScrollLoop);
        }

        overlay.addEventListener('mousedown', function(e) {
          // Impedisce alla trascinata di avviare la selezione NATIVA del testo
          // (evidenziatura blu sotto l'overlay quando il mouse corre più
          // veloce dell'auto-scroll o esce dalla finestra del browser).
          e.preventDefault();
          resolveScrollTarget(e.clientX, e.clientY);
          if (scrollTarget) scrollTarget.addEventListener('scroll', onScrollDuringDrag);
          // Rileva se la selezione parte dentro un elemento sticky/fixed (es. top bar):
          // in tal caso quell'elemento andrà incluso nella prima slice.
          var prevPE2 = overlay.style.pointerEvents;
          overlay.style.pointerEvents = 'none';
          var elUnder = document.elementFromPoint(e.clientX, e.clientY);
          overlay.style.pointerEvents = prevPE2;
          var oldStart = document.querySelector('[data-screenshot-start-sticky]');
          if (oldStart) oldStart.removeAttribute('data-screenshot-start-sticky');
          while (elUnder && elUnder !== document.body && elUnder !== document.documentElement) {
            var pos2 = window.getComputedStyle(elUnder).position;
            if (pos2 === 'fixed' || pos2 === 'sticky') {
              elUnder.setAttribute('data-screenshot-start-sticky', 'true');
              break;
            }
            elUnder = elUnder.parentElement;
          }
          startX = e.clientX;
          currentX = e.clientX;
          currentMouseY_vp = e.clientY;
          startY_doc = e.clientY + getScrollY();
          dragging = true;
          overlay.style.transition = 'none';
          overlay.style.background = 'transparent';
          box.style.display = 'block';
          box.style.left = e.clientX + 'px';
          box.style.top = e.clientY + 'px';
          box.style.width = '0px';
          box.style.height = '0px';
          info.style.display = 'none';
        });

        overlay.addEventListener('mousemove', function(e) {
          if (!dragging) return;
          lastMouseY = e.clientY;
          currentX = e.clientX;
          currentMouseY_vp = e.clientY;
          if (!scrollRAF) scrollRAF = requestAnimationFrame(autoScrollLoop);
          updateBox();
        });

        // Aggiorna il box quando l'utente scrolla con la rotellina durante il drag.
        // Sul window per le pagine normali; sul div scrollabile (agganciato nel
        // mousedown) per le app con scroll custom tipo claude.ai.
        function onScrollDuringDrag() {
          if (dragging) updateBox();
        }
        window.addEventListener('scroll', onScrollDuringDrag, true);

        // Su app con scroll custom (claude.ai), l'overlay copre il div scrollabile e
        // blocca la rotellina. Inoltriamo manualmente il wheel al div. Su pagine
        // normali (scrollTarget null) non facciamo nulla: la rotellina scrolla window.
        overlay.addEventListener('wheel', function(e) {
          if (dragging && scrollTarget) {
            scrollTarget.scrollTop += e.deltaY;
            e.preventDefault();
            updateBox();
          }
        }, { passive: false });

        overlay.addEventListener('mouseup', function(e) {
          if (!dragging) return;
          dragging = false;
          window.removeEventListener('scroll', onScrollDuringDrag, true);
          if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
          var endY_doc = e.clientY + getScrollY();
          var endX = e.clientX;
          var y_doc = Math.min(startY_doc, endY_doc);
          var h_doc = Math.abs(endY_doc - startY_doc);
          var x = Math.min(endX, startX);
          var w = Math.abs(endX - startX);

          if (scrollTarget) {
            scrollTarget.setAttribute('data-screenshot-area-scroll', 'true');
          }

          overlay.remove();
          var nsFine = document.getElementById('__screenshot_noselect');
          if (nsFine) nsFine.remove();
          try { window.getSelection().removeAllRanges(); } catch (errSel) {}
          if (w < 10 || h_doc < 10) {
            if (scrollTarget) scrollTarget.removeAttribute('data-screenshot-area-scroll');
            return;
          }

          window.__screenshotArea = {
            x: x,
            y_doc: y_doc,
            w: w,
            h_doc: h_doc,
            hasCustomScroll: !!scrollTarget,
            dpr: window.devicePixelRatio || 1
          };
        });

        function onKey(e) {
          if (e.key === 'Escape') {
            overlay.remove();
            var nsEsc = document.getElementById('__screenshot_noselect');
            if (nsEsc) nsEsc.remove();
            try { window.getSelection().removeAllRanges(); } catch (errSel) {}
            window.removeEventListener('scroll', onScrollDuringDrag, true);
            if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
            document.removeEventListener('keydown', onKey);
          }
        }
        document.addEventListener('keydown', onKey);
        // Cintura doppia contro la selezione del testo: per tutta la durata
        // della selezione il testo della pagina non è selezionabile (lo stile
        // viene rimosso alla chiusura dell'overlay, mouseup o Escape).
        var noSel = document.createElement('style');
        noSel.id = '__screenshot_noselect';
        noSel.textContent = '*{-webkit-user-select:none !important;user-select:none !important;}';
        (document.head || document.documentElement).appendChild(noSel);
        document.body.appendChild(overlay);
        // Avvia la dissolvenza graduale dello scuro (come lo Snipping Tool)
        void overlay.offsetWidth;
        overlay.style.background = 'rgba(19, 19, 16, 0.65)';
      }
    });

    var area = null;
    for (var attempt = 0; attempt < 120; attempt++) {
      await sleep(500);
      var result = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          var a = window.__screenshotArea;
          if (a) { window.__screenshotArea = null; return a; }
          if (!document.getElementById('__screenshot_area_overlay')) return 'cancelled';
          return null;
        }
      });
      var val = result[0].result;
      if (val === 'cancelled') {
        await resumeCssAnims(tabId);
        if (inMulti) await multiMostraWidget(tabId);  // non lasciare a piedi la sessione
        return;
      }
      if (val) { area = val; break; }
    }

    if (!area) {
      await resumeCssAnims(tabId);
      if (inMulti) await multiMostraWidget(tabId);
      return;
    }

    // === Step 3: multi-slice capture ===

    // Salva metadata iniziale (scroll attuale, viewport, offset del container scrollabile)
    var metaResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(hasCustomScroll) {
        var el = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
        var offsetX = 0, offsetY = 0;
        var containerH = window.innerHeight;
        if (el) {
          var rect = el.getBoundingClientRect();
          offsetX = rect.left;
          // clientTop: il bordo superiore dell'elemento non fa parte
          // dell'area di contenuto che scorre.
          offsetY = Math.max(0, rect.top + (el.clientTop || 0));
          // Altezza VISIBILE del contenitore: clientHeight (esclude bordi e
          // scrollbar orizzontale) e comunque non oltre il fondo dello
          // schermo. rect.height (border-box, non clampato) faceva avanzare
          // lo scroll più di quanto ogni cattura mostrava: strisce di
          // contenuto saltate a ogni giuntura.
          containerH = Math.min(el.clientHeight, window.innerHeight - offsetY);
          // Contenitore collassato o quasi fuori schermo: passo inutilizzabile,
          // ripiego sul viewport (cattura degradata ma sempre finita).
          if (!(containerH >= 50)) { containerH = window.innerHeight; offsetY = 0; }
        }
        // Spessore della barra fissa incollata al bordo superiore dell'area
        // di scroll (header di Facebook e simili): nella prima fetta resta
        // visibile di proposito e coprirebbe l'inizio della selezione. Si
        // contano solo BARRE vere (larghe almeno metà viewport, basse meno
        // del 30%), non gli overlay a schermo intero. Se la selezione è
        // partita DENTRO una barra fissa (data-screenshot-start-sticky)
        // l'utente la vuole nello scatto: nessuna compensazione.
        var topCover = 0;
        if (!document.querySelector('[data-screenshot-start-sticky]')) {
          var bordoTop = el ? offsetY : 0;
          var tutti = document.querySelectorAll('*');
          for (var k = 0; k < tutti.length; k++) {
            var pz = window.getComputedStyle(tutti[k]);
            if (pz.position !== 'fixed' && pz.position !== 'sticky') continue;
            if (pz.visibility === 'hidden' || pz.display === 'none') continue;
            var rz = tutti[k].getBoundingClientRect();
            if (rz.top <= bordoTop + 2 && rz.bottom > bordoTop &&
                rz.height < window.innerHeight * 0.3 &&
                rz.width >= window.innerWidth * 0.5) {
              var fondoBarra = rz.bottom - bordoTop;
              if (fondoBarra > topCover) topCover = fondoBarra;
            }
          }
          topCover = Math.round(topCover);
        }

        return {
          sy: el ? el.scrollTop : window.scrollY,
          vh: window.innerHeight,
          containerH: containerH,
          offsetX: offsetX,
          offsetY: offsetY,
          topCover: topCover,
          dpr: window.devicePixelRatio || 1
        };
      },
      args: [area.hasCustomScroll]
    });
    var meta = metaResult[0].result;


    // Usa l'altezza del container scrollabile (non del viewport del tab) per calcolare le slice
    var sliceH = meta.containerH;
    var numSlices = Math.ceil(area.h_doc / sliceH);

    // SELEZIONE GIÀ VISIBILE: se l'intera area selezionata sta dentro la schermata
    // attuale (non serve scrollare per vederla tutta), NON scrollo affatto: catturo
    // ciò che è già a video e ritaglio. Niente scroll = niente "scatto" verso l'alto
    // e niente header fisso che si sovrappone (era la causa del taglio sulla prima
    // pagina). Lo scroll serve solo se la selezione sfora la schermata (più slice).
    // selTopVp = dove inizia la selezione nel viewport attuale (rispetto allo scroll
    // corrente meta.sy). Se >=0 e la selezione ci sta tutta, è "già visibile".
    var selTopVp = (area.y_doc - meta.offsetY) - meta.sy;
    var giaVisibile = numSlices <= 1 && selTopVp >= -1 && (selTopVp + area.h_doc) <= sliceH + 1;

    // Scrollando ARRETRATI dello spessore della barra fissa in cima (vedi
    // sotto), ogni giro copre topCover px in meno: può servire una fetta in
    // più per arrivare al fondo della selezione.
    if (!giaVisibile && meta.topCover) {
      numSlices = Math.ceil((area.h_doc + meta.topCover) / sliceH);
    }

    var captures = [];
    var deltas = [];  // di quanto lo scroll è rimasto indietro rispetto al voluto (per slice)
    var realScrolls = [];  // scroll reale (frazionario) raggiunto da ogni slice: serve
                           // per ancorare ogni slice alla sua POSIZIONE assoluta in cucitura

    sendProgress('Cattura area...', 5);

    for (var i = 0; i < numSlices; i++) {
      var pct = Math.round(((i + 1) / numSlices) * 85) + 5;
      sendProgress('Cattura ' + (i + 1) + ' di ' + numSlices + '...', pct);

      // area.y_doc è in coordinate "viewport tab + scroll": per lo scroll del div
      // serve la coordinata interna al div, quindi sottraiamo l'offset del container.
      // Su window scroll offsetY=0, quindi invariato.
      // Se la selezione è già tutta visibile, lo scroll voluto è quello ATTUALE
      // (meta.sy): non muovo la pagina, catturo dov'è.
      var basePos = giaVisibile ? meta.sy : ((area.y_doc - meta.offsetY) + i * sliceH);
      // BARRA FISSA IN CIMA (header Facebook e simili): si scrolla ARRETRATI
      // del suo spessore. Prima fetta: la barra è visibile e coprirebbe
      // l'inizio della selezione — il delta risultante fa partire il ritaglio
      // subito SOTTO la barra. Fette successive: la barra è già nascosta dal
      // censimento sticky, ma l'arretramento uniforme tiene le fette contigue.
      var coverTop = giaVisibile ? 0 : (meta.topCover || 0);
      var wantedScroll = coverTop ? Math.max(0, basePos - coverTop) : basePos;
      var scrollResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(targetScroll, hasCustomScroll, idx) {

          // Posizione naturale di un elemento nel documento (somma offsetTop).
          // Per gli sticky resta la posizione di flusso anche da incollati.
          function absTop(el) {
            var t = 0;
            while (el) { t += el.offsetTop; el = el.offsetParent; }
            return t;
          }

          // Censimento sticky/fixed una volta sola, con visibility originale salvata.
          if (!window.__screenshotStickies) {
            window.__screenshotStickies = [];
            var scrollAnc = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
            var allEls = document.querySelectorAll('*');
            for (var k = 0; k < allEls.length; k++) {
              if (allEls[k].id === '__screenshot_area_overlay') continue;
              var p = window.getComputedStyle(allEls[k]).position;
              if (p === 'fixed' || p === 'sticky') {
                // Stesse esclusioni della Full Page: il contenitore scrollato (o
                // un suo antenato) e gli elementi a schermo quasi intero non vanno
                // mai nascosti — sono la scocca/sfondo dell'app, non barre fisse
                // da de-duplicare (nasconderli cancella il contenuto della slice).
                if (scrollAnc && allEls[k].contains(scrollAnc)) continue;
                var rc = allEls[k].getBoundingClientRect();
                if (rc.width >= window.innerWidth * 0.9 && rc.height >= window.innerHeight * 0.9) continue;
                window.__screenshotStickies.push({ el: allEls[k], oldVis: allEls[k].style.visibility });
              }
            }

            // Come nella Full Page: barre laterali/header IN-FLOW fuori dal
            // contenitore scrollato non sono fixed/sticky ma restano ancorati
            // allo schermo e si ripeterebbero in ogni slice della selezione.
            // Censisco i FIGLI dei fratelli degli antenati del contenitore
            // (lo sfondo della colonna resta); il micro-scroll di test poi li
            // conferma ancorati e li nasconde dalla slice 2 in poi. Chi si
            // sovrappone al contenitore è uno sfondo decorativo: non si tocca.
            if (scrollAnc) {
              var cr = scrollAnc.getBoundingClientRect();
              var nodeUp = scrollAnc;
              while (nodeUp && nodeUp !== document.body && nodeUp.parentElement) {
                var par = nodeUp.parentElement;
                for (var q = 0; q < par.children.length; q++) {
                  var sib = par.children[q];
                  if (sib === nodeUp || sib.contains(scrollAnc)) continue;
                  if (sib.id === '__screenshot_area_overlay') continue;
                  var sr = sib.getBoundingClientRect();
                  var iw = Math.min(sr.right, cr.right) - Math.max(sr.left, cr.left);
                  var ih = Math.min(sr.bottom, cr.bottom) - Math.max(sr.top, cr.top);
                  if (iw > 8 && ih > 8) continue;
                  for (var w = 0; w < sib.children.length; w++) {
                    window.__screenshotStickies.push({
                      el: sib.children[w],
                      oldVis: sib.children[w].style.visibility
                    });
                  }
                }
                nodeUp = par;
              }
            }
          }

          // Gestione robusta indipendente dal CSS: per capire se un elemento è
          // ancorato al viewport (da nascondere) o sta scorrendo (da mostrare),
          // faccio un micro-scroll di test e guardo se l'elemento si muove.
          // Non si muove -> ancorato (fixed o sticky incollato) -> nascondi.
          // L'elemento di partenza è forzato visibile nella prima slice.
          function manageStickies(scrollNow, hasCustomScroll) {
            var scrollEl = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
            function getS() { return scrollEl ? scrollEl.scrollTop : window.scrollY; }
            function setS(v) { if (scrollEl) { scrollEl.scrollTop = v; } else { window.scrollTo(0, v); } }
            // ripristina la visibility originale di tutti
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              window.__screenshotStickies[s].el.style.visibility = window.__screenshotStickies[s].oldVis;
            }
            var base = getS();
            var tops1 = [];
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              tops1.push(window.__screenshotStickies[s].el.getBoundingClientRect().top);
            }
            // micro-scroll di test (indietro se possibile, sennò avanti)
            var probe = (base > 20) ? base - 12 : base + 12;
            setS(probe);
            var realProbe = getS();
            var tops2 = [];
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              tops2.push(window.__screenshotStickies[s].el.getBoundingClientRect().top);
            }
            setS(base); // ripristina lo scroll esatto della slice
            var scrollMoved = Math.abs(realProbe - base) > 1;
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              var E = window.__screenshotStickies[s].el;
              // PRIMA SLICE: non nascondo MAI gli sticky. In cima alla pagina top-bar
              // e barre tipo "Oggi/Domani/Dopodomani" sono al loro posto reale e vanno
              // tenute. La duplicazione degli sticky (che giustifica il nascondere) si
              // verifica solo dalle slice successive, quando lo scroll li reincolla.
              // Senza questo, su selezioni che restano nella prima schermata quelle
              // barre sparivano per sbaglio (il micro-scroll di test le marcava
              // ancorate e le nascondeva).
              if (idx === 0) continue;
              // ancorato = lo scroll è cambiato ma la posizione dell'elemento no
              var anchored = scrollMoved && (Math.abs(tops1[s] - tops2[s]) < 2);
              if (anchored) E.style.visibility = 'hidden';
            }
          }

          var el = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
          if (el) {
            el.scrollTop = targetScroll;
          } else {
            window.scrollTo(0, targetScroll);
          }
          return new Promise(function(resolve) {
            var checks = 0;
            var lastCy = -1;
            var interval = setInterval(function() {
              var cy = hasCustomScroll
                ? document.querySelector('[data-screenshot-area-scroll]').scrollTop
                : window.scrollY;
              checks++;
              // Risolvi se: raggiunto il target, OPPURE lo scroll non si muove più
              // (clampato al fondo), OPPURE timeout
              var reachedTarget = Math.abs(cy - targetScroll) < 2;
              var stuck = (checks > 3 && Math.abs(cy - lastCy) < 1);
              lastCy = cy;
              if (reachedTarget || stuck || checks > 30) {
                clearInterval(interval);
                manageStickies(cy, hasCustomScroll);
                resolve(cy);
              }
            }, 50);
          });
        },
        args: [wantedScroll, area.hasCustomScroll, i]
      });
      var realScroll = scrollResult[0].result;
      // Prima fetta: delta misurato rispetto alla posizione NON arretrata,
      // così il ritaglio parte sotto la barra fissa (delta = spessore barra).
      // Fette successive: rispetto al target arretrato (delta 0 se raggiunto).
      deltas.push((i === 0 ? basePos : wantedScroll) - realScroll);
      realScrolls.push(realScroll);  // posizione assoluta reale di questa slice

      // LOG DIAGNOSTICO problema "selezione corta in fondo cattura piu in alto":
      console.log('[AREA slice ' + i + '/' + (numSlices-1) + '] wantedScroll=' + wantedScroll +
        ' realScroll=' + realScroll + ' DELTA(voluto-reale)=' + (wantedScroll - realScroll) +
        ' | area.y_doc=' + area.y_doc + ' offsetY=' + meta.offsetY +
        ' sliceH=' + sliceH + ' h_doc=' + area.h_doc);

      await sleep(350);

      var dataUrl = null;
      for (var retry = 0; retry < 3; retry++) {
        try {
          dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
          break;
        } catch (captureErr) {
          if (retry < 2 && captureErr.message.indexOf('MAX_CAPTURE') !== -1) {
            await sleep(600);
          } else {
            throw captureErr;
          }
        }
      }
      captures.push(dataUrl);
    }

    sendProgress('Composizione...', 92);

    // Cuci le slice in un canvas finale, croppato sui bound X
    // Se hasCustomScroll, sposta la source per saltare l'offset del container
    var compResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(imgs, ax, aw, ah_doc, viewH, ratio, offsetX, offsetY, deltas, realScrolls, selTopVpVisibile, contH) {
        function loadImg(src) {
          return new Promise(function(res, rej) {
            var im = new Image();
            im.onload = function() { res(im); };
            im.onerror = rej;
            im.src = src;
          });
        }

        return Promise.all(imgs.map(loadImg)).then(function(loaded) {
          var total = loaded.length;
          var realRatio = loaded[0].height / viewH;

          // Crop orizzontale: solo la colonna selezionata (X), in pixel reali.
          var sx = Math.round(ax * realRatio);
          var sw = Math.round(aw * realRatio);
          var offY = Math.round(offsetY * realRatio);

          // Estraggo da ogni cattura SOLO la colonna selezionata (sx..sx+sw) e la
          // parte utile (da offY in giù), in un canvas per slice. Lavoro su questi.
          // COMPENSAZIONE SCROLL-CLAMP: quando lo scroll voluto supera il fondo
          // pagina, la cattura si ferma prima (deltas[idx] > 0) e il contenuto
          // voluto appare più IN BASSO nella schermata di quanto previsto. Per
          // quella slice il ritaglio verticale deve partire da offY + delta, così
          // si prende il punto giusto e non uno più in alto. (Caso tipico:
          // selezione corta in fondo pagina = una sola slice con delta grande.)
          // SELEZIONE GIÀ VISIBILE: se selTopVpVisibile>=0, NON abbiamo scrollato
          // e la selezione sta a quei px dall'alto della cattura. Il ritaglio parte
          // esattamente da lì (e prende solo l'altezza selezionata): è il punto giusto
          // così com'è a video, senza scroll né compensazioni. Una sola slice.
          var visStart = (typeof selTopVpVisibile === 'number' && selTopVpVisibile >= 0)
            ? Math.round(selTopVpVisibile * realRatio) : -1;
          var sliceCanvases = loaded.map(function(img, idx) {
            var startY;
            if (visStart >= 0) {
              startY = offY + visStart;
            } else {
              var deltaPx = (deltas && deltas[idx] > 0) ? Math.round(deltas[idx] * realRatio) : 0;
              startY = offY + deltaPx;
            }
            if (startY > img.height - 1) startY = img.height - 1;
            // FONDO UTILE: il contenitore finisce a offY + contH (px reali).
            // Quello che sta SOTTO (margini, footer fuori dal contenitore)
            // non scrolla mai: se lasciato nelle slice, all'ultima giuntura
            // veniva incollato nel composito al posto del contenuto vero.
            var fondo = Math.min(img.height, offY + Math.round(contH * realRatio));
            if (fondo <= startY) fondo = img.height;
            var hUtile = fondo - startY;
            var c = document.createElement('canvas');
            c.width = sw; c.height = hUtile;
            c.getContext('2d').drawImage(img, sx, startY, sw, hUtile, 0, 0, sw, hUtile);
            return c;
          });

          // Canvas finale: largo sw, alto abbondante (somma altezze). Ritaglio dopo.
          var maxH = 0;
          sliceCanvases.forEach(function(c) { maxH += c.height; });
          var canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = maxH;
          var ctx = canvas.getContext('2d');

          // ALLINEAMENTO PER CONTENUTO: confronto i pixel per trovare la
          // sovrapposizione reale tra una slice e la successiva, e cucio lì.
          // Indipendente dallo zoom: non mi fido di nessun numero calcolato.
          function rowsOf(cnv) {
            return cnv.getContext('2d').getImageData(0, 0, cnv.width, cnv.height).data;
          }
          // Trova di quanti px la slice "sotto" va sovrapposta alla "sopra".
          // Cerca SOLO in una finestra STRETTA attorno all'overlap ATTESO (dallo
          // scroll reale): così non si aggancia a falsi match su testo ripetitivo
          // (causa del troncamento/sovrapposizione sulle selezioni lunghe).
          function trovaOverlap(prevData, prevW, prevH, nextCnv, atteso) {
            var nextData = rowsOf(nextCnv);
            var bandH = Math.min(40, nextCnv.height, prevH);  // banda di confronto
            var WIN = 6;  // cerca solo da (atteso-6) a (atteso+6)
            var lo = Math.max(1, atteso - WIN);
            var hi = Math.min(nextCnv.height - 1, atteso + WIN);
            var bestOff = atteso, bestScore = Infinity;
            for (var off = lo; off <= hi; off++) {
              var score = 0, cnt = 0;
              for (var by = 0; by < bandH; by++) {
                var prevY = prevH - off + by;
                if (prevY < 0 || prevY >= prevH) { score = Infinity; break; }
                var pi = (prevY * prevW) * 4;
                var ni = (by * nextCnv.width) * 4;
                var dr = prevData[pi] - nextData[ni];
                var dg = prevData[pi+1] - nextData[ni+1];
                var db = prevData[pi+2] - nextData[ni+2];
                score += dr*dr + dg*dg + db*db;
                cnt++;
              }
              if (cnt > 0) { score = score / cnt; if (score < bestScore) { bestScore = score; bestOff = off; } }
            }
            return bestOff;
          }

          // Disegno la prima slice intera.
          ctx.drawImage(sliceCanvases[0], 0, 0);
          var cursorY = sliceCanvases[0].height;  // dove finisce il contenuto buono

          for (var i = 1; i < total; i++) {
            var prev = ctx.getImageData(0, 0, sw, canvas.height).data;
            // Overlap ATTESO = altezza catturata - quanto la pagina è avanzata
            // davvero tra questa slice e la precedente (in pixel reali).
            var avanzReal = (realScrolls[i] - realScrolls[i - 1]) * realRatio;
            var atteso = Math.round(sliceCanvases[i].height - avanzReal);
            if (atteso < 1) atteso = 1;
            if (atteso > sliceCanvases[i].height - 1) atteso = sliceCanvases[i].height - 1;
            var overlap = trovaOverlap(prev, sw, cursorY, sliceCanvases[i], atteso);
            var c = sliceCanvases[i];
            var last = (i === total - 1);

            if (!last) {
              // Slice intermedie: SOVRAPPONGO (disegno intera partendo da
              // cursorY-overlap). Questo dà le giunzioni pulite.
              var destY = cursorY - overlap;
              ctx.drawImage(c, 0, destY);
              cursorY = destY + c.height;
            } else {
              // ULTIMA slice: a fondo pagina lo scroll si blocca, quindi questa
              // cattura ripete in alto una fascia già presente — che può contenere
              // i menu sticky laterali. Disegno SOLO la parte nuova (sotto
              // l'overlap), così quei menu non vengono reincollati sopra l'area.
              var srcStart = overlap;
              var nuovaH = c.height - srcStart;
              if (nuovaH > 0) {
                ctx.drawImage(c, 0, srcStart, c.width, nuovaH, 0, cursorY, c.width, nuovaH);
                cursorY = cursorY + nuovaH;
              }
            }
          }

          // Altezza ESATTA richiesta dall'utente (area selezionata, in px reali).
          var targetH = Math.round(ah_doc * realRatio);

          // CORREZIONE ACCUMULO: su pagine lunghe l'overlap stimato è un filo alto
          // per ogni giunzione, quindi cursorY risulta più corto di targetH e il
          // fondo verrebbe tagliato (taglio che CRESCE col numero di slice). Se
          // manca contenuto, lo recupero disegnando il pezzo mancante dal FONDO
          // dell'ultima cattura (i menu sticky stanno in alto, restano fuori).
          if (cursorY < targetH) {
            var lastC = sliceCanvases[total - 1];
            var manca = targetH - cursorY;
            if (manca > lastC.height) manca = lastC.height;
            var from = lastC.height - manca;  // dal fondo della cattura
            ctx.drawImage(lastC, 0, from, lastC.width, manca, 0, cursorY, lastC.width, manca);
            cursorY += manca;
          }

          var finalH = Math.min(targetH, cursorY);
          var out = document.createElement('canvas');
          out.width = sw;
          out.height = finalH;
          out.getContext('2d').drawImage(canvas, 0, 0);
          return out.toDataURL('image/png');
        });
      },
      // NB: come viewH si passa l'altezza del VIEWPORT (meta.vh), non sliceH:
      // il rapporto CSS->pixel reali va calcolato sull'altezza della finestra,
      // perché la cattura è alta quanto la finestra. Con un contenitore più
      // basso del viewport (console Mistral) usare sliceH gonfiava il rapporto
      // e il ritaglio usciva spostato rispetto alla selezione.
      args: [captures, area.x, area.w, area.h_doc, meta.vh, meta.dpr, meta.offsetX, meta.offsetY, deltas, realScrolls, (giaVisibile ? Math.max(0, selTopVp) : -1), meta.containerH]
    });

    // MULTI SNIP: a sessione attiva il pezzo va all'editor, non al download.
    var multiA = await multiSessione();
    if (multiA && multiA.active) {
      await multiAggiungiPezzo(compResult[0].result, tabId, 'area');
    } else {
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      chrome.downloads.download({
        url: compResult[0].result,
        filename: 'screenshots/screenshot_' + ts + '.png',
        saveAs: false
      });

      await copyToClipboard(compResult[0].result, tabId);
    }

    // Ripristino: visibility dei fixed/sticky + pagina riportata IN CIMA.
    // (Richiesta esplicita: a fine cattura Area si torna in alto come nella
    // Full Page, invece di restare in fondo dove il drag con auto-scroll
    // aveva lasciato la pagina.)
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(hasCustomScroll) {
        if (window.__screenshotStickies) {
          for (var k = 0; k < window.__screenshotStickies.length; k++) {
            var item = window.__screenshotStickies[k];
            item.el.style.visibility = item.oldVis;
          }
          window.__screenshotStickies = null;
        }
        var startMark = document.querySelector('[data-screenshot-start-sticky]');
        if (startMark) startMark.removeAttribute('data-screenshot-start-sticky');
        var el = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
        if (el) {
          el.scrollTop = 0;
          el.removeAttribute('data-screenshot-area-scroll');
        } else {
          window.scrollTo(0, 0);
        }
      },
      args: [area.hasCustomScroll]
    });

    await resumeCssAnims(tabId);
    sendSuccess();
    if (!(multiA && multiA.active)) {
      await showBollino(tabId, true);
      await registraCatturaRiuscita(tabId);
    }

  } catch (err) {
    console.error('Area screenshot error:', err);
    await resumeCssAnims(tabId);
    // FALLBACK: su pagine non iniettabili (chrome://, errore) catturo il visibile.
    if (isPaginaNonIniettabile(err)) { await doVisibleCapture(tabId); return; }
    sendError(err.message);
    await showBollino(tabId, false, err.message);
  }
}
