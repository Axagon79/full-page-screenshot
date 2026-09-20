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
var ultimaFotoLente = 0;
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  // La lente dell'overlay area chiede una foto fresca del viewport dopo
  // uno scroll. Rate-limitata: captureVisibleTab regge ~2 chiamate/sec.
  if (msg.action === 'lenteRicattura') {
    var ora = Date.now();
    if (ora - ultimaFotoLente < 500) { sendResponse(null); return; }
    ultimaFotoLente = ora;
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
      void chrome.runtime.lastError;
      sendResponse(dataUrl ? { img: dataUrl } : null);
    });
    return true;  // risposta asincrona
  }
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
  // Ctrl+V nell'editor: un'immagine dagli appunti entra in sessione come
  // pezzo (import universale: DevTools via Win+Shift+S, altre app, ecc.).
  if (msg.action === 'multiIncolla') {
    conSessione(async function() {
      var m = await multiSessione();
      if (!m) return;
      m.trash = [];  // e' una nuova aggiunta: azzera il redo come le catture
      m.nextId = (m.nextId || 0) + 1;
      m.pieces.push({ img: msg.img, tipo: 'paste', id: m.nextId });
      try {
        await chrome.storage.session.set({ multi: m });
      } catch (quotaErr) {
        try {
          var ridotto = await comprimiInJpeg(msg.img);
          m.pieces[m.pieces.length - 1].img = ridotto;
          await chrome.storage.session.set({ multi: m });
        } catch (e2) {
          m.pieces.pop();
          await chrome.storage.session.set({ multi: m });
          return;
        }
      }
      await multiAggiornaBadge();
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
  // L'editor ha salvato (o annullato): la sessione si chiude. In coda,
  // così una cattura in smaltimento non può risuscitarla riscrivendola.
  if (msg.action === 'multiDone') {
    conSessione(async function() {
      await chrome.storage.session.remove('multi');
      await multiAggiornaBadge();
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

// Scheda sotto cattura multi (null = nessuna): SOLO su quella scheda il
// pannellino non va re-iniettato, sennò finisce fotografato dentro il
// pezzo. Sulle altre schede il pannellino continua a seguire l'utente.
var multiCatturaTab = null;

// True solo se l'ultima cattura è stata chiesta DALL'editor (+ Add piece):
// in quel caso, a pezzo salvato, si torna all'editor. Se invece è partita
// dal pannellino su una pagina, si resta lì a raccogliere.
var multiTornaAllEditor = false;

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
// Tutto in coda: la riscrittura di editorTabId non deve mai clobberare un
// pezzo salvato (o un undo) avvenuto tra la lettura e la scrittura.
async function multiMostraEditor() {
  return conSessione(async function() {
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
    m = (await multiSessione()) || m;  // rileggi: la coda ha solo noi, ma tabs.create è lento
    m.editorTabId = tab.id;
    await chrome.storage.session.set({ multi: m });
  });
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
  if (editorVivo && multiTornaAllEditor) {
    // La cattura era stata chiesta dall'editor: si torna lì.
    try { await chrome.tabs.update(m.editorTabId, { active: true }); } catch (e) {}
  } else {
    // Cattura dal pannellino: si resta sulla pagina a raccogliere; l'editor
    // (anche aperto in background) riceve comunque il pezzo via storage.
    await multiMostraWidget(tabId);
  }
  multiTornaAllEditor = false;
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
  // La parte che TOCCA la sessione passa dalla coda (niente clobber di
  // pezzi/cestino concorrenti); la cattura vera resta fuori dalla coda.
  var m = await conSessione(async function() {
    var mm = await multiSessione();
    if (!mm) return null;
    // Se il click arriva dal widget su una scheda qualunque (pannellino che
    // segue tra le tab), è QUELLA la pagina da catturare.
    if (daTabId != null && daTabId !== mm.editorTabId && daTabId !== mm.sourceTabId) {
      mm.sourceTabId = daTabId;
      await chrome.storage.session.set({ multi: mm });
    }
    return mm;
  });
  if (!m) return;
  multiTornaAllEditor = (daTabId != null && m.editorTabId != null && daTabId === m.editorTabId);
  try {
    var tab = await chrome.tabs.get(m.sourceTabId);
    await chrome.tabs.update(m.sourceTabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (tabSparita) {
    return; // la pagina di origine non esiste più: niente da catturare
  }
  // Il pannellino NON deve finire dentro lo screenshot: via dalla pagina
  // prima dello scatto (e niente re-iniezioni su QUESTA scheda intanto).
  multiCatturaTab = m.sourceTabId;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: m.sourceTabId },
      func: function() {
        var el = document.getElementById('__shot_multi_widget');
        if (el) el.remove();
      }
    });
  } catch (nonIniettabile) {}
  await sleep(300);  // lascia alla scheda il tempo di tornare a fuoco
  await pauseCssAnims(m.sourceTabId);
  try {
    if (kind === 'full') {
      await doFullCapture(m.sourceTabId);
    } else if (kind === 'visible') {
      await doVisibleCapture(m.sourceTabId);
    } else {
      await doAreaCapture(m.sourceTabId);
    }
  } finally {
    multiCatturaTab = null;
  }
}

// Se l'utente chiude la scheda dell'editor, la sessione muore con lei:
// le catture successive tornano al normale scarica+copia.
chrome.tabs.onRemoved.addListener(function(tabId) {
  conSessione(async function() {
    var m = await multiSessione();
    if (m && m.editorTabId === tabId) {
      await chrome.storage.session.remove('multi');
      await multiAggiornaBadge();
      multiRimuoviWidgetOvunque();
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
// Fermo durante le catture: non deve finire dentro lo screenshot.
chrome.tabs.onActivated.addListener(function(info) {
  if (info.tabId === multiCatturaTab) return;
  multiSessione().then(function(m) {
    if (!m || !m.active || info.tabId === m.editorTabId) return;
    multiPuoSeguire().then(function(ok) {
      if (ok && info.tabId !== multiCatturaTab) multiMostraWidget(info.tabId);
    });
  });
});

// Fine caricamento pagina: il widget non sopravvive alle navigazioni,
// quindi sulla scheda attiva lo si ripianta (mai durante una cattura).
chrome.tabs.onUpdated.addListener(function(tabId, change, tab) {
  if (change.status !== 'complete' || !tab || !tab.active) return;
  if (tabId === multiCatturaTab) return;
  multiSessione().then(function(m) {
    if (!m || !m.active || tabId === m.editorTabId) return;
    multiPuoSeguire().then(function(ok) {
      if (ok && tabId !== multiCatturaTab) multiMostraWidget(tabId);
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
            // Niente scrollbar nelle foto: TUTTI gli scroller (finestra,
            // contenitore marcato E annidati — le webmail ne hanno a strati).
            // La regola entra all'inizio della cattura, PRIMA di misure e
            // overlay: il reflow da ~15px avviene una volta sola e poi la
            // geometria resta coerente per tutta la sessione di cattura.
            '*{scrollbar-width:none !important;}' +
            '*::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important;}';
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

// I fondi decorativi fissi a tutta finestra non vanno nascosti come gli header:
// nelle catture lunghe li ancoriamo al documento, evitando la ripetizione del
// gradiente a ogni fetta. Solo sfondi esplicitamente decorativi; MAI scocche di
// app, popup o contenitori che scorrono. Visible e catture interne non passano qui.
async function prepareCaptureBackgrounds(tabId) {
  var result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      if (window.__screenshotBackgrounds) window.__screenshotBackgrounds.restore();
      if (!document.body) return false;
      var pageHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (pageHeight <= window.innerHeight + 1) return false;

      // Un overlay modale puo avere gli stessi attributi di un fondo. Quando
      // c'e un dialogo visibile lasciamo intatta tutta la sua composizione.
      var dialogs = document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]');
      for (var d = 0; d < dialogs.length; d++) {
        var ds = getComputedStyle(dialogs[d]);
        var dr = dialogs[d].getBoundingClientRect();
        if (ds.display !== 'none' && ds.visibility !== 'hidden' && Number(ds.opacity) > 0 &&
            dr.width > 0 && dr.height > 0 && dr.bottom > 0 && dr.top < innerHeight &&
            dr.right > 0 && dr.left < innerWidth) return false;
      }
      function transformed(css) {
        return css.transform !== 'none' || css.perspective !== 'none' ||
          css.filter !== 'none' || (css.backdropFilter && css.backdropFilter !== 'none') ||
          (css.translate && css.translate !== 'none') ||
          (css.rotate && css.rotate !== 'none') || (css.scale && css.scale !== 'none') ||
          /transform|perspective|filter/.test(css.willChange) ||
          /paint|layout|strict|content/.test(css.contain) ||
          (css.contentVisibility && css.contentVisibility !== 'visible');
      }
      if (transformed(getComputedStyle(document.body)) ||
          transformed(getComputedStyle(document.documentElement))) return false;

      var properties = ['top', 'bottom', 'left', 'right', 'width', 'height',
        'min-height', 'max-height', 'box-sizing', 'transition-property',
        'margin-top', 'margin-bottom', 'margin-left', 'margin-right'];
      var records = [];
      var contentSelector = 'a,button,input,textarea,select,iframe,video,audio,canvas,' +
        'main,nav,header,footer,[tabindex],[contenteditable]:not([contenteditable="false"]),' +
        '[role]:not([role="presentation"]):not([role="none"])';
      for (var c = 0; c < document.body.children.length; c++) {
        var el = document.body.children[c];
        var css = getComputedStyle(el);
        if (el.getAttribute('aria-hidden') !== 'true' || css.pointerEvents !== 'none' ||
            css.position !== 'fixed' || css.display === 'none' || css.visibility === 'hidden' ||
            !(Number(css.opacity) > 0) || !(parseInt(css.zIndex, 10) <= 0) || transformed(css)) continue;
        var rect = el.getBoundingClientRect();
        if (Math.abs(rect.top) > 2 || Math.abs(rect.left) > 2 ||
            Math.abs(rect.width - innerWidth) > 2 || Math.abs(rect.height - innerHeight) > 2) continue;
        if (el.textContent.trim() || el.matches(contentSelector) || el.querySelector(contentSelector)) continue;
        var descendants = [el].concat(Array.from(el.querySelectorAll('*')));
        var unsafe = false;
        for (var n = 0; n < descendants.length; n++) {
          var child = descendants[n];
          var cs = getComputedStyle(child);
          if (child.shadowRoot || cs.pointerEvents !== 'none' ||
              ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && child.scrollHeight > child.clientHeight + 1) ||
              ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && child.scrollWidth > child.clientWidth + 1)) {
            unsafe = true;
            break;
          }
        }
        if (unsafe) continue;
        records.push({ el: el, top: rect.top, left: rect.left + window.scrollX, width: rect.width,
          hadStyle: el.hasAttribute('style'), original: properties.map(function(name) {
            return { name: name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name) };
          }) });
      }
      if (!records.length) return false;

      // Restano fixed: nessun reflow, nessuna nuova altezza di scroll, nessun
      // elemento spostato nel DOM. Le coordinate percentuali dei decori vengono
      // distribuite una sola volta sull'altezza del documento, congelata qui.
      var state = {
        sync: function() {
          records.forEach(function(rec) {
            rec.el.style.setProperty('top', (rec.top - window.scrollY) + 'px', 'important');
            rec.el.style.setProperty('left', (rec.left - window.scrollX) + 'px', 'important');
          });
        },
        restore: function() {
          window.removeEventListener('scroll', state.sync);
          records.forEach(function(rec) {
            rec.original.forEach(function(prop) {
              if (prop.value) rec.el.style.setProperty(prop.name, prop.value, prop.priority);
              else rec.el.style.removeProperty(prop.name);
            });
            if (!rec.hadStyle && !rec.el.style.cssText) rec.el.removeAttribute('style');
          });
          delete window.__screenshotBackgrounds;
        }
      };
      window.__screenshotBackgrounds = state;
      try {
        records.forEach(function(rec) {
          var style = rec.el.style;
          style.setProperty('transition-property', 'none', 'important');
          style.setProperty('box-sizing', 'border-box', 'important');
          style.setProperty('width', rec.width + 'px', 'important');
          style.setProperty('height', pageHeight + 'px', 'important');
          style.setProperty('min-height', '0', 'important');
          style.setProperty('max-height', 'none', 'important');
          style.setProperty('bottom', 'auto', 'important');
          style.setProperty('right', 'auto', 'important');
          ['margin-top', 'margin-bottom', 'margin-left', 'margin-right'].forEach(function(name) {
            style.setProperty(name, '0', 'important');
          });
        });
        state.sync();
        window.addEventListener('scroll', state.sync, { passive: true });
        return true;
      } catch (err) {
        state.restore();
        throw err;
      }
    }
  });
  return !!(result && result[0] && result[0].result);
}

async function syncCaptureBackgrounds(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      if (!window.__screenshotBackgrounds) return;
      window.__screenshotBackgrounds.sync();
      // Il listener scroll puo arrivare tardi: allinea anche esplicitamente
      // dopo il micro-scroll degli header e attendi il disegno prima della foto.
      return new Promise(function(resolve) {
        var frameId;
        var timeoutId;
        function done() {
          cancelAnimationFrame(frameId);
          clearTimeout(timeoutId);
          resolve();
        }
        // Le schede in secondo piano possono sospendere requestAnimationFrame:
        // non lasciare mai la cattura bloccata nell'attesa del disegno.
        timeoutId = setTimeout(done, 250);
        frameId = requestAnimationFrame(function() { frameId = requestAnimationFrame(done); });
      });
    }
  });
}

async function restoreCaptureBackgrounds(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        if (window.__screenshotBackgrounds) window.__screenshotBackgrounds.restore();
      }
    });
  } catch (closedTab) {}
}

// Un discendente con transition:all puo restare visibile per mezzo secondo
// anche se il suo header ha gia visibility:hidden. Solo DURANTE lo scatto
// azzeriamo l'opacita degli elementi gia esclusi: si oscura
// l'intero sottalbero (anche shadow DOM), senza alterarne dimensioni o scroll.
async function captureStitchedFrame(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var records = [];
        window.__screenshotCaptureMasks = records;
        var list = (window.__screenshotHidden || []).concat(window.__screenshotStickies || []);
        var seen = new Set();
        list.forEach(function(item) {
          var el = item.el;
          if (!item.hiddenByCapture || !el.isConnected || el.style.visibility !== 'hidden' || seen.has(el)) return;
          seen.add(el);
          records.push({ el: el,
            opacity: el.style.getPropertyValue('opacity'),
            opacityPriority: el.style.getPropertyPriority('opacity') });
          el.style.setProperty('opacity', '0', 'important');
          // Termina SOLO la dissolvenza della maschera appena applicata.
          // transition:none fermerebbe anche altezza/posizione, cambiando
          // la geometria della pagina durante lo scatto.
          el.getAnimations().forEach(function(animation) {
            if (animation.transitionProperty === 'opacity' && animation.effect &&
                animation.effect.target === el && !animation.effect.pseudoElement) {
              try { animation.finish(); }
              catch (pausedTransition) { animation.cancel(); }
            }
          });
        });
        if (!records.length) return;
        return new Promise(function(resolve) {
          var frameId;
          var timeoutId;
          function done() {
            cancelAnimationFrame(frameId);
            clearTimeout(timeoutId);
            resolve();
          }
          timeoutId = setTimeout(done, 250);
          frameId = requestAnimationFrame(function() { frameId = requestAnimationFrame(done); });
        });
      }
    });
    return await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  } finally {
    // Anche quota di cattura, errore o cambio pagina devono lasciare il sito
    // com'era. Non si ripristina l'intero style: solo l'opacita toccata.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          (window.__screenshotCaptureMasks || []).forEach(function(rec) {
            if (rec.opacity) rec.el.style.setProperty('opacity', rec.opacity, rec.opacityPriority);
            else rec.el.style.removeProperty('opacity');
            rec.el.getAnimations().forEach(function(animation) {
              if (animation.transitionProperty === 'opacity' && animation.effect &&
                  animation.effect.target === rec.el && !animation.effect.pseudoElement) {
                try { animation.finish(); }
                catch (pausedTransition) { animation.cancel(); }
              }
            });
          });
          delete window.__screenshotCaptureMasks;
        }
      });
    } catch (closedTab) {}
  }
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
async function cleanupMultiPaneCapture(tabId, panesData) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(savedPanes) {
      var fixed = window.__screenshotMultiFixed || [];
      for (var f = 0; f < fixed.length; f++) fixed[f].el.style.visibility = fixed[f].oldVisibility;
      window.__screenshotMultiFixed = null;
      for (var i = 0; i < savedPanes.length; i++) {
        var pane = document.querySelector('[data-screenshot-pane="' + savedPanes[i].index + '"]');
        if (!pane) continue;
        pane.scrollTop = savedPanes[i].oldScroll;
        pane.removeAttribute('data-screenshot-pane');
      }
    },
    args: [panesData || []]
  });
}

