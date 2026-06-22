// Menu contestuale per Capture Mode
chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.removeAll(function() {
    chrome.contextMenus.create({
      id: 'captureMode',
      title: 'Capture Mode',
      contexts: ['action']
    });
  });
});

chrome.contextMenus.onClicked.addListener(function(info) {
  if (info.menuItemId === 'captureMode') {
    chrome.tabs.create({ url: 'settings.html' });
  }
});

// Ricevi messaggio dal popup per avviare cattura
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'startCapture') {
    // Pausa animazioni CSS + video appena clicchi (non tocca il motore JS).
    pauseCssAnims(msg.tabId).then(function() {
      if (msg.mode === 'full') {
        doFullCapture(msg.tabId);
      } else if (msg.mode === 'visible') {
        doVisibleCapture(msg.tabId);
      } else if (msg.mode === 'area') {
        doAreaCapture(msg.tabId);
      }
    });
  }
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
          st.textContent = '*,*::before,*::after{animation-play-state:paused !important;}';
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

// === FULL PAGE ===
async function doFullCapture(tabId) {
  try {
    sendProgress('Preparazione...', 5);

    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var scrollEl = null;
        var pageScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var windowScrolls = pageScroll > window.innerHeight + 10;

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

        var useWindow = !scrollEl || scrollEl === document.documentElement || scrollEl === document.body;
        var target = useWindow ? null : scrollEl;

        var sh = target ? target.scrollHeight : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        var sy = target ? target.scrollTop : window.scrollY;

        if (target) {
          target.setAttribute('data-screenshot-scroll', 'true');
          target.scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }

        return {
          sh: sh,
          vh: window.innerHeight,
          vw: window.innerWidth,
          sy: sy,
          dpr: window.devicePixelRatio || 1,
          hasCustomScroll: !useWindow
        };
      }
    });

    var d = results[0].result;
    var rows = Math.ceil(d.sh / d.vh);
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
            var allEls = document.querySelectorAll('*');
            for (var k = 0; k < allEls.length; k++) {
              var st = window.getComputedStyle(allEls[k]);
              if (st.position === 'fixed' || st.position === 'sticky') {
                window.__screenshotHidden.push({
                  el: allEls[k],
                  oldVisibility: allEls[k].style.visibility
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
            var interval = setInterval(function() {
              var currentY = custom
                ? document.querySelector('[data-screenshot-scroll]').scrollTop
                : window.scrollY;
              checks++;
              if (Math.abs(currentY - y) < 2 || checks > 30) {
                clearInterval(interval);
                manageStickiesFP();  // nascondi gli ancorati a QUESTA slice
                resolve(true);
              }
            }, 50);
          });
        },
        args: [i * d.vh, d.hasCustomScroll, i]
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
      func: function(imgs, pw, ph, viewH, ratio) {
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
      args: [captures, d.vw, d.sh, d.vh, d.dpr]
    });

    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chrome.downloads.download({
      url: compResult[0].result,
      filename: 'screenshots/screenshot_' + ts + '.png',
      saveAs: false
    });

    await copyToClipboard(compResult[0].result, tabId);

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

  } catch (err) {
    console.error('Screenshot error:', err);
    await resumeCssAnims(tabId);
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

// === VISIBLE ONLY ===
async function doVisibleCapture(tabId) {
  try {
    var dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
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
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        var old = document.getElementById('__screenshot_area_overlay');
        if (old) old.remove();

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
        info.textContent = 'Trascina per selezionare l\'area';
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
          // Se la finestra scrolla, usa window (caso pagine normali tipo Cornell Law)
          var pageScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          if (pageScroll > window.innerHeight + 10) {
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
          if (leftBottomZone && lastMouseY > vh - SCROLL_TRIGGER_ZONE) {
            var distFromBottom = vh - lastMouseY;
            var ratio = 1 - (distFromBottom / SCROLL_TRIGGER_ZONE);
            speed = SCROLL_SPEED_MIN + ratio * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN);
          } else if (leftTopZone && lastMouseY < SCROLL_TRIGGER_ZONE) {
            var ratio2 = 1 - (lastMouseY / SCROLL_TRIGGER_ZONE);
            speed = -(SCROLL_SPEED_MIN + ratio2 * (SCROLL_SPEED_MAX - SCROLL_SPEED_MIN));
          }
          if (speed !== 0) {
            if (scrollTarget) {
              scrollTarget.scrollBy(0, speed);
            } else {
              window.scrollBy(0, speed);
            }
            updateBox();
          }
          scrollRAF = requestAnimationFrame(autoScrollLoop);
        }

        overlay.addEventListener('mousedown', function(e) {
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
            window.removeEventListener('scroll', onScrollDuringDrag, true);
            if (scrollTarget) scrollTarget.removeEventListener('scroll', onScrollDuringDrag);
            document.removeEventListener('keydown', onKey);
          }
        }
        document.addEventListener('keydown', onKey);
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
      if (val === 'cancelled') { await resumeCssAnims(tabId); return; }
      if (val) { area = val; break; }
    }

    if (!area) { await resumeCssAnims(tabId); return; }

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
          offsetY = rect.top;
          containerH = rect.height;
        }
        return {
          sy: el ? el.scrollTop : window.scrollY,
          vh: window.innerHeight,
          containerH: containerH,
          offsetX: offsetX,
          offsetY: offsetY,
          dpr: window.devicePixelRatio || 1
        };
      },
      args: [area.hasCustomScroll]
    });
    var meta = metaResult[0].result;


    // Usa l'altezza del container scrollabile (non del viewport del tab) per calcolare le slice
    var sliceH = meta.containerH;
    var numSlices = Math.ceil(area.h_doc / sliceH);
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
      var wantedScroll = (area.y_doc - meta.offsetY) + i * sliceH;
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
            var allEls = document.querySelectorAll('*');
            for (var k = 0; k < allEls.length; k++) {
              if (allEls[k].id === '__screenshot_area_overlay') continue;
              var p = window.getComputedStyle(allEls[k]).position;
              if (p === 'fixed' || p === 'sticky') {
                window.__screenshotStickies.push({ el: allEls[k], oldVis: allEls[k].style.visibility });
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
              var isStart = (idx === 0 && E.hasAttribute('data-screenshot-start-sticky'));
              if (isStart) continue;
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
      deltas.push(wantedScroll - realScroll);
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
      func: function(imgs, ax, aw, ah_doc, viewH, ratio, offsetX, offsetY, deltas, realScrolls) {
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
          var sliceCanvases = loaded.map(function(img, idx) {
            var deltaPx = (deltas && deltas[idx] > 0) ? Math.round(deltas[idx] * realRatio) : 0;
            var startY = offY + deltaPx;
            if (startY > img.height - 1) startY = img.height - 1;
            var hUtile = img.height - startY;
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
      args: [captures, area.x, area.w, area.h_doc, sliceH, meta.dpr, meta.offsetX, meta.offsetY, deltas, realScrolls]
    });

    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    chrome.downloads.download({
      url: compResult[0].result,
      filename: 'screenshots/screenshot_' + ts + '.png',
      saveAs: false
    });

    await copyToClipboard(compResult[0].result, tabId);

    // Ripristino: scroll iniziale + visibility dei fixed/sticky
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(sy, hasCustomScroll) {
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
          el.scrollTop = sy;
          el.removeAttribute('data-screenshot-area-scroll');
        } else {
          window.scrollTo(0, sy);
        }
      },
      args: [meta.sy, area.hasCustomScroll]
    });

    await resumeCssAnims(tabId);
    sendSuccess();
    await showBollino(tabId, true);

  } catch (err) {
    console.error('Area screenshot error:', err);
    await resumeCssAnims(tabId);
    sendError(err.message);
    await showBollino(tabId, false, err.message);
  }
}
