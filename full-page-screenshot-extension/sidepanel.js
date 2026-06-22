var statusEl = document.getElementById('status');
var barEl = document.getElementById('bar');
var progressEl = document.getElementById('progress');
var btnFull = document.getElementById('btnFull');
var btnVisible = document.getElementById('btnVisible');

btnVisible.addEventListener('click', function() {
  statusEl.textContent = 'Cerco tab...';
  getTargetTab(function(tabId) {
    statusEl.textContent = 'Attivo tab...';
    chrome.tabs.update(tabId, { active: true }, function() {
      setTimeout(function() {
        statusEl.textContent = 'Cattura...';
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
          if (dataUrl) {
            downloadPng(dataUrl);
            statusEl.textContent = 'Salvato!';
          } else {
            statusEl.textContent = 'Errore cattura';
          }
        });
      }, 500);
    });
  });
});

btnFull.addEventListener('click', function() {
  btnFull.disabled = true;
  btnVisible.disabled = true;
  statusEl.textContent = 'Cerco tab...';
  progressEl.style.display = 'block';
  barEl.style.width = '0%';

  getTargetTab(function(tabId) {
    statusEl.textContent = 'Attivo tab ' + tabId + '...';

    chrome.tabs.update(tabId, { active: true }, function() {
      setTimeout(function() {
        statusEl.textContent = 'Leggo dimensioni...';

        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function() {
            // Cerca il container scrollabile (potrebbe essere un div con overflow auto/scroll)
            var scrollEl = null;
            var all = document.querySelectorAll('*');
            for (var j = 0; j < all.length; j++) {
              var el = all[j];
              var style = window.getComputedStyle(el);
              var ov = style.overflowY;
              if ((ov === 'auto' || ov === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
                // Prendi quello con più scrollHeight
                if (!scrollEl || el.scrollHeight > scrollEl.scrollHeight) {
                  scrollEl = el;
                }
              }
            }

            // Se non troviamo un container specifico, usa window
            var useWindow = !scrollEl || scrollEl === document.documentElement || scrollEl === document.body;
            var target = useWindow ? null : scrollEl;

            var sh = target ? target.scrollHeight : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            var sy = target ? target.scrollTop : window.scrollY;
            var vh = window.innerHeight;
            var vw = window.innerWidth;

            // Salva un marker per ritrovare l'elemento dopo
            if (target) {
              target.setAttribute('data-screenshot-scroll', 'true');
            }

            // Scrolla in alto
            if (target) { target.scrollTop = 0; } else { window.scrollTo(0, 0); }

            return {
              sh: sh,
              vh: vh,
              vw: vw,
              sy: sy,
              dpr: window.devicePixelRatio || 1,
              hasCustomScroll: !useWindow
            };
          }
        }, function(results) {
          if (!results || !results[0] || !results[0].result) {
            statusEl.textContent = 'Errore: no permessi sulla pagina';
            btnFull.disabled = false;
            btnVisible.disabled = false;
            return;
          }

          var d = results[0].result;
          var rows = Math.ceil(d.sh / d.vh);
          var captures = [];
          var currentRow = 0;

          statusEl.textContent = 'Pagina: ' + d.sh + 'px, ' + rows + ' sezioni';

          function captureNext() {
            statusEl.textContent = 'Scroll+cattura ' + (currentRow + 1) + '/' + rows;
            barEl.style.width = Math.round(((currentRow + 1) / rows) * 100) + '%';

            chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: function(y, custom, row) {
                // Dopo la prima cattura, nascondi elementi fixed/sticky per evitare duplicazioni
                if (row === 1) {
                  // Solo al primo scroll (row 1), trova e nascondi
                  window.__screenshotHidden = [];
                  var allEls = document.querySelectorAll('*');
                  for (var k = 0; k < allEls.length; k++) {
                    var st = window.getComputedStyle(allEls[k]);
                    if (st.position === 'fixed' || st.position === 'sticky') {
                      if (allEls[k].offsetHeight < window.innerHeight * 0.5) {
                        window.__screenshotHidden.push({
                          el: allEls[k],
                          oldDisplay: allEls[k].style.display
                        });
                        allEls[k].style.display = 'none';
                      }
                    }
                  }
                }
                if (custom) {
                  var el = document.querySelector('[data-screenshot-scroll]');
                  if (el) { el.scrollTop = y; }
                } else {
                  window.scrollTo(0, y);
                }
              },
              args: [currentRow * d.vh, d.hasCustomScroll, currentRow]
            }, function() {
              setTimeout(function() {
                chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
                  if (!dataUrl) {
                    statusEl.textContent = 'Errore cattura sezione ' + (currentRow + 1);
                    btnFull.disabled = false;
                    btnVisible.disabled = false;
                    return;
                  }

                  captures.push(dataUrl);
                  currentRow++;

                  if (currentRow < rows) {
                    captureNext();
                  } else {
                    finalize(tabId, captures, d, rows);
                  }
                });
              }, 500);
            });
          }

          setTimeout(captureNext, 600);
        });
      }, 500);
    });
  });
});

function finalize(tabId, captures, d, rows) {
  statusEl.textContent = 'Composizione ' + captures.length + ' pezzi...';

  chrome.scripting.executeScript({
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
  }, function(compResult) {
    if (compResult && compResult[0] && compResult[0].result) {
      downloadPng(compResult[0].result);
      statusEl.textContent = 'Salvato! (' + rows + ' sezioni)';
    } else {
      statusEl.textContent = 'Errore composizione';
    }

    // Ripristina elementi fixed/sticky nascosti e scroll
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(y, custom) {
        // Ripristina elementi nascosti
        if (window.__screenshotHidden) {
          for (var k = 0; k < window.__screenshotHidden.length; k++) {
            var item = window.__screenshotHidden[k];
            item.el.style.display = item.oldDisplay;
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

    progressEl.style.display = 'none';
    btnFull.disabled = false;
    btnVisible.disabled = false;
  });
}

function getTargetTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs.length > 0) {
      callback(tabs[0].id);
    } else {
      statusEl.textContent = 'Nessun tab trovato';
    }
  });
}

function downloadPng(dataUrl) {
  var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  chrome.downloads.download({
    url: dataUrl,
    filename: 'screenshots/screenshot_' + ts + '.png',
    saveAs: false
  });
}