async function doMultiPaneFullCapture(tabId, d) {
  var positions = [0];
  for (var y = d.stepH; y < d.maxScroll; y += d.stepH) positions.push(y);
  if (d.maxScroll > 0 && positions[positions.length - 1] !== d.maxScroll) positions.push(d.maxScroll);

  var captures = [];
  var paneScrolls = [];

  for (var row = 0; row < positions.length; row++) {
    var pct = Math.round(((row + 1) / positions.length) * 85) + 5;
    sendProgress('Cattura ' + (row + 1) + ' di ' + positions.length + '...', pct);

    var moved = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(targetY, rowIndex) {
        var panes = Array.prototype.slice.call(document.querySelectorAll('[data-screenshot-pane]'));
        panes.sort(function(a, b) {
          return Number(a.getAttribute('data-screenshot-pane')) - Number(b.getAttribute('data-screenshot-pane'));
        });

        if (rowIndex === 0) {
          window.__screenshotMultiFixed = [];
          var all = document.querySelectorAll('*');
          for (var k = 0; k < all.length; k++) {
            var css = window.getComputedStyle(all[k]);
            if (css.position !== 'fixed' && css.position !== 'sticky') continue;
            var contienePane = false;
            for (var pa = 0; pa < panes.length; pa++) {
              if (all[k].contains(panes[pa])) { contienePane = true; break; }
            }
            if (contienePane) continue;
            var r = all[k].getBoundingClientRect();
            if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) continue;
            if (r.width <= 0 || r.height <= 0) continue;

            var paneIndex = -1;
            var bestOverlap = 0;
            var isBottom = false;
            for (var p = 0; p < panes.length; p++) {
              var pr = panes[p].getBoundingClientRect();
              var overlap = Math.max(0, Math.min(r.right, pr.right) - Math.max(r.left, pr.left));
              if (overlap > bestOverlap) {
                bestOverlap = overlap;
                paneIndex = p;
                isBottom = Math.abs(pr.bottom - r.bottom) < Math.abs(r.top - pr.top);
              }
            }
            window.__screenshotMultiFixed.push({
              el: all[k],
              oldVisibility: all[k].style.visibility,
              paneIndex: paneIndex,
              bottom: bestOverlap > 0 && isBottom
            });
          }
        }

        var fixed = window.__screenshotMultiFixed || [];
        for (var f = 0; f < fixed.length; f++) {
          fixed[f].el.style.visibility = fixed[f].oldVisibility;
          if (fixed[f].bottom || rowIndex > 0) fixed[f].el.style.visibility = 'hidden';
        }

        for (var i = 0; i < panes.length; i++) {
          panes[i].scrollTop = Math.min(targetY, Math.max(0, panes[i].scrollHeight - panes[i].clientHeight));
        }

        return new Promise(function(resolve) {
          var last = [];
          var stable = 0;
          var checks = 0;
          var timer = setInterval(function() {
            var now = [];
            var same = true;
            for (var j = 0; j < panes.length; j++) {
              now.push(panes[j].scrollTop);
              if (typeof last[j] !== 'number' || Math.abs(last[j] - now[j]) >= 1) same = false;
            }
            stable = same ? stable + 1 : 0;
            last = now;
            checks++;
            if (stable >= 2 || checks > 30) {
              clearInterval(timer);
              resolve(now);
            }
          }, 50);
        });
      },
      args: [positions[row], row]
    });

    paneScrolls.push(moved[0].result);
    await sleep(350);
    var shot = null;
    for (var retry = 0; retry < 3; retry++) {
      try {
        shot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        break;
      } catch (captureErr) {
        if (retry < 2 && captureErr.message.indexOf('MAX_CAPTURE') !== -1) {
          await sleep(600);
        } else {
          throw captureErr;
        }
      }
    }
    captures.push(shot);
  }

  // Ripresa separata delle barre inferiori, con ogni pannello al proprio fondo.
  var bottomMetaResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      var panes = Array.prototype.slice.call(document.querySelectorAll('[data-screenshot-pane]'));
      panes.sort(function(a, b) {
        return Number(a.getAttribute('data-screenshot-pane')) - Number(b.getAttribute('data-screenshot-pane'));
      });
      var fixed = window.__screenshotMultiFixed || [];
      var tops = [];
      for (var p = 0; p < panes.length; p++) tops.push(null);
      for (var f = 0; f < fixed.length; f++) {
        if (!fixed[f].bottom) continue;
        fixed[f].el.style.visibility = fixed[f].oldVisibility;
        var r = fixed[f].el.getBoundingClientRect();
        var idx = fixed[f].paneIndex;
        if (idx >= 0 && (tops[idx] === null || r.top < tops[idx])) tops[idx] = Math.max(0, r.top - 64);
      }
      return new Promise(function(resolve) {
        requestAnimationFrame(function() { requestAnimationFrame(function() { resolve(tops); }); });
      });
    }
  });
  var bottomTops = bottomMetaResult[0].result;
  var hasBottom = bottomTops.some(function(v) { return typeof v === 'number'; });
  var bottomShot = null;
  if (hasBottom) {
    await sleep(350);
    for (var bottomRetry = 0; bottomRetry < 3; bottomRetry++) {
      try {
        bottomShot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        break;
      } catch (bottomErr) {
        if (bottomRetry < 2 && bottomErr.message.indexOf('MAX_CAPTURE') !== -1) {
          await sleep(600);
        } else {
          throw bottomErr;
        }
      }
    }
  }

  sendProgress('Composizione...', 92);
  var compResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function(imgs, panes, scrolls, viewH, outputH, bg, bottomImg, bottomTops) {
      function loadImg(src) {
        return new Promise(function(resolve, reject) {
          var img = new Image();
          img.onload = function() { resolve(img); };
          img.onerror = reject;
          img.src = src;
        });
      }
      var sources = imgs.slice();
      if (bottomImg) sources.push(bottomImg);
      return Promise.all(sources.map(loadImg)).then(function(loaded) {
        var bottom = bottomImg ? loaded.pop() : null;
        var k = loaded[0].height / viewH;
        var canvas = document.createElement('canvas');
        canvas.width = loaded[0].width;
        canvas.height = Math.max(loaded[0].height, Math.round(outputH * k));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(loaded[0], 0, 0);

        for (var p = 0; p < panes.length; p++) {
          var pane = panes[p];
          var sx = Math.round(pane.left * k);
          var sy = Math.round(pane.top * k);
          var sw = Math.round(pane.width * k);
          var sh = Math.round(pane.height * k);
          if (sx + sw > loaded[0].width) sw = loaded[0].width - sx;
          if (sy + sh > loaded[0].height) sh = loaded[0].height - sy;
          for (var frame = 0; frame < loaded.length; frame++) {
            var real = scrolls[frame] && typeof scrolls[frame][p] === 'number' ? scrolls[frame][p] : 0;
            var dy = Math.round((pane.top + real) * k);
            var drawH = Math.min(sh, canvas.height - dy);
            if (sw > 0 && drawH > 0) ctx.drawImage(loaded[frame], sx, sy, sw, drawH, sx, dy, sw, drawH);
          }

          if (bottom && typeof bottomTops[p] === 'number') {
            var stripTop = Math.max(pane.top, bottomTops[p]);
            var stripBottom = pane.top + pane.height;
            var stripY = Math.round(stripTop * k);
            var stripH = Math.round((stripBottom - stripTop) * k);
            var destBottom = Math.round((pane.top + pane.scrollHeight) * k);
            if (stripY + stripH > bottom.height) stripH = bottom.height - stripY;
            if (destBottom > canvas.height) destBottom = canvas.height;
            if (stripH > 0) {
              ctx.drawImage(bottom, sx, stripY, sw, stripH, sx, destBottom - stripH, sw, stripH);
            }
          }
        }
        return canvas.toDataURL('image/png');
      });
    },
    args: [captures, d.panes, paneScrolls, d.vh, d.outputH, d.bg, bottomShot, bottomTops]
  });

  var multi = await multiSessione();
  var rejected = false;
  if (multi && multi.active) {
    rejected = (await multiAggiungiPezzo(compResult[0].result, tabId, 'full')) === false;
  } else {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chrome.downloads.download({
      url: compResult[0].result,
      filename: 'screenshots/screenshot_' + ts + '.png',
      saveAs: false
    });
    await copyToClipboard(compResult[0].result, tabId);
  }

  await cleanupMultiPaneCapture(tabId, d.panes);

  await resumeCssAnims(tabId);
  if (rejected) sendError('Piece too large for the session (10 MB limit)');
  else sendSuccess();
  if (!(multi && multi.active)) await registraCatturaRiuscita(tabId);
}

