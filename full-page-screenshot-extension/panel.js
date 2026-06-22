document.getElementById('btnFull').addEventListener('click', function() {
  doCapture('full');
});
document.getElementById('btnVisible').addEventListener('click', function() {
  doCapture('visible');
});

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function doCapture(mode) {
  var status = document.getElementById('status');
  var progress = document.getElementById('progress');
  var progressBar = document.getElementById('progressBar');
  var btnFull = document.getElementById('btnFull');
  var btnVisible = document.getElementById('btnVisible');

  btnFull.disabled = true;
  btnVisible.disabled = true;
  status.textContent = 'Cattura in corso...';

  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tabId = tabs[0].id;

    if (mode === 'visible') {
      var dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      downloadPng(dataUrl, tabs[0].title);
      status.textContent = 'Salvato!';
    } else {
      // Ottieni dimensioni pagina
      var results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
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

      progress.style.display = 'block';

      // Scroll e cattura ogni pezzo
      for (var i = 0; i < rows; i++) {
        status.textContent = 'Cattura ' + (i + 1) + '/' + rows + '...';
        progressBar.style.width = Math.round(((i + 1) / rows) * 100) + '%';

        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(y) { window.scrollTo(0, y); },
          args: [i * d.vh]
        });

        await sleep(400);

        var piece = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        captures.push(piece);
      }

      // Ripristina scroll originale
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(y) { window.scrollTo(0, y); },
        args: [d.sy]
      });

      // Componi immagine nella pagina target
      status.textContent = 'Composizione immagine...';

      var compResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
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

      downloadPng(compResult[0].result, tabs[0].title);
      status.textContent = 'Salvato! (' + rows + ' sezioni)';
      progress.style.display = 'none';
    }
  } catch (err) {
    status.textContent = 'Errore: ' + err.message;
    console.error(err);
    progress.style.display = 'none';
  }

  btnFull.disabled = false;
  btnVisible.disabled = false;
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
