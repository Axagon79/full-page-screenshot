var params = new URLSearchParams(window.location.search);
var targetTabId = parseInt(params.get('tabId'));

var statusEl = document.getElementById('status');
var barEl = document.getElementById('bar');
var doneEl = document.getElementById('done');

// Salva id di questa tab di controllo
var controlTabId = null;

doFullCapture();

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function doFullCapture() {
  try {
    // Trova l'id di questa tab di controllo
    var currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    controlTabId = currentTabs[0].id;

    // Attiva il tab target (deve essere visibile per captureVisibleTab)
    await chrome.tabs.update(targetTabId, { active: true });
    await sleep(800);

    // Ottieni dimensioni
    var results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: function() {
        return {
          sh: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
          vh: window.innerHeight,
          vw: window.innerWidth,
          sy: window.scrollY,
          dpr: window.devicePixelRatio || 1
        };
      }
    });

    var d = results[0].result;
    var rows = Math.ceil(d.sh / d.vh);
    var captures = [];

    for (var i = 0; i < rows; i++) {
      // Scrolla
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: function(y) { window.scrollTo(0, y); },
        args: [i * d.vh]
      });

      await sleep(400);

      // Cattura (il tab target è attivo, quindi captureVisibleTab funziona)
      var dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      captures.push(dataUrl);
    }

    // Ripristina scroll
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: function(y) { window.scrollTo(0, y); },
      args: [d.sy]
    });

    // Componi immagine nel tab target
    statusEl.textContent = 'Composizione immagine...';

    var compResult = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: function(imgs, pw, ph, viewH, ratio) {
        var canvas = document.createElement('canvas');
        canvas.width = pw * ratio;
        canvas.height = ph * ratio;
        var ctx = canvas.getContext('2d');
        var count = 0;
        var total = imgs.length;

        return new Promise(function(resolve) {
          for (var idx = 0; idx < total; idx++) {
            (function(i) {
              var img = new Image();
              img.onload = function() {
                var destY = i * viewH * ratio;
                var last = (i === total - 1);
                var rem = ph - i * viewH;
                var ch = (last ? rem : viewH) * ratio;

                if (last && rem < viewH) {
                  var off = (viewH - rem) * ratio;
                  ctx.drawImage(img, 0, off, img.width, ch, 0, destY, img.width, ch);
                } else {
                  ctx.drawImage(img, 0, 0, img.width, ch, 0, destY, img.width, ch);
                }

                count++;
                if (count === total) {
                  resolve(canvas.toDataURL('image/png'));
                }
              };
              img.src = imgs[i];
            })(idx);
          }
        });
      },
      args: [captures, d.vw, d.sh, d.vh, d.dpr]
    });

    // Torna alla tab di controllo per mostrare il risultato
    await chrome.tabs.update(controlTabId, { active: true });

    // Scarica
    var tab = await chrome.tabs.get(targetTabId);
    downloadPng(compResult[0].result, tab.title);

    statusEl.textContent = 'Completato! (' + rows + ' sezioni)';
    doneEl.style.display = 'block';

  } catch (err) {
    statusEl.textContent = 'Errore: ' + err.message;
    console.error(err);
  }
}

function downloadPng(dataUrl, title) {
  var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var name = (title || 'screenshot').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 50).trim();
  chrome.downloads.download({
    url: dataUrl,
    filename: 'screenshots/' + name + '_' + ts + '.png',
    saveAs: false
  });
}