async function doFullCapture(tabId) {
  var captureBackgrounds = false;
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
        // CORSA VERA: certe app (Yahoo Mail: documento 829px su finestra
        // 828) lasciano alla finestra 1-2px di gioco — la prova del pixel
        // passa ma il contenuto vive in un contenitore interno con migliaia
        // di px di scroll. La finestra vale come scroller solo se ha almeno
        // mezza schermata di corsa; altrimenti si cercano i contenitori
        // interni (se non ce ne sono, si ritorna comunque alla finestra).
        var corsaWin = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
        if (windowScrolls && corsaWin < window.innerHeight * 0.5) windowScrolls = false;

        if (!windowScrolls) {
          var all = document.querySelectorAll('*');
          var bestVisibleArea = -1;
          var bestScrollHeight = -1;
          var paneCandidates = [];
          for (var j = 0; j < all.length; j++) {
            var el = all[j];
            var style = window.getComputedStyle(el);
            var ov = style.overflowY;
            if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              var rect = el.getBoundingClientRect();
              var visibleW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
              var visibleH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
              var visibleArea = visibleW * visibleH;
              if (visibleH >= window.innerHeight * 0.45 &&
                  visibleW >= 80 && visibleArea >= window.innerWidth * window.innerHeight * 0.04) {
                paneCandidates.push({
                  el: el,
                  left: Math.max(0, rect.left + (el.clientLeft || 0)),
                  top: Math.max(0, rect.top + (el.clientTop || 0)),
                  width: visibleW,
                  height: visibleH,
                  area: visibleArea
                });
              }
              // Nelle web app possono scorrere sia il contenuto principale sia
              // una sidebar molto più lunga. La Full Page deve seguire la zona
              // visibile più ampia, non quella con più cronologia (ChatGPT).
              if (visibleArea > bestVisibleArea ||
                  (visibleArea === bestVisibleArea && el.scrollHeight > bestScrollHeight)) {
                scrollEl = el;
                bestVisibleArea = visibleArea;
                bestScrollHeight = el.scrollHeight;
              }
            }
          }

          // Più pannelli alti e non sovrapposti (es. cronologia + chat):
          // vengono catturati come scroller indipendenti e ricomposti affiancati.
          paneCandidates.sort(function(a, b) { return b.area - a.area; });
          var panes = [];
          for (var pc = 0; pc < paneCandidates.length && panes.length < 4; pc++) {
            var cand = paneCandidates[pc];
            var separato = true;
            for (var ps = 0; ps < panes.length; ps++) {
              var gia = panes[ps];
              var iw = Math.max(0, Math.min(cand.left + cand.width, gia.left + gia.width) - Math.max(cand.left, gia.left));
              var ih = Math.max(0, Math.min(cand.top + cand.height, gia.top + gia.height) - Math.max(cand.top, gia.top));
              if (iw * ih > Math.min(cand.area, gia.area) * 0.2) {
                separato = false;
                break;
              }
            }
            if (separato) panes.push(cand);
          }

          if (panes.length >= 2) {
            panes.sort(function(a, b) { return a.left - b.left; });
            var paneData = [];
            var maxScroll = 0;
            var minStep = window.innerHeight;
            var outputH = window.innerHeight;
            for (var pi = 0; pi < panes.length; pi++) {
              var pane = panes[pi];
              var oldScroll = pane.el.scrollTop;
              pane.el.setAttribute('data-screenshot-pane', String(pi));
              pane.el.scrollTop = 0;
              var maxPaneScroll = Math.max(0, pane.el.scrollHeight - pane.el.clientHeight);
              if (maxPaneScroll > maxScroll) maxScroll = maxPaneScroll;
              if (pane.height < minStep) minStep = pane.height;
              if (pane.top + pane.el.scrollHeight > outputH) outputH = pane.top + pane.el.scrollHeight;
              paneData.push({
                index: pi,
                left: pane.left,
                top: pane.top,
                width: pane.width,
                height: pane.height,
                scrollHeight: pane.el.scrollHeight,
                oldScroll: oldScroll
              });
            }
            var bg = window.getComputedStyle(document.body).backgroundColor;
            if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
              bg = window.getComputedStyle(document.documentElement).backgroundColor;
            }
            return {
              multiPane: true,
              panes: paneData,
              maxScroll: maxScroll,
              stepH: minStep,
              outputH: outputH,
              vh: window.innerHeight,
              vw: window.innerWidth,
              dpr: window.devicePixelRatio || 1,
              bg: bg || '#ffffff'
            };
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
    if (d.multiPane) {
      await doMultiPaneFullCapture(tabId, d);
      return;
    }
    // Passo di avanzamento: l'altezza VISIBILE del contenitore scrollato
    // (per lo scroll di finestra coincide con l'altezza del viewport).
    var stepH = d.hasCustomScroll ? d.ch : d.vh;
    var rows = Math.ceil(d.sh / stepH);
    if (!d.hasCustomScroll && rows > 1) {
      captureBackgrounds = await prepareCaptureBackgrounds(tabId);
    }
    var captures = [];
    // Scroll REALE raggiunto da ogni slice: le liste (webmail) scattano a
    // multipli di riga o si agganciano al fondo prima del previsto — la
    // composizione deve usare le posizioni vere, non quelle richieste.
    var realScrolls = [];

    for (var i = 0; i < rows; i++) {
      var pct = Math.round(((i + 1) / rows) * 85) + 5;
      sendProgress('Cattura ' + (i + 1) + ' di ' + rows + '...', pct);

      var esitoSlice = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(y, custom, row) {
          function allElementsDeep(root) {
            var result = [];
            var scopes = [root];
            while (scopes.length) {
              var scope = scopes.shift();
              var found = scope.querySelectorAll('*');
              for (var de = 0; de < found.length; de++) {
                result.push(found[de]);
                if (found[de].shadowRoot) scopes.push(found[de].shadowRoot);
              }
            }
            return result;
          }

          // Censimento sticky/fixed una sola volta (prima slice), con la
          // visibility originale salvata per il ripristino finale.
          if (row === 0) {
            window.__screenshotHidden = [];
            var scrollAnc = custom ? document.querySelector('[data-screenshot-scroll]') : null;
            var allEls = allElementsDeep(document);
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

          // Alcuni siti (Transfermarkt) trasformano una barra normale in
          // position:fixed soltanto dopo lo scroll. Va censita nella stessa
          // fetta in cui cambia, non solo all'inizio della cattura.
          function scanDynamicStickiesFP() {
            var list = window.__screenshotHidden || [];
            var scrollAncNow = custom ? document.querySelector('[data-screenshot-scroll]') : null;
            var currentEls = allElementsDeep(document);
            for (var dk = 0; dk < currentEls.length; dk++) {
              var dp = window.getComputedStyle(currentEls[dk]).position;
              if (dp !== 'fixed' && dp !== 'sticky') continue;
              if (scrollAncNow && currentEls[dk].contains(scrollAncNow)) continue;
              var dr = currentEls[dk].getBoundingClientRect();
              if (dr.width >= window.innerWidth * 0.9 && dr.height >= window.innerHeight * 0.9) continue;
              var known = false;
              for (var di = 0; di < list.length; di++) {
                if (list[di].el === currentEls[dk]) { known = true; break; }
              }
              if (!known) {
                list.push({
                  el: currentEls[dk],
                  oldVisibility: currentEls[dk].style.visibility
                });
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
            for (var s = 0; s < list.length; s++) {
              list[s].el.style.visibility = list[s].oldVisibility;
              list[s].hiddenByCapture = false;
            }
            // PRIMA slice (row 0): lascia visibili gli header/barre fisse, così
            // compaiono UNA volta in cima (es. barra AI-DESK del sito). Le slice
            // successive li nascondono per non ripeterli.
            if (row === 0) return;

            function getS() { return custom ? document.querySelector('[data-screenshot-scroll]').scrollTop : window.scrollY; }
            // La lettura segue subito lo spostamento: non deve ereditare lo
            // scroll animato del sito, altrimenti gli header sembrano mobili.
            function setS(v) {
              var scroller = custom ? document.querySelector('[data-screenshot-scroll]') : window;
              scroller.scrollTo({ top: v, left: custom ? scroller.scrollLeft : window.scrollX, behavior: 'instant' });
            }
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
              if (anchored) {
                list[s].el.style.visibility = 'hidden';
                list[s].hiddenByCapture = true;
              }
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
                scanDynamicStickiesFP();
                manageStickiesFP();  // nascondi gli ancorati a QUESTA slice
                // Il chiamante compone per POSIZIONE REALE: si riporta dove
                // lo scroll si è davvero fermato (non dove doveva arrivare).
                resolve(custom
                  ? document.querySelector('[data-screenshot-scroll]').scrollTop
                  : window.scrollY);
              }
            }, 50);
          });
        },
        args: [i * stepH, d.hasCustomScroll, i]
      });
      realScrolls.push((esitoSlice && esitoSlice[0] && typeof esitoSlice[0].result === 'number')
        ? esitoSlice[0].result
        : i * stepH);

      await sleep(350);

      var dataUrl = null;
      for (var retry = 0; retry < 3; retry++) {
        try {
          if (captureBackgrounds) await syncCaptureBackgrounds(tabId);
          dataUrl = await captureStitchedFrame(tabId);
          break;
        } catch (captureErr) {
          if (retry < 2 && captureErr.message.indexOf('MAX_CAPTURE') !== -1) {
            await sleep(600);
          } else {
            throw captureErr;
          }
        }
      }
      // DEDUP PER CONTENUTO: foto identica alla precedente = la vista NON è
      // avanzata davvero (webmail con scroller annidati che "mentono": lo
      // scrollTop del contenitore marcato cresce ma il contenuto visibile è
      // già al fondo). Con le animazioni in pausa un view fermo produce PNG
      // byte-identici: scartando la fetta il doppione diventa impossibile
      // per costruzione, qualunque cosa dichiarino gli scroller.
      if (captures.length && dataUrl === captures[captures.length - 1]) {
        realScrolls.pop();
        continue;
      }
      captures.push(dataUrl);
    }

    sendProgress('Composizione...', 92);

    var compResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(imgs, pw, ph, viewH, ratio, custom, ch, ot, reali) {
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
            // Cintura di sicurezza sugli arrotondamenti: mai leggere oltre il
            // fondo del frame — drawImage clipperebbe la sorgente ma il
            // cursore avanzerebbe comunque, lasciando una riga trasparente
            // per giuntura.
            if (bandTop + bandH > loaded[0].height) bandH = loaded[0].height - bandTop;
            var firstH = bandTop + bandH;
            if (firstH > loaded[0].height) firstH = loaded[0].height;

            // COMPOSIZIONE PER POSIZIONE REALE: ogni banda va dove il
            // contenitore era DAVVERO scrollato (reali[j]), non dove
            // avremmo voluto mandarlo. Le liste delle webmail scattano a
            // multipli di riga e si agganciano al fondo prima del previsto:
            // componendo per posizione le giunture non tagliano più le
            // righe e le bande sovrapposte si ridisegnano identiche invece
            // di duplicare la coda.
            var contH = Math.round(ph * k);            // contenuto totale
            var altezza = bandTop + contH;
            var fondoReale = 0;
            for (var q = 0; q < total; q++) {
              var giu = bandTop + Math.round((reali[q] || 0) * k) + bandH;
              if (giu > fondoReale) fondoReale = giu;
            }
            if (fondoReale < altezza) altezza = fondoReale;

            var canvasC = document.createElement('canvas');
            canvasC.width = cw;
            canvasC.height = altezza;
            var ctxC = canvasC.getContext('2d');

            for (var j = 0; j < total; j++) {
              var imC = loaded[j];
              var posY = (j === 0) ? 0 : bandTop + Math.round((reali[j] || 0) * k);
              var srcY = (j === 0) ? 0 : bandTop;
              var srcH = (j === 0) ? firstH : bandH;
              if (posY + srcH > altezza) srcH = altezza - posY;
              if (srcH <= 0) continue;
              ctxC.drawImage(imC, 0, srcY, imC.width, srcH, 0, posY, imC.width, srcH);
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
      args: [captures, d.vw, d.sh, d.vh, d.dpr, d.hasCustomScroll, d.ch, d.ot, realScrolls]
    });

    // MULTI SNIP: a sessione attiva il pezzo va all'editor, non al download.
    var multiF = await multiSessione();
    var pezzoScartatoF = false;
    if (multiF && multiF.active) {
      var okF = await multiAggiungiPezzo(compResult[0].result, tabId, 'full');
      // Pezzo respinto per quota: si prosegue coi RIPRISTINI della pagina
      // (scroll, elementi nascosti) e si segnala errore alla fine.
      pezzoScartatoF = (okF === false);
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

    if (captureBackgrounds) {
      await restoreCaptureBackgrounds(tabId);
      captureBackgrounds = false;
    }
    await resumeCssAnims(tabId);
    if (pezzoScartatoF) {
      sendError('Piece too large for the session (10 MB limit)');
    } else {
      sendSuccess();
    }
    if (!(multiF && multiF.active)) {
      await registraCatturaRiuscita(tabId);
    }

  } catch (err) {
    console.error('Screenshot error:', err);
    if (typeof d !== 'undefined' && d && d.multiPane) {
      try { await cleanupMultiPaneCapture(tabId, d.panes); } catch (cleanupErr) {}
    }
    if (captureBackgrounds) {
      await restoreCaptureBackgrounds(tabId);
      captureBackgrounds = false;
    }
    await resumeCssAnims(tabId);
    // FALLBACK: su pagine non iniettabili (chrome://, errore) catturo il visibile.
    if (isPaginaNonIniettabile(err)) { await doVisibleCapture(tabId); return; }
    sendError(err.message);
  } finally {
    if (captureBackgrounds) await restoreCaptureBackgrounds(tabId);
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
      var okV = await multiAggiungiPezzo(dataUrl, tabId, 'visible');
      await resumeCssAnims(tabId);
      if (okV === false) {
        sendError('Piece too large for the session (10 MB limit)');
      } else {
        sendSuccess();
      }
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
async function hideAreaCustomScrollbars(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      var scrollers = document.querySelectorAll('[data-screenshot-area-scroll], [data-screenshot-area-pane]');
      scrollers.forEach(function(scroller) {
      if (scroller === document.scrollingElement) return;
      var frame = scroller.getBoundingClientRect();
      var scope = scroller.closest('dialog[open], [role="dialog"], [aria-modal="true"]');
      if (!scope) {
        // Nelle colonne laterali la barra puo essere esterna allo scroller,
        // accanto a uno dei suoi contenitori, anziche dentro il suo parent.
        scope = scroller;
        for (var level = 0; level < 4 && scope.parentElement; level++) {
          scope = scope.parentElement;
          if (scope === document.body || scope.getBoundingClientRect().width > frame.width + 64) break;
        }
      }
      var frameRight = Math.min(window.innerWidth, frame.right);
      var frameTop = Math.max(0, frame.top);
      var frameBottom = Math.min(window.innerHeight, frame.bottom);
      function roundedFill(css) {
        return Math.max(parseFloat(css.borderTopLeftRadius) || 0,
          parseFloat(css.borderTopRightRadius) || 0,
          parseFloat(css.borderBottomLeftRadius) || 0,
          parseFloat(css.borderBottomRightRadius) || 0) >= 2 &&
          css.backgroundColor !== 'transparent' && css.backgroundColor !== 'rgba(0, 0, 0, 0)';
      }
      var style = document.getElementById('__screenshot_area_scrollbars');
      if (!style) {
        style = document.createElement('style');
        style.id = '__screenshot_area_scrollbars';
        // Opacity non cambia dimensioni, scroll o disposizione del contenuto.
        style.textContent = '[data-screenshot-area-scrollbar]{opacity:0 !important;}';
        (document.head || document.documentElement).appendChild(style);
      }
      scope.querySelectorAll('*').forEach(function(el) {
        if (el === scroller || el.contains(scroller)) return;
        if (el.hasAttribute('data-screenshot-area-scrollbar')) return;
        var r = el.getBoundingClientRect();
        // Solo la sottile fascia verticale sul bordo destro dello scroller.
        // Alcuni siti disegnano il cursore appena FUORI dal bordo, oppure
        // lo tagliano al viewport: si considera anche questa fascia esterna.
        if (r.width <= 0 || r.width > 20 || r.height < 24 || r.height < r.width * 2 ||
            r.left < frameRight - 24 || r.right > frameRight + 24 ||
            Math.min(r.bottom, frameBottom) - Math.max(r.top, frameTop) < 24) return;
        // Non nascondere testo, immagini o controlli del post.
        if (el.textContent.trim() || el.matches('img,svg,canvas,video,input,textarea,button,a,[contenteditable="true"]') ||
            el.querySelector('img,svg,canvas,video,input,textarea,button,a,[contenteditable="true"],[role="button"]')) return;
        var css = window.getComputedStyle(el);
        var semantic = el.getAttribute('role') === 'scrollbar';
        var floating = css.position === 'absolute' || css.position === 'fixed';
        if (!floating && el.parentElement) {
          var parentCss = window.getComputedStyle(el.parentElement);
          var parentRect = el.parentElement.getBoundingClientRect();
          floating = (parentCss.position === 'absolute' || parentCss.position === 'fixed') && parentRect.width <= 24;
        }
        // Le barre personalizzate hanno un cursore stretto e arrotondato;
        // le semplici linee decorative non vanno considerate scrollbar.
        var paintedThumb = roundedFill(css);
        if (floating && !paintedThumb) {
          // Il cursore puo essere dipinto con ::before/::after: nascondere
          // il suo elemento resta reversibile e non sposta i contatti.
          ['::before', '::after'].forEach(function(pseudo) {
            var pseudoCss = window.getComputedStyle(el, pseudo);
            if (pseudoCss.content !== 'none' && pseudoCss.content !== 'normal' && roundedFill(pseudoCss)) paintedThumb = true;
          });
        }
        var thumb = floating && paintedThumb;
        if (semantic || thumb) el.setAttribute('data-screenshot-area-scrollbar', 'true');
      });
      });
    }
  });
}

// Le colonne hanno coordinate e fine-scroll indipendenti. Il fotogramma
// intero serve solo per lo sfondo fisso; ogni colonna viene cucita a parte.
async function captureAreaPanes(tabId, area) {
  var complete = false;
  try {
    if (area.w * area.dpr > 32767 || area.h_doc * area.dpr > 32767) {
      throw new Error('Area troppo grande: seleziona meno contenuto.');
    }
    var prepared = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(data) {
        function background(el) {
          for (var node = el; node; node = node.parentElement) {
            var color = getComputedStyle(node).backgroundColor;
            if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
          }
          return '#fff';
        }
        var panes = data.map(function(p, index) {
          var el = document.querySelector('[data-screenshot-area-pane="' + index + '"]');
          if (!el) throw new Error('La pagina ha cambiato le colonne. Ripeti la selezione.');
          return { el: el, isWindow: !!p.isWindow, origin: p.origin, left: p.left, right: p.right,
            top: p.top, bottom: p.bottom, bg: background(el), topInset: 0, bottomInset: 0 };
        });
        window.__screenshotAreaPanes = panes;
        panes.forEach(function(p) {
          (p.isWindow ? window : p.el).scrollTo({ top: p.origin,
            left: p.isWindow ? window.scrollX : p.el.scrollLeft, behavior: 'instant' });
          p.el.querySelectorAll('*').forEach(function(el) {
            var css = getComputedStyle(el);
            if (css.position !== 'sticky' && css.position !== 'fixed') return;
            var r = el.getBoundingClientRect();
            if (r.width < (p.right - p.left) * 0.6 || r.height <= 0 ||
                r.height > (p.bottom - p.top) * 0.3 || css.visibility === 'hidden') return;
            if (Math.abs(r.top - p.top) <= 2 && css.top !== 'auto') {
              p.topInset = Math.max(p.topInset, r.bottom - p.top);
            }
            if (Math.abs(r.bottom - p.bottom) <= 2 && css.bottom !== 'auto') {
              p.bottomInset = Math.max(p.bottomInset, p.bottom - r.top);
            }
          });
        });
        return { vh: innerHeight, bg: background(document.body), panes: panes.map(function(p) {
          return { left: p.left, right: p.right, top: p.top, bottom: p.bottom,
            topInset: p.topInset, bottomInset: p.bottomInset, bg: p.bg };
        }) };
      },
      args: [area.panes]
    });
    var layout = prepared[0].result;
    var frames = [];
    var shifts = [];
    async function shotAt(offset) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(y) {
          var panes = window.__screenshotAreaPanes;
          if (!panes || panes.some(function(p) { return !p.el.isConnected; })) {
            throw new Error('La pagina ha cambiato le colonne. Ripeti la selezione.');
          }
          panes.forEach(function(p) {
            (p.isWindow ? window : p.el).scrollTo({ top: p.origin + y,
              left: p.isWindow ? window.scrollX : p.el.scrollLeft, behavior: 'instant' });
          });
          return new Promise(function(resolve) {
            var previous = [], stable = 0, count = 0;
            var timer = setInterval(function() {
              var now = panes.map(function(p) { return p.isWindow ? window.scrollY : p.el.scrollTop; });
              stable = now.every(function(v, i) { return Math.abs(v - previous[i]) < 0.5; }) ? stable + 1 : 0;
              previous = now;
              if (stable >= 3 || ++count >= 30) { clearInterval(timer); resolve(); }
            }, 50);
          });
        },
        args: [offset]
      });
      await sleep(350);
      await hideAreaCustomScrollbars(tabId);
      for (var retry = 0; retry < 3; retry++) {
        var position = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() {
            return window.__screenshotAreaPanes.map(function(p) {
              if (!p.el.isConnected) throw new Error('La pagina ha cambiato le colonne. Ripeti la selezione.');
              return (p.isWindow ? window.scrollY : p.el.scrollTop) - p.origin;
            });
          }
        });
        try {
          var shot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
          shifts.push(position[0].result);
          frames.push(shot);
          return;
        } catch (err) {
          if (retry === 2 || String(err.message).indexOf('MAX_CAPTURE') === -1) throw err;
          await sleep(600);
        }
      }
    }
    // La foto iniziale conserva una sola volta menu, intestazioni e sfondo.
    await shotAt(0);
    var visibleOnly = area.y_doc >= 0 && area.y_doc + area.h_doc <= layout.vh;
    if (!visibleOnly) {
      var step = Math.max(40, Math.min.apply(null, layout.panes.map(function(p) {
        return p.bottom - p.top - p.topInset - p.bottomInset;
      })) - 40);
      var first = Math.min(0, area.y_doc - Math.max.apply(null, layout.panes.map(function(p) { return p.top + p.topInset; })));
      var last = Math.max(0, area.y_doc + area.h_doc - Math.min.apply(null, layout.panes.map(function(p) { return p.bottom - p.bottomInset; })));
      var count = Math.ceil((last - first) / step) + 1;
      for (var index = 0; index < count; index++) {
        sendProgress('Cattura colonne ' + (index + 1) + ' di ' + count + '...', 5 + Math.round(85 * (index + 1) / count));
        await shotAt(Math.min(last, first + index * step));
      }
    }
    sendProgress('Composizione...', 92);
    var composed = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(sources, scrolls, layout, area, visibleOnly) {
        return Promise.all(sources.map(function(src) {
          return new Promise(function(resolve, reject) {
            var img = new Image(); img.onload = function() { resolve(img); }; img.onerror = reject; img.src = src;
          });
        })).then(function(images) {
          var k = images[0].height / layout.vh;
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(area.w * k));
          canvas.height = Math.max(1, Math.round(area.h_doc * k));
          var ctx = canvas.getContext('2d');
          if (!ctx || canvas.width > 32767 || canvas.height > 32767) throw new Error('Area troppo grande: seleziona meno contenuto.');
          var ax = Math.round(area.x * k), ay = Math.round(area.y_doc * k);
          ctx.fillStyle = layout.bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(images[0], -ax, -ay);
          if (!visibleOnly) layout.panes.forEach(function(p, paneIndex) {
            var x = Math.round(p.left * k), w = Math.round(p.right * k) - x;
            var top = Math.round((p.top + p.topInset) * k);
            var bottom = Math.round((p.bottom - p.bottomInset) * k);
            var minShift = Math.min.apply(null, scrolls.map(function(row) { return row[paneIndex]; }));
            var maxShift = Math.max.apply(null, scrolls.map(function(row) { return row[paneIndex]; }));
            ctx.fillStyle = p.bg;
            var clearTop = Math.round(top + minShift * k) - ay;
            ctx.fillRect(x - ax, clearTop, w, canvas.height - clearTop);
            for (var f = 0; f < images.length; f++) {
              var destTop = Math.round(top + scrolls[f][paneIndex] * k) - ay;
              ctx.drawImage(images[f], x, top, w, bottom - top, x - ax, destTop, w, bottom - top);
            }
            // La barra inferiore compare una sola volta, al fondo della sua
            // colonna, non al fondo di quella eventualmente piu lunga.
            if (p.bottomInset > 0) {
              var bottomFrame = scrolls.findIndex(function(row) { return row[paneIndex] === maxShift; });
              var h = Math.round(p.bottom * k) - bottom;
              ctx.drawImage(images[bottomFrame], x, bottom, w, h,
                x - ax, Math.round(bottom + maxShift * k) - ay, w, h);
            }
          });
          var result = canvas.toDataURL('image/png');
          if (result === 'data:,') throw new Error('Area troppo grande: seleziona meno contenuto.');
          return result;
        });
      },
      args: [frames, shifts, layout, area, visibleOnly]
    });
    complete = true;
    return composed[0].result;
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(success) {
        (window.__screenshotAreaPanes || []).forEach(function(p) {
          (p.isWindow ? window : p.el).scrollTo({ top: success ? 0 : p.origin,
            left: p.isWindow ? window.scrollX : p.el.scrollLeft, behavior: 'instant' });
          p.el.removeAttribute('data-screenshot-area-pane');
        });
        delete window.__screenshotAreaPanes;
      },
      args: [complete]
    }).catch(function() {});
  }
}

async function doAreaCapture(tabId) {
  var areaScrollbarsHidden = false;
  var captureBackgrounds = false;
  try {
    // (le animazioni JS sono già congelate dal listener startCapture)
    // In sessione Multi Snip l'overlay mostra un testo dedicato, così si
    // capisce che il pezzo finirà nell'editor e non nel download.
    var sessioneMulti = await multiSessione();
    var inMulti = !!(sessioneMulti && sessioneMulti.active);
    // Foto del viewport per la LENTE di ingrandimento: scattata PRIMA che
    // l'overlay scurisca la pagina, così la lente mostra i pixel veri.
    // Attivabile dalle impostazioni (default: spenta).
    var stLente = await chrome.storage.local.get('lentePixel');
    var lenteAttiva = (stLente.lentePixel === undefined) ? false : !!stLente.lentePixel;
    var fotoLente = null;
    if (lenteAttiva) {
      try {
        fotoLente = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      } catch (nienteLente) {}
    }
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      args: [inMulti, fotoLente, lenteAttiva],
      func: function(inMulti, fotoLente, lenteAttiva) {
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
          : 'Drag to select an area';
        overlay.appendChild(info);

        var scrollPaused = false;
        var scrollHint = document.createElement('div');
        scrollHint.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);' +
          'max-width:calc(100% - 24px);box-sizing:border-box;text-align:center;z-index:2;' +
          'font:600 12px/1.4 Segoe UI,sans-serif;padding:7px 12px;border-radius:7px;' +
          'color:#fff;background:#202027;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:none;';
        overlay.appendChild(scrollHint);
        function showScrollPause() {
          scrollHint.textContent = scrollPaused
            ? 'Scrolling paused — release Space to resume'
            : 'Hold Space to pause scrolling';
          scrollHint.style.background = scrollPaused ? '#ffe3a3' : '#202027';
          scrollHint.style.color = scrollPaused ? '#342400' : '#fff';
        }
        showScrollPause();

        var startX = 0, startY_doc = 0, dragging = false;
        var currentX = 0, currentMouseY_vp = 0;
        function syncSelectionPointer() {
          // In pausa il puntatore puo uscire dalla finestra, ma il rettangolo
          // si ferma al bordo: non crea una coda vuota oltre lo schermo.
          currentX = scrollPaused ? Math.max(0, Math.min(window.innerWidth, virtX)) : virtX;
          currentMouseY_vp = scrollPaused ? Math.max(0, Math.min(window.innerHeight, virtY)) : virtY;
        }

        // === FRENO DI PRECISIONE ===
        // Quando il mouse striscia (pochi px tra un evento e l'altro), la
        // punta della selezione avanza a SCATTI di 1px esatto, demoltiplicata
        // (~3px reali = 1px di selezione): calamita pixel per pixel. Appena
        // il movimento torna veloce, la punta si riallinea al cursore vero.
        // FRENO SPENTO (SOGLIA_LENTA = 0): la ricetta Captor è celle grandi
        // nella lente, non il cursore rallentato — con lo zoom 16× ogni px
        // del mouse si vede enorme e la mira viene da sola, senza mai
        // scostamenti tra mirino e puntatore. Per riattivare il freno:
        // SOGLIA_LENTA ~5.
        var FRENO = 6;
        var SOGLIA_LENTA = 0;
        var GUINZAGLIO = 3;
        var virtX = 0, virtY = 0;    // punta virtuale della selezione
        var accX = 0, accY = 0;      // resti accumulati in modalità lenta
        var lastEvX = 0, lastEvY = 0;
        function aggiornaVirtuale(e) {
          var dx = e.clientX - lastEvX;
          var dy = e.clientY - lastEvY;
          lastEvX = e.clientX;
          lastEvY = e.clientY;
          // Il freno esiste SOLO con la lente accesa: senza lente non si
          // vedrebbe la punta frenata e sembrerebbe un mouse impazzito.
          if (lenteAttiva && Math.abs(dx) + Math.abs(dy) <= SOGLIA_LENTA) {
            accX += dx / FRENO;
            accY += dy / FRENO;
            var passiX = Math.trunc(accX);
            var passiY = Math.trunc(accY);
            accX -= passiX;
            accY -= passiY;
            virtX += passiX;
            virtY += passiY;
            // GUINZAGLIO: la punta frenata non può restare più lontana di
            // pochi px dal cursore vero — oltre, viene trascinata dietro.
            // Senza questo il distacco cresceva senza limite alle velocità
            // medie e il mirino finiva lontanissimo dal puntatore.
            var gx = e.clientX - virtX;
            var gy = e.clientY - virtY;
            if (Math.abs(gx) > GUINZAGLIO) virtX = e.clientX - Math.sign(gx) * GUINZAGLIO;
            if (Math.abs(gy) > GUINZAGLIO) virtY = e.clientY - Math.sign(gy) * GUINZAGLIO;
          } else {
            virtX = e.clientX;
            virtY = e.clientY;
            accX = 0;
            accY = 0;
          }
          virtX = Math.min(Math.max(0, virtX), window.innerWidth - 1);
          virtY = Math.min(Math.max(0, virtY), window.innerHeight - 1);
        }

        // === LENTE DI INGRANDIMENTO (precisione al pixel) ===
        // Una foto del viewport fa da sorgente: la lente è un canvas che la
        // mostra ingrandita 4× attorno al puntatore, col mirino. Dopo ogni
        // scroll la foto è vecchia: la lente si nasconde e chiede al service
        // worker una foto fresca quando lo scroll si ferma (~2 scatti/sec max).
        // Stile "Screenshot Captor": griglia in cui OGNI cella è un pixel
        // fisico dello schermo, mirino rosso sul pixel centrale, lente a
        // sinistra e un filo sotto il puntatore.
        // Celle PARI: la linea di griglia centrale coincide col centro
        // geometrico del quadrato, così il mirino rosso è sia allineato
        // alla griglia sia perfettamente centrato (metà celle per lato).
        var CELLE = 12;             // pixel inquadrati per lato (come Captor)
        var CELLA = 16;             // lato di ogni pixel dentro la lente
        var LATO = CELLE * CELLA;   // 192
        var lente = document.createElement('canvas');
        lente.width = LATO;
        lente.height = LATO;
        lente.style.cssText = 'position:fixed;z-index:2147483647;width:' + LATO + 'px;height:' + LATO + 'px;' +
          'border:2px solid #00d4ff;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.5);' +
          'pointer-events:none;display:none;background:#111;';
        overlay.appendChild(lente);
        var lctx = lente.getContext('2d');
        var lenteImg = null;
        var lenteViva = false;
        var mouseVisto = false;
        var ultimoMX = 0, ultimoMY = 0;
        var fotoScrollX = 0, fotoScrollY = 0;   // scroll al momento della foto
        function lenteCarica(dataUrl) {
          if (!dataUrl) return;
          var im = new Image();
          im.onload = function() {
            lenteImg = im;
            lenteViva = true;
            fotoScrollX = window.scrollX;
            fotoScrollY = window.scrollY;
            disegnaLente();
          };
          im.src = dataUrl;
        }
        function disegnaLente() {
          if (!lenteImg || !lenteViva || !mouseVisto) {
            lente.style.display = 'none';
            return;
          }
          var dpr = lenteImg.width / window.innerWidth;  // scala reale della foto
          var meta = CELLE / 2;
          // COMPENSAZIONE SCROLL: durante lo scroll la foto è "vecchia" —
          // si campiona spostati di quanto la pagina è scorsa da allora.
          // Così la lente resta SEMPRE visibile e sensata anche mentre la
          // pagina corre; la foto fresca arriva appena lo scroll si ferma.
          var compX = window.scrollX - fotoScrollX;
          var compY = window.scrollY - fotoScrollY;
          // CONFINE tra pixel più vicino al puntatore (il mirino segna un
          // bordo, non il centro di un pixel), tenuto dentro la foto.
          var cxDev = Math.min(Math.max(Math.round((ultimoMX + compX) * dpr), meta), lenteImg.width - meta);
          var cyDev = Math.min(Math.max(Math.round((ultimoMY + compY) * dpr), meta), lenteImg.height - meta);
          lctx.imageSmoothingEnabled = false;             // ogni pixel una cella netta
          lctx.fillStyle = '#111';
          lctx.fillRect(0, 0, LATO, LATO);
          lctx.drawImage(lenteImg,
            cxDev - meta, cyDev - meta, CELLE, CELLE,
            0, 0, LATO, LATO);
          // griglia: una cella = UN pixel dello schermo
          lctx.strokeStyle = 'rgba(0,0,0,0.28)';
          lctx.lineWidth = 1;
          lctx.beginPath();
          for (var g = 0; g <= CELLE; g++) {
            lctx.moveTo(g * CELLA + 0.5, 0);
            lctx.lineTo(g * CELLA + 0.5, LATO);
            lctx.moveTo(0, g * CELLA + 0.5);
            lctx.lineTo(LATO, g * CELLA + 0.5);
          }
          lctx.stroke();
          // Mirino rosso ALLINEATO alla griglia (stile Captor): le righe
          // corrono sulle linee della griglia e si incrociano sull'angolo
          // del pixel centrale — il punto esatto dove parte la selezione.
          lctx.strokeStyle = 'rgba(224,32,32,0.9)';
          lctx.beginPath();
          lctx.moveTo(meta * CELLA + 0.5, 0);
          lctx.lineTo(meta * CELLA + 0.5, LATO);
          lctx.moveTo(0, meta * CELLA + 0.5);
          lctx.lineTo(LATO, meta * CELLA + 0.5);
          lctx.stroke();
          // a SINISTRA e più in basso rispetto al puntatore; se non c'è
          // posto salta a destra / sopra
          var lx = ultimoMX - 24 - LATO;
          var ly = ultimoMY + 30;
          if (lx < 4) lx = ultimoMX + 24;
          if (ly + LATO + 8 > window.innerHeight) ly = ultimoMY - 30 - LATO;
          lente.style.left = lx + 'px';
          lente.style.top = ly + 'px';
          lente.style.display = 'block';
        }
        lenteCarica(fotoLente);
        // Disegno agganciato ai frame: una raffica di mousemove produce al
        // massimo un ridisegno per frame (fluidità, zero lavoro sprecato).
        var lenteRafPend = false;
        function disegnaLenteRaf() {
          if (lenteRafPend) return;
          lenteRafPend = true;
          requestAnimationFrame(function() {
            lenteRafPend = false;
            disegnaLente();
          });
        }
        var lenteTimer = null;
        function lenteScrollata() {
          if (!lenteAttiva) return;
          // overlay chiuso: il listener si toglie da solo (niente scatti fantasma)
          if (!overlay.isConnected) {
            window.removeEventListener('scroll', lenteScrollata, true);
            if (lenteTimer) clearTimeout(lenteTimer);
            return;
          }
          // La lente NON si nasconde più durante lo scroll: resta visibile
          // con la foto compensata, e si rinfresca a scroll fermo.
          if (lenteTimer) clearTimeout(lenteTimer);
          lenteTimer = setTimeout(ricatturaLente, 450);
          disegnaLenteRaf();
        }
        function ricatturaLente() {
            // Se l'overlay non è più in pagina (selezione già chiusa),
            // nessuno scatto: si eviterebbe pure di rubare quota alle slice.
            if (!overlay.isConnected) return;
            // Per lo scatto spariscono SOLO velo e cornici — l'overlay
            // resta attivo e cliccabile. MAI visibility:hidden sull'overlay:
            // un elemento nascosto non riceve eventi, e un mouseup in
            // quell'attimo si perdeva — overlay appeso per sempre, attesa
            // infinita e screenshot con il velo scuro dentro.
            var vTr = overlay.style.transition;
            var vBg = overlay.style.background;
            var vBox = box.style.display;
            var vInfo = info.style.display;
            var vDim = dim.style.display;
            var vScrollHint = scrollHint.style.display;
            overlay.style.transition = 'none';
            overlay.style.background = 'transparent';
            box.style.display = 'none';
            info.style.display = 'none';
            dim.style.display = 'none';
            scrollHint.style.display = 'none';
            function ripristina() {
              overlay.style.background = vBg;
              box.style.display = vBox;
              info.style.display = vInfo;
              dim.style.display = vDim;
              scrollHint.style.display = vScrollHint;
              overlay.style.transition = vTr;
            }
            try {
              chrome.runtime.sendMessage({ action: 'lenteRicattura' }, function(r) {
                void chrome.runtime.lastError;
                ripristina();
                if (r && r.img) lenteCarica(r.img);
              });
            } catch (senzaPonte) {
              ripristina();
            }
        }
        if (lenteAttiva) window.addEventListener('scroll', lenteScrollata, true);

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
        var selectionScrollLocked = false;
        var initialScrollTarget = null;
        var selectionStartY = 0;
        var scrollCandidates = [];
        var scrollCandidateOrigins = new Map();
        var MIN_SCROLL_OVERLAP = 0.85;
        var selectionPanes = [];
        var selectionPaneY = 0;

        function scrollSelectionBy(delta) {
          if (!selectionPanes.length) {
            (scrollTarget || window).scrollBy({ top: delta, left: 0, behavior: 'instant' });
            return;
          }
          var minY = 0, maxY = 0;
          selectionPanes.forEach(function(p) {
            minY = Math.min(minY, -p.origin);
            maxY = Math.max(maxY, p.el.scrollHeight - (p.isWindow ? window.innerHeight : p.el.clientHeight) - p.origin);
          });
          var next = Math.max(minY, Math.min(maxY, selectionPaneY + delta));
          var moved = false;
          selectionPanes.forEach(function(p) {
            var before = p.isWindow ? window.scrollY : p.el.scrollTop;
            (p.isWindow ? window : p.el).scrollTo({ top: p.origin + next,
              left: p.isWindow ? window.scrollX : p.el.scrollLeft, behavior: 'instant' });
            if (Math.abs((p.isWindow ? window.scrollY : p.el.scrollTop) - before) > 0.01) moved = true;
          });
          if (moved) selectionPaneY = next;
        }

        function collectScrollCandidates() {
          scrollCandidates = [];
          scrollCandidateOrigins.clear();
          scrollCandidateOrigins.set(document.scrollingElement, window.scrollY);
          document.querySelectorAll('*').forEach(function(el) {
            if (el === document.body || el === document.documentElement || overlay.contains(el)) return;
            if (el.scrollHeight <= el.clientHeight + 10 || el.clientHeight < 40) return;
            var css = window.getComputedStyle(el);
            if ((css.overflowY === 'auto' || css.overflowY === 'scroll') &&
                css.visibility === 'visible' && css.display !== 'none') {
              scrollCandidates.push(el);
              scrollCandidateOrigins.set(el, el.scrollTop);
            }
          });
        }

        function chooseScrollFromSelection() {
          if (!dragging) return;
          if (Math.abs(getScrollY() - (startY_doc - selectionStartY)) > 0.01) {
            selectionScrollLocked = true;
          }
          var windowRange = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
          // I popup mantengono lo scroller esclusivo. Fuori dai popup si
          // possono aggiungere colonne, compresa quella della pagina stessa.
          if (selectionScrollLocked && scrollTarget &&
              scrollTarget.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
          var left = Math.min(startX, currentX), right = Math.max(startX, currentX);
          var top = Math.min(selectionStartY, currentMouseY_vp);
          var bottom = Math.max(selectionStartY, currentMouseY_vp);
          if (right - left < 10 || bottom - top < 10) return;
          var selectionArea = (right - left) * (bottom - top);
          var chosen = initialScrollTarget;
          var smallestArea = Infinity;
          var columns = [];
          var activeDialog = initialScrollTarget && initialScrollTarget.closest('dialog[open], [role="dialog"], [aria-modal="true"]');
          var oldPointerEvents = overlay.style.pointerEvents;
          overlay.style.pointerEvents = 'none';
          try {
            scrollCandidates.forEach(function(el) {
              if (!el.isConnected) return;
              var r = el.getBoundingClientRect();
              var x1 = Math.max(0, r.left), x2 = Math.min(window.innerWidth, r.right);
              var y1 = Math.max(0, r.top), y2 = Math.min(window.innerHeight, r.bottom);
              // Escludi le porzioni nascoste da contenitori esterni.
              for (var parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                var pc = window.getComputedStyle(parent);
                var pr = parent.getBoundingClientRect();
                if (/^(auto|scroll|hidden|clip)$/.test(pc.overflowX)) {
                  x1 = Math.max(x1, pr.left); x2 = Math.min(x2, pr.right);
                }
                if (/^(auto|scroll|hidden|clip)$/.test(pc.overflowY)) {
                  y1 = Math.max(y1, pr.top); y2 = Math.min(y2, pr.bottom);
                }
              }
              var ix1 = Math.max(left, x1), ix2 = Math.min(right, x2);
              var iy1 = Math.max(top, y1), iy2 = Math.min(bottom, y2);
              var overlap = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
              if (overlap <= 0) return;
              // Non scegliere una colonna coperta da un popup in primo piano.
              var hit = document.elementFromPoint((ix1 + ix2) / 2, (iy1 + iy2) / 2);
              if (!hit || !el.contains(hit)) return;
              // Selezione di colonne: comprende almeno l'85% della larghezza
              // di ciascuna. I piccoli widget e i popup estranei non contano.
              // In verticale confronta la parte piu corta: includere anche
              // l'intestazione sopra la lista non deve penalizzare una
              // colonna il cui intero viewport e dentro la selezione.
              if (x2 - x1 >= 80 && y2 - y1 >= window.innerHeight * 0.5 &&
                  (ix2 - ix1) / (x2 - x1) >= MIN_SCROLL_OVERLAP &&
                  (iy2 - iy1) / Math.min(bottom - top, y2 - y1) >= MIN_SCROLL_OVERLAP &&
                  (!activeDialog || activeDialog.contains(el))) {
                columns.push({ el: el, left: x1, right: x2, top: y1, bottom: y2 });
              }
              if (overlap / selectionArea + 0.000001 < MIN_SCROLL_OVERLAP) return;
              var visibleArea = (x2 - x1) * (y2 - y1);
              // Tra contenitori annidati qualificati preferisci quello piu
              // specifico, non il grande contenitore che comprende la pagina.
              if (visibleArea < smallestArea) {
                chosen = el;
                smallestArea = visibleArea;
              }
            });
          } finally { overlay.style.pointerEvents = oldPointerEvents; }
          // Mai muovere insieme un contenitore e un suo figlio.
          columns = columns.filter(function(p) {
            return !columns.some(function(q) { return q !== p && p.el.contains(q.el); });
          }).sort(function(a, b) { return a.left - b.left; });
          // Caso misto: feed che scorre con window + sidebar indipendente.
          // La pagina NON e una colonna larga tutto il viewport: ritaglia
          // soltanto il suo main/feed, separato dai pannelli gia selezionati.
          if (columns.length && !activeDialog && windowRange >= window.innerHeight * 0.5) {
            var documentPane = null;
            var paneWidth = Infinity;
            var savedEvents = overlay.style.pointerEvents;
            overlay.style.pointerEvents = 'none';
            try {
              document.querySelectorAll('main, [role="main"], [role="feed"]').forEach(function(main) {
                if (scrollCandidates.some(function(el) { return el === main || el.contains(main); })) return;
                for (var ancestor = main; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
                  var css = window.getComputedStyle(ancestor);
                  if (css.position === 'fixed' || css.position === 'sticky' ||
                      css.visibility !== 'visible' || css.display === 'none') return;
                }
                var r = main.getBoundingClientRect();
                var x1 = Math.max(0, r.left), x2 = Math.min(window.innerWidth, r.right);
                var y1 = Math.max(0, r.top), y2 = Math.min(window.innerHeight, r.bottom);
                var width = x2 - x1, height = y2 - y1;
                if (width < 120 || height < window.innerHeight * 0.5 || width >= paneWidth) return;
                if (columns.some(function(p) { return Math.min(x2, p.right) - Math.max(x1, p.left) > 2; })) return;
                var ix1 = Math.max(left, x1), ix2 = Math.min(right, x2);
                var iy1 = Math.max(top, y1), iy2 = Math.min(bottom, y2);
                if ((ix2 - ix1) / width < MIN_SCROLL_OVERLAP ||
                    (iy2 - iy1) / Math.min(bottom - top, height) < MIN_SCROLL_OVERLAP) return;
                var front = document.elementFromPoint((ix1 + ix2) / 2, (iy1 + iy2) / 2);
                if (!front || !main.contains(front) || front.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
                documentPane = { el: document.scrollingElement, isWindow: true,
                  left: x1, right: x2, top: y1, bottom: y2 };
                paneWidth = width;
              });
            } finally { overlay.style.pointerEvents = savedEvents; }
            if (documentPane) {
              columns.push(documentPane);
              columns.sort(function(a, b) { return a.left - b.left; });
            }
          }
          var separate = columns.every(function(p, index) {
            return index === 0 || p.left >= columns[index - 1].right - 2;
          });
          if (selectionScrollLocked) {
            var retained = selectionPanes.length ? selectionPanes.map(function(p) { return p.el; }) : [scrollTarget || document.scrollingElement];
            if (!separate || columns.length <= retained.length || !retained.every(function(el) {
              return columns.some(function(p) { return p.el === el; });
            })) return;
          }
          // Una colonna + menu fisso: fallback solo se il documento non ha
          // una vera corsa. Non sottrarre lo scroll al feed di Facebook.
          var wideAppSelection = columns.length === 1 && smallestArea === Infinity &&
            windowRange < window.innerHeight * 0.5;
          if (separate && (columns.length > 1 || wideAppSelection)) {
            var same = columns.length === selectionPanes.length && columns.every(function(p, index) {
              return p.el === selectionPanes[index].el;
            });
            if (!same) {
              var oldPanes = selectionPanes;
              var oldTarget = scrollTarget;
              var oldOrigin = startY_doc - selectionStartY;
              var travelled = selectionScrollLocked ? getScrollY() - oldOrigin : 0;
              if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
              selectionPanes = columns.map(function(p) {
                var previous = oldPanes.find(function(old) { return old.el === p.el; });
                if (previous) p.origin = previous.origin;
                else if (selectionScrollLocked && p.el === (oldTarget || document.scrollingElement)) p.origin = oldOrigin;
                else p.origin = selectionScrollLocked && scrollCandidateOrigins.has(p.el)
                  ? scrollCandidateOrigins.get(p.el) : (p.isWindow ? window.scrollY : p.el.scrollTop);
                return p;
              });
              selectionPaneY = travelled;
              scrollTarget = columns[0].el;
              startY_doc = selectionStartY;
              leftTopZone = selectionStartY >= Math.min.apply(null, columns.map(function(p) { return p.top; })) + SCROLL_TRIGGER_ZONE;
              leftBottomZone = selectionStartY <= Math.max.apply(null, columns.map(function(p) { return p.bottom; })) - SCROLL_TRIGGER_ZONE;
              // Mantieni l'inizio della selezione: la nuova colonna segue
              // la distanza gia percorsa, senza azzerare altezza e ritaglio.
              if (selectionScrollLocked && !scrollPaused) scrollSelectionBy(0);
            }
            return;
          }
          if (selectionScrollLocked) return;
          if (selectionPanes.length) {
            selectionPanes = [];
            selectionPaneY = 0;
            startY_doc = selectionStartY + (chosen ? chosen.scrollTop : window.scrollY);
            if (chosen === scrollTarget && scrollTarget) {
              scrollTarget.addEventListener('scroll', onScrollDuringDrag);
            }
          }
          if (chosen === scrollTarget) return;
          if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
          scrollTarget = chosen;
          if (scrollTarget) scrollTarget.addEventListener('scroll', onScrollDuringDrag);
          // Lo stesso punto a schermo deve restare fermo anche se la colonna
          // scelta era gia scrollata: cambia solo il riferimento documento.
          startY_doc = selectionStartY + getScrollY();
          var edgeTop = 0, edgeBottom = window.innerHeight;
          if (scrollTarget) {
            var targetRect = scrollTarget.getBoundingClientRect();
            var targetTop = targetRect.top + scrollTarget.clientTop;
            edgeTop = Math.max(0, targetTop);
            edgeBottom = Math.min(window.innerHeight, targetTop + scrollTarget.clientHeight);
          }
          var edgeZone = Math.min(SCROLL_TRIGGER_ZONE, Math.max(1, (edgeBottom - edgeTop) / 3));
          leftTopZone = selectionStartY >= edgeTop + edgeZone;
          leftBottomZone = selectionStartY <= edgeBottom - edgeZone;
        }

        function resolveScrollTarget(mx, my, fromSelectionStart) {
          // Durante il drag la scelta passa al rettangolo, poi resta bloccata
          // appena si muove lo scroller. Qui gestiamo solo il punto iniziale.
          // Prima del drag la rotella segue il contenuto sotto il mouse.
          if (scrollTargetResolved && dragging) return;
          scrollTargetResolved = true;
          var prevPE = overlay.style.pointerEvents;
          overlay.style.pointerEvents = 'none';
          var hit;
          try { hit = document.elementFromPoint(mx, my); }
          finally { overlay.style.pointerEvents = prevPE; }

          function scrollabile(el) {
            var st = window.getComputedStyle(el);
            return (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
              el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 10;
          }

          // Il contenuto in primo piano precede la pagina dietro, anche
          // quando lo sfondo puo ancora essere scrollato via JavaScript.
          var dialog = hit && hit.closest('dialog[open], [role="dialog"], [aria-modal="true"]');
          var el = hit;
          while (el && el !== document.body && el !== document.documentElement) {
            if (scrollabile(el)) {
              scrollTarget = el;
              return;
            }
            if (el === dialog) break;
            el = el.parentElement;
          }

          if (dialog) {
            // Titolo e bordi del popup usano il suo scroller interno.
            // Se non ce n'e uno, non si deve muovere la pagina dietro.
            var inside = dialog.querySelectorAll('*');
            var bestInside = null;
            var bestArea = 0;
            var dialogRect = dialog.getBoundingClientRect();
            for (var d = 0; d < inside.length; d++) {
              if (!scrollabile(inside[d])) continue;
              var ir = inside[d].getBoundingClientRect();
              var visibleW = Math.max(0, Math.min(ir.right, dialogRect.right, window.innerWidth) - Math.max(ir.left, dialogRect.left, 0));
              var visibleH = Math.max(0, Math.min(ir.bottom, dialogRect.bottom, window.innerHeight) - Math.max(ir.top, dialogRect.top, 0));
              var visibleArea = visibleW * visibleH;
              if (window.getComputedStyle(inside[d]).visibility !== 'hidden' && visibleArea > bestArea) {
                bestInside = inside[d];
                bestArea = visibleArea;
              }
            }
            scrollTarget = bestInside || dialog;
            return;
          }
          // Se la finestra scrolla DAVVERO, usa window (pagine normali). Prova
          // pratica invece del confronto di altezze: sui siti col BODY-scroller
          // (es. betexplorer) il documento è alto ma window è inchiodata — lì
          // il target giusto è il body/contenitore, non la finestra.
          var y0 = window.scrollY;
          window.scrollTo({ top: (y0 > 0 ? y0 - 1 : y0 + 1), left: window.scrollX, behavior: 'instant' });
          var winMoved = window.scrollY !== y0;
          window.scrollTo({ top: y0, left: window.scrollX, behavior: 'instant' });
          // CORSA VERA (vedi doFullCapture): 1-2px di gioco della finestra
          // non fanno di lei lo scroller — Yahoo Mail lascia 1px e il
          // contenuto vero vive in un contenitore interno.
          var corsaWin = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) - window.innerHeight;
          if (winMoved && corsaWin >= window.innerHeight * 0.5) {
            scrollTarget = null;
            return;
          }
          // Il logo/intestazione di una web app puo stare fuori dallo
          // scroller, pur essendo nella stessa fascia orizzontale. Solo
          // all'inizio della selezione cerca la colonna visibile sotto:
          // la rotella prima del drag continua a seguire il punto reale.
          if (fromSelectionStart && corsaWin < window.innerHeight * 0.5) {
            var aligned = null;
            var nearestTop = Infinity;
            var narrowest = Infinity;
            var savedPE = overlay.style.pointerEvents;
            overlay.style.pointerEvents = 'none';
            try {
              document.querySelectorAll('*').forEach(function(candidate) {
                if (overlay.contains(candidate) || !scrollabile(candidate)) return;
                var r = candidate.getBoundingClientRect();
                var left = Math.max(0, r.left), right = Math.min(window.innerWidth, r.right);
                var bottom = Math.min(window.innerHeight, r.bottom);
                if (mx < left || mx >= right || my >= r.top || r.top >= window.innerHeight * 0.5 ||
                    right - left < 80 || bottom - r.top < window.innerHeight * 0.4) return;
                var css = window.getComputedStyle(candidate);
                if (css.visibility !== 'visible' || css.display === 'none') return;
                var front = document.elementFromPoint(mx, (r.top + bottom) / 2);
                if (!front || !candidate.contains(front) ||
                    front.closest('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
                if (r.top < nearestTop || (r.top === nearestTop && right - left < narrowest)) {
                  aligned = candidate;
                  nearestTop = r.top;
                  narrowest = right - left;
                }
              });
            } finally { overlay.style.pointerEvents = savedPE; }
            if (aligned) { scrollTarget = aligned; return; }
          }
          // Fallback per le app: solo contenitori sotto il punto selezionato,
          // senza deviare verso un popup o una colonna altrove.
          var all = document.querySelectorAll('*');
          var best = null;
          for (var j = 0; j < all.length; j++) {
            var e2 = all[j];
            if (e2.id === '__screenshot_area_overlay') continue;
            var fallbackRect = e2.getBoundingClientRect();
            if (mx < fallbackRect.left || mx >= fallbackRect.right ||
                my < fallbackRect.top || my >= fallbackRect.bottom) continue;
            var s2 = window.getComputedStyle(e2);
            var o2 = s2.overflowY;
            if ((o2 === 'auto' || o2 === 'scroll') && e2.scrollHeight > e2.clientHeight + 10) {
              if (!best || e2.scrollHeight > best.scrollHeight) best = e2;
            }
          }
          scrollTarget = best;
        }

        function getScrollY() {
          if (selectionPanes.length) return selectionPaneY;
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

          // Le dimensioni seguono il bordo del box, ma restano a schermo
          // anche quando l'inizio della selezione scorre fuori dal viewport.
          dim.textContent = Math.round(w) + ' × ' + Math.round(height) + ' px';
          dim.style.display = 'block';
          var labelTop = top_vp - dim.offsetHeight - 6;
          if (labelTop < 4) labelTop = top_vp + 6; // niente spazio sopra -> dentro/sotto
          dim.style.left = Math.max(4, Math.min(x, window.innerWidth - dim.offsetWidth - 4)) + 'px';
          dim.style.top = Math.max(4, Math.min(labelTop, window.innerHeight - dim.offsetHeight - 4)) + 'px';
        }

        function autoScrollLoop() {
          if (!dragging) { scrollRAF = null; return; }
          if (scrollPaused) {
            scrollRAF = requestAnimationFrame(autoScrollLoop);
            return;
          }
          resolveScrollTarget(currentX, currentMouseY_vp);
          // Prima di scegliere serve un rettangolo reale, non un primo
          // movimento di pochi pixel che bloccherebbe subito lo sfondo.
          if (!selectionScrollLocked && (Math.abs(currentX - startX) < 10 ||
              Math.abs(currentMouseY_vp - selectionStartY) < 10)) {
            scrollRAF = requestAnimationFrame(autoScrollLoop);
            return;
          }

          var scrollTopEdge = 0;
          var scrollBottomEdge = window.innerHeight;
          if (scrollTarget) {
            var scrollRect = scrollTarget.getBoundingClientRect();
            var contentTop = scrollRect.top + scrollTarget.clientTop;
            scrollTopEdge = Math.max(0, contentTop);
            scrollBottomEdge = Math.min(window.innerHeight, contentTop + scrollTarget.clientHeight);
          }
          if (selectionPanes.length) {
            scrollTopEdge = Math.min.apply(null, selectionPanes.map(function(p) { return p.top; }));
            scrollBottomEdge = Math.max.apply(null, selectionPanes.map(function(p) { return p.bottom; }));
          }
          var triggerZone = Math.min(SCROLL_TRIGGER_ZONE, Math.max(1, (scrollBottomEdge - scrollTopEdge) / 3));
          // Aggiorna i flag: il mouse è "uscito" da una zona quando si trova fuori da essa
          if (lastMouseY >= scrollTopEdge + triggerZone) leftTopZone = true;
          if (lastMouseY <= scrollBottomEdge - triggerZone) leftBottomZone = true;
          var speed = 0;
          // TURBO: nell'ultima fascia vicino al bordo (30px) si corre forte;
          // nel resto della zona la velocita' resta dolce come prima, per
          // mirare con precisione. 10px erano troppo pochi: nella pratica il
          // mouse non ci stava mai dentro e il turbo non partiva.
          var TURBO_ZONE = 30;
          var TURBO_SPEED = 50;
          if (leftBottomZone && lastMouseY > scrollBottomEdge - triggerZone) {
            var distFromBottom = scrollBottomEdge - lastMouseY;
            if (distFromBottom <= TURBO_ZONE) {
              speed = TURBO_SPEED;
            } else {
              var ratio = 1 - (distFromBottom / triggerZone);
              speed = SCROLL_SPEED_MIN + ratio * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN);
            }
          } else if (leftTopZone && lastMouseY < scrollTopEdge + triggerZone) {
            var distFromTop = lastMouseY - scrollTopEdge;
            if (distFromTop <= TURBO_ZONE) {
              speed = -TURBO_SPEED;
            } else {
              var ratio2 = 1 - (distFromTop / triggerZone);
              speed = -(SCROLL_SPEED_MIN + ratio2 * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN));
            }
          }
          if (speed !== 0) {
            var beforeScroll = getScrollY();
            // behavior 'instant': su siti con CSS scroll-behavior:smooth ogni
            // scrollBy per-frame diventerebbe un'animazione che riparte da capo,
            // strozzando la velocita' reale qualunque sia il passo richiesto.
            scrollSelectionBy(speed);
            if (Math.abs(getScrollY() - beforeScroll) > 0.01) selectionScrollLocked = true;
            updateBox();
          }
          scrollRAF = requestAnimationFrame(autoScrollLoop);
        }

        // POINTER CAPTURE: da qui in poi movimenti e rilascio arrivano
        // all'overlay ANCHE fuori dalla finestra del browser (barra di
        // Windows compresa). Senza, un rilascio fuori finestra si perdeva
        // e la selezione restava appesa a metà.
        overlay.addEventListener('pointerdown', function(pe) {
          try { overlay.setPointerCapture(pe.pointerId); } catch (senzaCapture) {}
        });
        overlay.addEventListener('mousedown', function(e) {
          // Impedisce alla trascinata di avviare la selezione NATIVA del testo
          // (evidenziatura blu sotto l'overlay quando il mouse corre più
          // veloce dell'auto-scroll o esce dalla finestra del browser).
          e.preventDefault();
          // Se il mouse non si è mai mosso la punta virtuale non esiste
          // ancora: parte dal cursore vero.
          if (!mouseVisto) {
            virtX = e.clientX;
            virtY = e.clientY;
            lastEvX = e.clientX;
            lastEvY = e.clientY;
          }
          resolveScrollTarget(virtX, virtY, true);
          initialScrollTarget = scrollTarget;
          selectionPanes = [];
          selectionPaneY = 0;
          selectionStartY = virtY;
          selectionScrollLocked = false;
          collectScrollCandidates();
          lastMouseY = e.clientY;
          if (scrollTarget) scrollTarget.addEventListener('scroll', onScrollDuringDrag);
          // Rileva se la selezione parte dentro un elemento sticky/fixed (es. top bar):
          // in tal caso quell'elemento andrà incluso nella prima slice.
          var prevPE2 = overlay.style.pointerEvents;
          overlay.style.pointerEvents = 'none';
          var elUnder = document.elementFromPoint(virtX, virtY);
          overlay.style.pointerEvents = prevPE2;
          var oldStart = document.querySelector('[data-screenshot-start-sticky]');
          if (oldStart) oldStart.removeAttribute('data-screenshot-start-sticky');
          while (elUnder && elUnder !== document.body && elUnder !== document.documentElement) {
            var pos2 = window.getComputedStyle(elUnder).position;
            if (pos2 === 'fixed' || pos2 === 'sticky') {
              // Solo BARRE VERE, con gli stessi criteri di forma usati per
              // misurarle (larghe almeno mezza finestra, basse meno di un
              // terzo). Senza questo filtro bastava la SCOCCA dell'app —
              // sulle web app moderne è spesso un fixed a tutta finestra col
              // contenuto che scorre dentro — per far credere al motore che
              // la selezione fosse partita dentro una barra: la difesa contro
              // l'header in cima si spegneva e l'header mangiava l'inizio
              // della selezione, in ogni punto della pagina.
              var rr = elUnder.getBoundingClientRect();
              if (rr.height > 0 &&
                  rr.width >= window.innerWidth * 0.5 &&
                  rr.height < window.innerHeight * 0.3) {
                elUnder.setAttribute('data-screenshot-start-sticky', 'true');
                break;
              }
            }
            elUnder = elUnder.parentElement;
          }
          // Il punto di partenza è la punta VIRTUALE frenata — quella che
          // la lente mostrava al momento del click, non il cursore fisico.
          startX = virtX;
          currentX = virtX;
          currentMouseY_vp = virtY;
          startY_doc = virtY + getScrollY();
          accX = 0;
          accY = 0;
          mouseVisto = true;
          ultimoMX = virtX;
          ultimoMY = virtY;
          disegnaLente();
          dragging = true;
          overlay.style.transition = 'none';
          overlay.style.background = 'transparent';
          box.style.display = 'block';
          box.style.left = virtX + 'px';
          box.style.top = virtY + 'px';
          box.style.width = '0px';
          box.style.height = '0px';
          info.style.display = 'none';
        });

        overlay.addEventListener('mousemove', function(e) {
          mouseVisto = true;
          // Il freno lavora SEMPRE, anche prima del click: si mira il punto
          // di partenza con la lente, che segue la punta virtuale frenata.
          aggiornaVirtuale(e);
          ultimoMX = virtX;
          ultimoMY = virtY;
          disegnaLenteRaf();
          if (!dragging) return;
          lastMouseY = e.clientY;   // la zona turbo legge il mouse REALE
          syncSelectionPointer();
          if (!scrollRAF) scrollRAF = requestAnimationFrame(autoScrollLoop);
          chooseScrollFromSelection();
          updateBox();
        });

        // Aggiorna il box quando l'utente scrolla con la rotellina durante il drag.
        // Sul window per le pagine normali; sul div scrollabile (agganciato nel
        // mousedown) per le app con scroll custom tipo claude.ai.
        function onScrollDuringDrag() {
          if (dragging) {
            if (Math.abs(getScrollY() - (startY_doc - selectionStartY)) > 0.01) selectionScrollLocked = true;
            updateBox();
          }
        }
        window.addEventListener('scroll', onScrollDuringDrag, true);

        // L'overlay copre la pagina, quindi la rotellina non arriva più allo
        // scroller sottostante. Va inoltrata SEMPRE, anche PRIMA di iniziare a
        // trascinare: in modalità Area ci si deve poter posizionare con la
        // rotella sia nel giro normale sia in Multi Snip.
        overlay.addEventListener('wheel', function(e) {
          if (scrollPaused) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
          }
          if (dragging) chooseScrollFromSelection();
          resolveScrollTarget(e.clientX, e.clientY);
          e.stopPropagation();
          var beforeScroll = getScrollY();
          if (dragging && selectionPanes.length) {
            scrollSelectionBy(e.deltaY);
            e.preventDefault();
          } else if (scrollTarget) {
            scrollTarget.scrollTop += e.deltaY;
            e.preventDefault();
          } else {
            window.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'instant' });
            e.preventDefault();
          }
          if (dragging) {
            if (Math.abs(getScrollY() - beforeScroll) > 0.01) selectionScrollLocked = true;
            updateBox();
          }
        }, { passive: false });

        overlay.addEventListener('mouseup', function(e) {
          if (!dragging) return;
          aggiornaVirtuale(e);
          syncSelectionPointer();
          chooseScrollFromSelection();
          dragging = false;
          window.removeEventListener('scroll', onScrollDuringDrag, true);
          if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
          // La fine della selezione è la punta VIRTUALE (col freno di
          // precisione attivo può stare qualche px indietro dal cursore).
          var endY_doc = currentMouseY_vp + getScrollY();
          var endX = currentX;
          var y_doc = Math.min(startY_doc, endY_doc);
          var h_doc = Math.abs(endY_doc - startY_doc);
          var x = Math.min(endX, startX);
          var w = Math.abs(endX - startX);

          if (scrollTarget) {
            scrollTarget.setAttribute('data-screenshot-area-scroll', 'true');
          }

          cleanupSelectionInput();
          overlay.remove();
          var nsFine = document.getElementById('__screenshot_noselect');
          if (nsFine) nsFine.remove();
          try { window.getSelection().removeAllRanges(); } catch (errSel) {}
          if (w < 10 || h_doc < 10) {
            if (scrollTarget) scrollTarget.removeAttribute('data-screenshot-area-scroll');
            return;
          }

          var paneData = selectionPanes.map(function(p, index) {
            p.el.setAttribute('data-screenshot-area-pane', String(index));
            return { origin: p.origin, isWindow: !!p.isWindow, left: p.left, right: p.right, top: p.top, bottom: p.bottom };
          });
          window.__screenshotArea = {
            x: x,
            y_doc: y_doc,
            w: w,
            h_doc: h_doc,
            hasCustomScroll: !!scrollTarget,
            panes: paneData,
            dpr: window.devicePixelRatio || 1
          };
        });

        function onKey(e) {
          if (!overlay.isConnected) {
            // Se il mouse e stato rilasciato prima di Spazio, consuma le
            // ripetizioni del tasto fino al rilascio anche durante lo scatto.
            if (scrollPaused && (e.code === 'Space' || e.key === ' ')) {
              e.preventDefault();
              e.stopImmediatePropagation();
            }
            cleanupSelectionInput();
            return;
          }
          if ((e.code === 'Space' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!scrollPaused) {
              scrollPaused = true;
              showScrollPause();
              if (dragging) { syncSelectionPointer(); updateBox(); }
            }
            return;
          }
          if (e.key === 'Escape') {
            cleanupSelectionInput();
            overlay.remove();
            var nsEsc = document.getElementById('__screenshot_noselect');
            if (nsEsc) nsEsc.remove();
            try { window.getSelection().removeAllRanges(); } catch (errSel) {}
            window.removeEventListener('scroll', onScrollDuringDrag, true);
            if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
          }
        }
        function onKeyUp(e) {
          if (e.code !== 'Space' && e.key !== ' ') return;
          if (!scrollPaused) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          scrollPaused = false;
          if (!overlay.isConnected) { cleanupSelectionInput(); return; }
          showScrollPause();
          if (dragging) { syncSelectionPointer(); updateBox(); }
        }
        function onSelectionBlur() {
          // Un rilascio avvenuto fuori dal browser non deve lasciare la pausa
          // incastrata. Lo scroll riparte solo al successivo movimento mouse.
          scrollPaused = false;
          if (!overlay.isConnected) { cleanupSelectionInput(); return; }
          showScrollPause();
          if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
        }
        function cleanupSelectionInput() {
          dragging = false;
          if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = null; }
          if (!scrollPaused) {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onSelectionBlur);
          }
          window.removeEventListener('scroll', onScrollDuringDrag, true);
          if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
        }
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onSelectionBlur);
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

    var compResult;
    if (area.panes && area.panes.length) {
      areaScrollbarsHidden = true;
      compResult = [{ result: await captureAreaPanes(tabId, area) }];
    } else {

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
        // La barra da cui è PARTITA la selezione l'utente la vuole nello
        // scatto: per quella non si compensa. Ma le ALTRE barre in cima
        // continuano a coprire l'inizio, quindi vanno contate lo stesso —
        // prima bastava una barra qualsiasi sotto il punto di partenza per
        // disattivare la compensazione di tutte.
        var barraPartenza = document.querySelector('[data-screenshot-start-sticky]');
        var bordoTop = el ? offsetY : 0;
        var tutti = document.querySelectorAll('*');
        for (var k = 0; k < tutti.length; k++) {
          if (barraPartenza && (tutti[k] === barraPartenza ||
              tutti[k].contains(barraPartenza) || barraPartenza.contains(tutti[k]))) continue;
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
    if (!area.hasCustomScroll && !giaVisibile && numSlices > 1) {
      captureBackgrounds = await prepareCaptureBackgrounds(tabId);
    }

    var captures = [];
    var deltas = [];  // di quanto lo scroll è rimasto indietro rispetto al voluto (per slice)
    var realScrolls = [];  // scroll reale (frazionario) raggiunto da ogni slice: serve
                           // per ancorare ogni slice alla sua POSIZIONE assoluta in cucitura
    var bottomOverlay = null;
    var bottomOverlayTop = null;

    sendProgress('Cattura area...', 5);

    for (var i = 0; i < numSlices; i++) {
      var pct = Math.round(((i + 1) / numSlices) * 85) + 5;
      sendProgress('Cattura ' + (i + 1) + ' di ' + numSlices + '...', pct);

      // area.y_doc è in coordinate "viewport tab + scroll": per lo scroll del div
      // serve la coordinata interna al div, quindi sottraiamo l'offset del container.
      // Su window scroll offsetY=0, quindi invariato.
      // Se la selezione è già tutta visibile, lo scroll voluto è quello ATTUALE
      // (meta.sy): non muovo la pagina, catturo dov'è.
      var startPos = area.y_doc - meta.offsetY;
      var ultimaSlice = !giaVisibile && numSlices > 1 && i === numSlices - 1;
      var basePos = giaVisibile ? meta.sy : (startPos + i * sliceH);
      // L'ultima fetta parte abbastanza indietro da portare il fondo della
      // selezione sul fondo del viewport. Oltre a creare un overlap misurabile
      // con la fetta precedente, questo mantiene le barre ancorate in basso
      // (composer delle chat, footer mobili) nel loro bordo reale: il fondo.
      if (ultimaSlice) {
        basePos = Math.max(0, startPos + area.h_doc - sliceH);
      }
      // BARRA FISSA IN CIMA (header Facebook e simili): si scrolla ARRETRATI
      // del suo spessore. Prima fetta: la barra è visibile e coprirebbe
      // l'inizio della selezione — il delta risultante fa partire il ritaglio
      // subito SOTTO la barra. Fette successive: la barra è già nascosta dal
      // censimento sticky, ma l'arretramento uniforme tiene le fette contigue.
      var coverTop = giaVisibile ? 0 : (meta.topCover || 0);
      // Sull'ultima fetta la top bar è già nascosta: sottrarre ancora coverTop
      // sposterebbe il fondo selezionato sotto al viewport.
      var wantedScroll = ultimaSlice
        ? Math.max(0, basePos)
        : (coverTop ? Math.max(0, basePos - coverTop) : basePos);
      var scrollResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(targetScroll, hasCustomScroll, idx, lastIdx, selectedWidth) {
          function allElementsDeep(root) {
            var result = [];
            var scopes = [root];
            while (scopes.length) {
              var scope = scopes.shift();
              var found = scope.querySelectorAll('*');
              for (var de = 0; de < found.length; de++) {
                result.push(found[de]);
                if (found[de].shadowRoot) scopes.push(found[de].shadowRoot);
              }
            }
            return result;
          }

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
            function aggiungiSticky(el, diretto) {
              for (var a = 0; a < window.__screenshotStickies.length; a++) {
                if (window.__screenshotStickies[a].el === el) {
                  if (diretto) window.__screenshotStickies[a].diretto = true;
                  return;
                }
              }
              window.__screenshotStickies.push({
                el: el,
                oldVis: el.style.visibility,
                diretto: diretto,
                parentIdx: -1,
                classified: false,
                bottomRoot: false,
                bottomGroup: false
              });
            }
            var allEls = allElementsDeep(document);
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
                aggiungiSticky(allEls[k], true);
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
                    aggiungiSticky(sib.children[w], false);
                  }
                }
                nodeUp = par;
              }
            }

            // Collega ogni candidato al candidato antenato più vicino. La barra
            // viene classificata come un unico blocco: un pulsante in fondo a una
            // sidebar non deve trascinare tutta la sidebar a fondo immagine.
            for (var c = 0; c < window.__screenshotStickies.length; c++) {
              var padre = window.__screenshotStickies[c].el.parentElement;
              while (padre) {
                var trovato = -1;
                for (var pIdx = 0; pIdx < window.__screenshotStickies.length; pIdx++) {
                  if (window.__screenshotStickies[pIdx].el === padre) {
                    trovato = pIdx;
                    break;
                  }
                }
                if (trovato >= 0) {
                  window.__screenshotStickies[c].parentIdx = trovato;
                  break;
                }
                padre = padre.parentElement;
              }
            }
          }

          // Alcuni siti applicano position:fixed solo DOPO il primo scroll
          // (Transfermarkt lo fa con la barra di navigazione della squadra).
          // Il censimento iniziale quindi non basta: a ogni fetta aggiungiamo
          // gli elementi che nel frattempo sono diventati fixed/sticky.
          function scanDynamicStickies() {
          var scrollAncNow = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
          var currentEls = allElementsDeep(document);
          var addedNow = false;
          for (var dk = 0; dk < currentEls.length; dk++) {
            if (currentEls[dk].id === '__screenshot_area_overlay') continue;
            var dp = window.getComputedStyle(currentEls[dk]).position;
            if (dp !== 'fixed' && dp !== 'sticky') continue;
            if (scrollAncNow && currentEls[dk].contains(scrollAncNow)) continue;
            var dr = currentEls[dk].getBoundingClientRect();
            if (dr.width >= window.innerWidth * 0.9 && dr.height >= window.innerHeight * 0.9) continue;
            var known = false;
            for (var di = 0; di < window.__screenshotStickies.length; di++) {
              if (window.__screenshotStickies[di].el === currentEls[dk]) { known = true; break; }
            }
            if (known) continue;
            window.__screenshotStickies.push({
              el: currentEls[dk],
              oldVis: currentEls[dk].style.visibility,
              diretto: true,
              parentIdx: -1,
              classified: false,
              bottomRoot: false,
              bottomGroup: false
            });
            addedNow = true;
          }

          // Un nuovo contenitore fixed può diventare il padre di elementi già
          // censiti: in quel caso ricostruiamo i gruppi prima di nasconderli.
          if (addedNow) {
            for (var ri = 0; ri < window.__screenshotStickies.length; ri++) {
              window.__screenshotStickies[ri].parentIdx = -1;
              var dynamicParent = window.__screenshotStickies[ri].el.parentElement;
              while (dynamicParent) {
                var dynamicParentIdx = -1;
                for (var dpi = 0; dpi < window.__screenshotStickies.length; dpi++) {
                  if (window.__screenshotStickies[dpi].el === dynamicParent) {
                    dynamicParentIdx = dpi;
                    break;
                  }
                }
                if (dynamicParentIdx >= 0) {
                  window.__screenshotStickies[ri].parentIdx = dynamicParentIdx;
                  break;
                }
                dynamicParent = dynamicParent.parentElement;
              }
            }
          }
          }

          // Gestione robusta indipendente dal solo CSS: un micro-scroll distingue
          // ciò che scorre col contenuto da ciò che resta ancorato al viewport.
          // Gli ancorati in alto compaiono nella prima fetta, quelli in basso
          // nell'ultima. L'elemento da cui è partita la selezione resta invece
          // nella prima fetta, perché è stato incluso volontariamente dall'utente.
          function manageStickies(scrollNow, hasCustomScroll) {
            var scrollEl = hasCustomScroll ? document.querySelector('[data-screenshot-area-scroll]') : null;
            function getS() { return scrollEl ? scrollEl.scrollTop : window.scrollY; }
            // Anche sui siti con scroll-behavior:smooth il micro-scroll e il
            // ripristino devono terminare PRIMA di misurare l'ancoraggio.
            function setS(v) {
              (scrollEl || window).scrollTo({ top: v,
                left: scrollEl ? scrollEl.scrollLeft : window.scrollX, behavior: 'instant' });
            }
            // ripristina la visibility originale di tutti
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              window.__screenshotStickies[s].el.style.visibility = window.__screenshotStickies[s].oldVis;
              window.__screenshotStickies[s].hiddenByCapture = false;
            }
            // Una sola fetta rappresenta già esattamente ciò che è a schermo.
            if (lastIdx === 0) return;

            var base = getS();
            var rects1 = [];
            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              var r1 = window.__screenshotStickies[s].el.getBoundingClientRect();
              rects1.push({ top: r1.top, bottom: r1.bottom, width: r1.width, height: r1.height });
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
            var anchoredNow = [];
            for (var aNow = 0; aNow < window.__screenshotStickies.length; aNow++) {
              anchoredNow.push(scrollMoved && (Math.abs(rects1[aNow].top - tops2[aNow]) < 2));
            }

            // La classificazione avviene sui contenitori radice, non sui singoli
            // pulsanti: così una voce in fondo a una sidebar non viene scambiata
            // per una barra inferiore autonoma.
            for (var rIdx = 0; rIdx < window.__screenshotStickies.length; rIdx++) {
              var rootItem = window.__screenshotStickies[rIdx];
              if (rootItem.parentIdx >= 0 || rootItem.classified || !anchoredNow[rIdx]) continue;
                var rootEl = rootItem.el;
                var rr = rects1[rIdx];
                var usaScroller = scrollEl && scrollEl.contains(rootEl);
                var bordoTop = 0;
                var bordoBottom = window.innerHeight;
                var larghezzaVista = window.innerWidth;
                if (usaScroller) {
                  var sr = scrollEl.getBoundingClientRect();
                  var rawTop = sr.top + (scrollEl.clientTop || 0);
                  var rawBottom = rawTop + scrollEl.clientHeight;
                  bordoTop = Math.max(0, rawTop);
                  bordoBottom = Math.min(window.innerHeight, rawBottom);
                  larghezzaVista = scrollEl.clientWidth;
                }
                // Vicino al fondo non basta: una colonna sticky o un post
                // molto alto possono essere piu vicini al bordo inferiore.
                // Solo una vera fascia bassa puo essere ricatturata al fondo
                // dello scroller, altrimenti si incollano post estranei.
                var altezzaVista = bordoBottom - bordoTop;
                var vicinoAlFondo = Math.abs(bordoBottom - rr.bottom) <= 64 &&
                  Math.abs(bordoBottom - rr.bottom) < Math.abs(rr.top - bordoTop);
                var barraOrizzontale = rr.width > rr.height * 1.5 &&
                  rr.width >= Math.min(larghezzaVista * 0.35, selectedWidth * 0.5);
                var fasciaBassa = rr.height > 0 && rr.height <= altezzaVista * 0.35 &&
                  rr.top >= bordoTop && rr.bottom <= bordoBottom + 2;
                rootItem.bottomRoot = vicinoAlFondo && barraOrizzontale && fasciaBassa;
                rootItem.classified = true;
            }
            for (var gIdx = 0; gIdx < window.__screenshotStickies.length; gIdx++) {
              var rootIdx = gIdx;
              while (window.__screenshotStickies[rootIdx].parentIdx >= 0) {
                rootIdx = window.__screenshotStickies[rootIdx].parentIdx;
              }
              window.__screenshotStickies[gIdx].bottomGroup =
                window.__screenshotStickies[rootIdx].bottomRoot === true;
            }

            for (var s = 0; s < window.__screenshotStickies.length; s++) {
              var item = window.__screenshotStickies[s];
              if (item.bottomGroup || (idx > 0 && anchoredNow[s])) {
                item.el.style.visibility = 'hidden';
                item.hiddenByCapture = true;
              }
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
                scanDynamicStickies();
                manageStickies(cy, hasCustomScroll);
                resolve(cy);
              }
            }, 50);
          });
        },
        args: [wantedScroll, area.hasCustomScroll, i, numSlices - 1, area.w]
      });
      var realScroll = scrollResult[0].result;

      await sleep(350);
      if (area.hasCustomScroll) {
        areaScrollbarsHidden = true;
        await hideAreaCustomScrollbars(tabId);
      }

      // Rilettura NELL'ISTANTE dello scatto: certe liste (webmail) si
      // ri-agganciano a multipli di riga DURANTE l'attesa post-assestamento
      // — la posizione letta all'assestamento diventa bugiarda e l'overlap
      // atteso sbagliava di una riga, tagliando le mail alle giunture.
      var riletto = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(custom) {
          var el = custom ? document.querySelector('[data-screenshot-area-scroll]') : null;
          return el ? el.scrollTop : window.scrollY;
        },
        args: [area.hasCustomScroll]
      });
      if (riletto && riletto[0] && typeof riletto[0].result === 'number') {
        realScroll = riletto[0].result;
      }
      // Prima fetta: delta misurato rispetto alla posizione NON arretrata,
      // così il ritaglio parte sotto la barra fissa (delta = spessore barra).
      // Fette successive: rispetto al target arretrato (delta 0 se raggiunto).
      deltas.push((i === 0 ? basePos : wantedScroll) - realScroll);
      realScrolls.push(realScroll);  // posizione assoluta reale di questa slice

      // LOG DIAGNOSTICO problema "selezione corta in fondo cattura piu in alto":
      console.log('[AREA slice ' + i + '/' + (numSlices-1) + '] wantedScroll=' + wantedScroll +
        ' realScroll=' + realScroll + ' DELTA(voluto-reale)=' + (wantedScroll - realScroll) +
        ' | area.y_doc=' + area.y_doc + ' offsetY=' + meta.offsetY +
        ' sliceH=' + sliceH + ' h_doc=' + area.h_doc +
        ' topCover=' + meta.topCover + ' giaVisibile=' + giaVisibile);

      var dataUrl = null;
      for (var retry = 0; retry < 3; retry++) {
        try {
          if (captureBackgrounds) await syncCaptureBackgrounds(tabId);
          dataUrl = await captureStitchedFrame(tabId);
          break;
        } catch (captureErr) {
          if (retry < 2 && captureErr.message.indexOf('MAX_CAPTURE') !== -1) {
            await sleep(600);
          } else {
            throw captureErr;
          }
        }
      }
      // DEDUP PER CONTENUTO (stessa difesa del Full Page): foto identica
      // alla precedente = la vista non è avanzata davvero, anche se lo
      // scroller dichiara il contrario. Fetta e posizioni scartate.
      if (captures.length && dataUrl === captures[captures.length - 1]) {
        deltas.pop();
        realScrolls.pop();
        continue;
      }
      captures.push(dataUrl);
    }

    // Le barre inferiori non partecipano alle fette normali: altererebbero dedup
    // e overlap. Per renderle stabili anche quando la selezione finisce prima,
    // questa ripresa separata viene fatta al fondo REALE dello scroller.
    var bottomInfoResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(hasCustomScroll) {
        var list = window.__screenshotStickies || [];
        var haBarraBassa = false;
        for (var i = 0; i < list.length; i++) {
          if (list[i].bottomRoot) haBarraBassa = true;
        }
        if (!haBarraBassa) return null;

        var scrollEl = hasCustomScroll
          ? document.querySelector('[data-screenshot-area-scroll]')
          : null;
        function leggiScroll() { return scrollEl ? scrollEl.scrollTop : window.scrollY; }
        if (scrollEl) {
          scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
        } else {
          window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
        }

        return new Promise(function(resolve) {
          var ultimo = -1;
          var fermo = 0;
          var giri = 0;
          var timer = setInterval(function() {
            var corrente = leggiScroll();
            fermo = Math.abs(corrente - ultimo) < 1 ? fermo + 1 : 0;
            ultimo = corrente;
            giri++;
            if (fermo < 2 && giri < 20) return;
            clearInterval(timer);

            var minTop = Infinity;
            for (var j = 0; j < list.length; j++) {
              if (list[j].bottomGroup) {
                list[j].el.style.visibility = list[j].oldVis;
                list[j].hiddenByCapture = false;
              }
            }
            requestAnimationFrame(function() {
              requestAnimationFrame(function() {
                for (var k = 0; k < list.length; k++) {
                  if (!list[k].bottomRoot) continue;
                  var r = list[k].el.getBoundingClientRect();
                  if (r.height > 0 && r.width > 0) minTop = Math.min(minTop, r.top);
                }
                // Include avviso, distanza e ombra insieme al campo.
                resolve(minTop < Infinity
                  ? { top: Math.max(0, Math.floor(minTop - 64)) }
                  : null);
              });
            });
          }, 50);
        });
      },
      args: [area.hasCustomScroll]
    });
    var bottomInfo = bottomInfoResult && bottomInfoResult[0] && bottomInfoResult[0].result;
    if (bottomInfo && typeof bottomInfo.top === 'number') {
      await sleep(350);
      if (area.hasCustomScroll) await hideAreaCustomScrollbars(tabId);
      for (var overlayRetry = 0; overlayRetry < 3; overlayRetry++) {
        try {
          if (captureBackgrounds) await syncCaptureBackgrounds(tabId);
          bottomOverlay = await captureStitchedFrame(tabId);
          bottomOverlayTop = bottomInfo.top;
          break;
        } catch (overlayErr) {
          if (overlayRetry < 2 && overlayErr.message.indexOf('MAX_CAPTURE') !== -1) {
            await sleep(600);
          } else {
            throw overlayErr;
          }
        }
      }
    }

    sendProgress('Composizione...', 92);

    // Cuci le slice in un canvas finale, croppato sui bound X
    // Se hasCustomScroll, sposta la source per saltare l'offset del container
    compResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(imgs, ax, aw, ah_doc, viewH, ratio, offsetX, offsetY, deltas, realScrolls, selTopVpVisibile, contH, bottomOverlay, bottomOverlayTop) {
        function loadImg(src) {
          return new Promise(function(res, rej) {
            var im = new Image();
            im.onload = function() { res(im); };
            im.onerror = rej;
            im.src = src;
          });
        }

        var sorgenti = imgs.slice();
        if (bottomOverlay) sorgenti.push(bottomOverlay);
        return Promise.all(sorgenti.map(loadImg)).then(function(tutteLeImmagini) {
          var overlayImg = bottomOverlay ? tutteLeImmagini.pop() : null;
          var loaded = tutteLeImmagini;
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
              var dRaw = (deltas && typeof deltas[idx] === 'number') ? deltas[idx] : 0;
              // Delta NEGATIVO sulla PRIMA fetta = la selezione parte SOPRA
              // il contenitore scrollabile (header/tab della pagina, che non
              // scrollano ma SONO nel fotogramma): il ritaglio parte più in
              // alto e li include. Scartarli (com'era) tagliava la testa
              // della selezione e faceva slittare tutta la finestra in giù,
              // con contenuto extra oltre la fine. Sulle fette successive i
              // delta negativi restano ignorati (rumore da scroll frazionari).
              var deltaPx = (idx === 0)
                ? Math.round(dRaw * realRatio)
                : ((dRaw > 0) ? Math.round(dRaw * realRatio) : 0);
              startY = offY + deltaPx;
              if (startY < 0) startY = 0;
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
            // Si campionano 16 COLONNE distribuite su tutta la larghezza,
            // non solo la prima a sinistra: sul bordo sinistro delle liste
            // (webmail) i pixel sono uniformi e i candidati risultavano
            // quasi pari — la cucitura andava a fortuna e mangiava qualche
            // pixel di riga. Con 16 colonne la firma di ogni riga è netta.
            var wCmp = Math.min(prevW, nextCnv.width);
            var passoX = Math.max(1, Math.floor(wCmp / 16));
            for (var off = lo; off <= hi; off++) {
              var score = 0, cnt = 0;
              for (var by = 0; by < bandH; by++) {
                var prevY = prevH - off + by;
                if (prevY < 0 || prevY >= prevH) { score = Infinity; break; }
                for (var cx = 0; cx < wCmp; cx += passoX) {
                  var pi = (prevY * prevW + cx) * 4;
                  var ni = (by * nextCnv.width + cx) * 4;
                  var dr = prevData[pi] - nextData[ni];
                  var dg = prevData[pi+1] - nextData[ni+1];
                  var db = prevData[pi+2] - nextData[ni+2];
                  score += dr*dr + dg*dg + db*db;
                  cnt++;
                }
              }
              if (cnt > 0) { score = score / cnt; if (score < bestScore) { bestScore = score; bestOff = off; } }
            }
            // FIDUCIA CONDIZIONATA: la finestra larga vince SOLO con un
            // aggancio vero (punteggio da pixel praticamente identici).
            // Sulle giunture contigue (overlap 0, sliceH = containerH) ogni
            // candidato è sbagliato ma uno risulta comunque "meno peggio":
            // cucirci sopra taglierebbe decine di px buoni. Senza un match
            // netto si resta sull'overlap atteso dai numeri.
            if (bestScore > 900) bestOff = atteso;
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
            // GUINZAGLIO sul recupero: questo meccanismo esiste per la
            // DERIVA da arrotondamento (1-2px a giuntura), non per colmare
            // buchi veri. Se manca più del plausibile significa che lo
            // scroll si è fermato prima del previsto (scroller che mente,
            // selezione oltre il fondo): ricopiare il fondo dell'ultima
            // foto duplicherebbe un nastro di contenuto — meglio un'immagine
            // un filo più corta ma VERA.
            var maxRecupero = total * 4 + 8;
            if (manca <= maxRecupero) {
              if (manca > lastC.height) manca = lastC.height;
              var from = lastC.height - manca;  // dal fondo della cattura
              ctx.drawImage(lastC, 0, from, lastC.width, manca, 0, cursorY, lastC.width, manca);
              cursorY += manca;
            }
          }

          var finalH = Math.min(targetH, cursorY);
          var out = document.createElement('canvas');
          out.width = sw;
          out.height = finalH;
          var outCtx = out.getContext('2d');
          outCtx.drawImage(canvas, 0, 0);

          // La cattura separata è allineata al fondo della selezione. Copiando
          // la sua fascia inferiore sul fondo del risultato, il composer resta
          // intero e non viene troncato dall'overlap dell'ultima fetta.
          if (overlayImg && typeof bottomOverlayTop === 'number') {
            var bandBottomCss = offsetY + contH;
            var overlayTopCss = Math.max(offsetY, Math.min(bottomOverlayTop, bandBottomCss));
            var srcY = Math.round(overlayTopCss * realRatio);
            var srcBottom = Math.min(overlayImg.height, Math.round(bandBottomCss * realRatio));
            var srcH = srcBottom - srcY;
            if (srcH > finalH) {
              srcY += srcH - finalH;
              srcH = finalH;
            }
            if (srcH > 0) {
              outCtx.drawImage(overlayImg, sx, srcY, sw, srcH, 0, finalH - srcH, sw, srcH);
            }
          }
          return out.toDataURL('image/png');
        });
      },
      // NB: come viewH si passa l'altezza del VIEWPORT (meta.vh), non sliceH:
      // il rapporto CSS->pixel reali va calcolato sull'altezza della finestra,
      // perché la cattura è alta quanto la finestra. Con un contenitore più
      // basso del viewport (console Mistral) usare sliceH gonfiava il rapporto
      // e il ritaglio usciva spostato rispetto alla selezione.
      args: [captures, area.x, area.w, area.h_doc, meta.vh, meta.dpr, meta.offsetX, meta.offsetY, deltas, realScrolls, (giaVisibile ? Math.max(0, selTopVp) : -1), meta.containerH, bottomOverlay, bottomOverlayTop]
    });
    }

    // MULTI SNIP: a sessione attiva il pezzo va all'editor, non al download.
    var multiA = await multiSessione();
    var pezzoScartatoA = false;
    if (multiA && multiA.active) {
      var okA = await multiAggiungiPezzo(compResult[0].result, tabId, 'area');
      // Pezzo respinto per quota: si prosegue coi RIPRISTINI della pagina
      // e si segnala errore alla fine.
      pezzoScartatoA = (okA === false);
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

    if (captureBackgrounds) {
      await restoreCaptureBackgrounds(tabId);
      captureBackgrounds = false;
    }
    await resumeCssAnims(tabId);
    if (pezzoScartatoA) {
      sendError('Piece too large for the session (10 MB limit)');
    } else {
      sendSuccess();
    }
    if (!(multiA && multiA.active)) {
      await showBollino(tabId, true);
      await registraCatturaRiuscita(tabId);
    }

  } catch (err) {
    console.error('Area screenshot error:', err);
    if (captureBackgrounds) {
      await restoreCaptureBackgrounds(tabId);
      captureBackgrounds = false;
    }
    await resumeCssAnims(tabId);
    // FALLBACK: su pagine non iniettabili (chrome://, errore) catturo il visibile.
    if (isPaginaNonIniettabile(err)) { await doVisibleCapture(tabId); return; }
    sendError(err.message);
    await showBollino(tabId, false, err.message);
  } finally {
    if (captureBackgrounds) await restoreCaptureBackgrounds(tabId);
    // Ripristina le barre anche se la cattura fallisce. Nessuna modifica
    // permanente allo stile del sito o al comportamento del suo scroller.
    if (areaScrollbarsHidden) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() {
            document.querySelectorAll('[data-screenshot-area-scrollbar]').forEach(function(el) {
              el.removeAttribute('data-screenshot-area-scrollbar');
            });
            var style = document.getElementById('__screenshot_area_scrollbars');
            if (style) style.remove();
            document.querySelectorAll('[data-screenshot-area-pane], [data-screenshot-area-scroll]').forEach(function(el) {
              el.removeAttribute('data-screenshot-area-pane');
              el.removeAttribute('data-screenshot-area-scroll');
            });
          }
        });
      } catch (closedTab) {}
    }
  }
}
