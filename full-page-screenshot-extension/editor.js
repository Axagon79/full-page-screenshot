// Editor Multi Snip — TELA FISSA. La tela ha una dimensione stabile (quella
// dell'immagine finale): non "balla" mentre trascini. Cresce solo quando
// entra un pezzo che non ci sta, e il bottone "Fit canvas" la riadatta al
// contenuto quando lo decidi tu. Ogni pezzo si trascina liberamente dentro
// la tela (sovrapposizioni permesse, calamita sui bordi) e si ridimensiona
// da tutti e 4 gli angoli (proporzionale) e dai 4 lati (stira quel lato).

var blocchi = [];    // { img, natW, natH, sx, sy, x, y } — ordine = sovrapposizione
var caricati = 0;
var selezionato = -1;

var GAP = 14;        // respiro usato dalla calamita
var MARGINE = 24;    // margine iniziale attorno ai pezzi
var DEFAULT_W = 1920;  // la tela e' una SCATOLA: nasce gia' grande (formato
var DEFAULT_H = 1080;  // schermo), non su misura del primo pezzo

// Larghezza del piano di lavoro: quasi tutto lo schermo dell'editor.
function stageW() {
  return Math.max(600, Math.min(window.innerWidth - 80, 1500));
}

var canvasW = 0;     // dimensione FISSA della tela = dimensione dell'export
var canvasH = 0;
var viewK = 1;
var pannelloAutoAperto = false;

function $(id) { return document.getElementById(id); }

function caricaImmagine(src) {
  return new Promise(function(res, rej) {
    var im = new Image();
    im.onload = function() { res(im); };
    im.onerror = rej;
    im.src = src;
  });
}

function larghezza(b) { return b.natW * b.sx; }
function altezza(b) { return b.natH * b.sy; }

// Il pezzo resta sempre DENTRO la tela.
function clampBlocco(b) {
  var w = larghezza(b), h = altezza(b);
  if (w > canvasW) { b.sx = canvasW / b.natW; w = canvasW; }
  if (h > canvasH) { b.sy = canvasH / b.natH; h = canvasH; }
  b.x = Math.min(Math.max(0, b.x), canvasW - w);
  b.y = Math.min(Math.max(0, b.y), canvasH - h);
}

// ---- IMPORT DEI PEZZI DALLA SESSIONE ----

async function importaNuoviPezzi() {
  var st = await chrome.storage.session.get('multi');
  var m = st.multi;
  if (!m || !m.pieces) { render(); return; }
  for (var i = caricati; i < m.pieces.length; i++) {
    var p = m.pieces[i];
    try {
      var im = await caricaImmagine(p.img);
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!blocchi.length) {
        // primo pezzo: la SCATOLA nasce gia' grande (1920x1080), o piu'
        // grande se il pezzo da solo la supera — mai su misura del pezzo.
        canvasW = Math.max(DEFAULT_W, w + MARGINE * 2);
        canvasH = Math.max(DEFAULT_H, h + MARGINE * 2);
        blocchi.push({ img: p.img, natW: w, natH: h, sx: 1, sy: 1, x: MARGINE, y: MARGINE });
      } else {
        // pezzi successivi: sotto la pila; la tela cresce SOLO se non ci stanno
        var fondo = 0;
        blocchi.forEach(function(b) { fondo = Math.max(fondo, b.y + altezza(b)); });
        var y = fondo + GAP;
        if (w + MARGINE * 2 > canvasW) canvasW = w + MARGINE * 2;
        if (y + h + MARGINE > canvasH) canvasH = y + h + MARGINE;
        blocchi.push({ img: p.img, natW: w, natH: h, sx: 1, sy: 1, x: MARGINE, y: y });
      }
      selezionato = blocchi.length - 1;
    } catch (e) {
      console.warn('Pezzo illeggibile, saltato:', e);
    }
  }
  caricati = Math.max(caricati, m.pieces.length);
  render();
  // Editor aperto e vuoto: si apre da solo il pannello di scelta.
  if (!blocchi.length && !pannelloAutoAperto) {
    pannelloAutoAperto = true;
    $('scelta').style.display = 'flex';
  }
}

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'session' && changes.multi) importaNuoviPezzi();
});

// "Fit canvas": riadatta la tela al contenuto, con margini uniformi.
function adattaTela() {
  if (!blocchi.length) return;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  blocchi.forEach(function(b) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + larghezza(b));
    maxY = Math.max(maxY, b.y + altezza(b));
  });
  blocchi.forEach(function(b) {
    b.x += MARGINE - minX;
    b.y += MARGINE - minY;
  });
  canvasW = Math.round(maxX - minX) + MARGINE * 2;
  canvasH = Math.round(maxY - minY) + MARGINE * 2;
  render();
}

// CALAMITA: aggancio automatico ai bordi degli altri pezzi (entro ~8px a
// schermo): allineato, subito sotto, affiancato. Lontano dai punti magnetici
// il pezzo resta libero, sovrapposizioni comprese.
function calamita(i, x, y) {
  var b = blocchi[i];
  var w = larghezza(b), h = altezza(b);
  var S = 8 / viewK;
  var bx = x, by = y;
  blocchi.forEach(function(o, j) {
    if (j === i) return;
    var ow = larghezza(o), oh = altezza(o);
    if (Math.abs(x - o.x) < S) bx = o.x;
    else if (Math.abs((x + w) - (o.x + ow)) < S) bx = o.x + ow - w;
    else if (Math.abs((x + w / 2) - (o.x + ow / 2)) < S) bx = o.x + ow / 2 - w / 2;
    else if (Math.abs(x - (o.x + ow + GAP)) < S) bx = o.x + ow + GAP;
    else if (Math.abs((x + w + GAP) - o.x) < S) bx = o.x - GAP - w;
    if (Math.abs(y - (o.y + oh + GAP)) < S) by = o.y + oh + GAP;
    else if (Math.abs((y + h + GAP) - o.y) < S) by = o.y - GAP - h;
    else if (Math.abs(y - o.y) < S) by = o.y;
    else if (Math.abs((y + h) - (o.y + oh)) < S) by = o.y + oh - h;
  });
  return { x: bx, y: by };
}

// ---- RENDER ----

function render() {
  var palco = $('palco');
  palco.innerHTML = '';
  $('contatore').textContent = blocchi.length + (blocchi.length === 1 ? ' piece' : ' pieces');
  if (!blocchi.length) {
    palco.innerHTML = '<div id="vuoto">No pieces yet.<br>' +
      'Use <b>+ Add piece</b> to capture from the page.</div>';
    return;
  }
  viewK = Math.min(1, stageW() / canvasW);

  var cornice = document.createElement('div');
  cornice.id = 'cornice';

  var dim = document.createElement('div');
  dim.id = 'dimensioni';
  dim.textContent = 'Final image: ' + Math.round(canvasW) + ' × ' + Math.round(canvasH) + ' px';
  cornice.appendChild(dim);

  var tela = document.createElement('div');
  tela.id = 'tela';
  tela.style.width = Math.round(canvasW * viewK) + 'px';
  tela.style.height = Math.round(canvasH * viewK) + 'px';
  // click sul VUOTO della tela = deseleziona
  tela.addEventListener('mousedown', function(e) {
    if (e.target === tela) {
      selezionato = -1;
      render();
    }
  });
  blocchi.forEach(function(b, i) { tela.appendChild(creaBlocco(i)); });
  cornice.appendChild(tela);

  // Maniglie della TELA: allarga il "foglio" a piacere (destra, basso,
  // angolo) — utile per fare spazio, es. per affiancare pezzi piccoli.
  // "Fit canvas" lo ristringe al contenuto.
  ['e', 's', 'se'].forEach(function(hnd) {
    var man = document.createElement('div');
    man.className = 'tman tman-' + hnd;
    man.title = 'Drag to grow the canvas';
    man.addEventListener('mousedown', function(e) { iniziaResizeTela(e, hnd); });
    cornice.appendChild(man);
  });

  palco.appendChild(cornice);
}

// Numeretto dei pixel che segue il mouse durante i ridimensionamenti
// (come l'etichetta live della selezione Area).
function creaBadgePixel() {
  var b = document.createElement('div');
  b.className = 'pix-badge';
  document.body.appendChild(b);
  return b;
}
function muoviBadgePixel(b, ev, testo) {
  b.textContent = testo;
  b.style.left = (ev.clientX + 14) + 'px';
  b.style.top = (ev.clientY + 14) + 'px';
}

// La tela non può mai stringersi sotto il contenuto.
function minimiTela() {
  var mw = 200, mh = 150;
  blocchi.forEach(function(b) {
    mw = Math.max(mw, b.x + larghezza(b));
    mh = Math.max(mh, b.y + altezza(b));
  });
  return { w: mw, h: mh };
}

function iniziaResizeTela(e, hnd) {
  e.preventDefault();
  e.stopPropagation();
  var startX = e.clientX, startY = e.clientY;
  var w0 = canvasW, h0 = canvasH;
  var k0 = viewK;   // scala congelata: niente feedback mentre si trascina
  var badge = creaBadgePixel();
  muoviBadgePixel(badge, e, Math.round(canvasW) + ' × ' + Math.round(canvasH) + ' px');
  function onMove(ev) {
    var dx = (ev.clientX - startX) / k0;
    var dy = (ev.clientY - startY) / k0;
    var min = minimiTela();
    if (hnd === 'e' || hnd === 'se') canvasW = Math.min(32000, Math.max(min.w, Math.round(w0 + dx)));
    if (hnd === 's' || hnd === 'se') canvasH = Math.min(32000, Math.max(min.h, Math.round(h0 + dy)));
    render();
    muoviBadgePixel(badge, ev, Math.round(canvasW) + ' × ' + Math.round(canvasH) + ' px');
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    badge.remove();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function bottone(txt, titolo, fn) {
  var b = document.createElement('button');
  b.textContent = txt;
  b.title = titolo;
  b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
  return b;
}

var MANIGLIE = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function creaBlocco(i) {
  var b = blocchi[i];
  var wrap = document.createElement('div');
  wrap.className = 'blocco' + (i === selezionato ? ' selezionato' : '');
  wrap.style.left = Math.round(b.x * viewK) + 'px';
  wrap.style.top = Math.round(b.y * viewK) + 'px';
  wrap.style.zIndex = 1 + i;

  var im = document.createElement('img');
  im.src = b.img;
  im.style.width = Math.max(16, Math.round(larghezza(b) * viewK)) + 'px';
  im.style.height = Math.max(16, Math.round(altezza(b) * viewK)) + 'px';
  wrap.appendChild(im);

  var ctr = document.createElement('div');
  ctr.className = 'controlli';
  ctr.appendChild(bottone('⬆', 'Bring forward (overlap on top)', function() {
    if (i < blocchi.length - 1) {
      var t = blocchi[i]; blocchi[i] = blocchi[i + 1]; blocchi[i + 1] = t;
      selezionato = i + 1;
      render();
    }
  }));
  ctr.appendChild(bottone('⬇', 'Send backward (overlap below)', function() {
    if (i > 0) {
      var t = blocchi[i]; blocchi[i] = blocchi[i - 1]; blocchi[i - 1] = t;
      selezionato = i - 1;
      render();
    }
  }));
  ctr.appendChild(bottone('\u{1F5D1}', 'Remove', function() {
    blocchi.splice(i, 1);
    selezionato = -1;
    render();
  }));
  wrap.appendChild(ctr);

  var lab = document.createElement('div');
  lab.className = 'scala';
  lab.textContent = Math.round(larghezza(b)) + '×' + Math.round(altezza(b));
  wrap.appendChild(lab);

  // 8 MANIGLIE: angoli = proporzionale, lati = stira solo quel lato,
  // sempre con l'ancora sul lato/angolo opposto.
  MANIGLIE.forEach(function(hnd) {
    var man = document.createElement('div');
    man.className = 'man man-' + hnd;
    man.addEventListener('mousedown', function(e) { iniziaResize(e, i, hnd); });
    wrap.appendChild(man);
  });

  // LA MANINA: trascinamento libero con calamita, dentro la tela.
  wrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.controlli') || e.target.classList.contains('man')) return;
    e.preventDefault();
    selezionato = i;
    var startX = e.clientX, startY = e.clientY;
    var origX = b.x, origY = b.y;
    function onMove(ev) {
      var nx = origX + (ev.clientX - startX) / viewK;
      var ny = origY + (ev.clientY - startY) / viewK;
      var agg = calamita(i, nx, ny);
      b.x = agg.x;
      b.y = agg.y;
      clampBlocco(b);
      render();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    render();
  });

  return wrap;
}

function iniziaResize(e, i, hnd) {
  e.preventDefault();
  e.stopPropagation();
  selezionato = i;
  var b = blocchi[i];
  var startX = e.clientX, startY = e.clientY;
  var x0 = b.x, y0 = b.y;
  var w0 = larghezza(b), h0 = altezza(b);
  var badge = creaBadgePixel();
  muoviBadgePixel(badge, e, Math.round(w0) + ' × ' + Math.round(h0) + ' px');
  function onMove(ev) {
    var dx = (ev.clientX - startX) / viewK;
    var dy = (ev.clientY - startY) / viewK;
    var nw = w0, nh = h0;
    if (hnd === 'e') nw = w0 + dx;
    else if (hnd === 'w') nw = w0 - dx;
    else if (hnd === 's') nh = h0 + dy;
    else if (hnd === 'n') nh = h0 - dy;
    else {
      // angoli: scala proporzionale guidata dalla direzione della diagonale
      var ddx = (hnd === 'ne' || hnd === 'se') ? dx : -dx;
      var ddy = (hnd === 'se' || hnd === 'sw') ? dy : -dy;
      var f = Math.max((w0 + ddx) / w0, (h0 + ddy) / h0);
      nw = w0 * f;
      nh = h0 * f;
    }
    nw = Math.min(Math.max(30, nw), canvasW);
    nh = Math.min(Math.max(30, nh), canvasH);
    if (hnd.length === 2) {           // angolo: entrambe le scale
      b.sx = nw / b.natW;
      b.sy = nh / b.natH;
    } else if (hnd === 'e' || hnd === 'w') {
      b.sx = nw / b.natW;
    } else {
      b.sy = nh / b.natH;
    }
    // ancora sul lato opposto a quello trascinato
    var w = larghezza(b), h = altezza(b);
    if (hnd === 'w' || hnd === 'nw' || hnd === 'sw') b.x = x0 + (w0 - w);
    if (hnd === 'n' || hnd === 'nw' || hnd === 'ne') b.y = y0 + (h0 - h);
    clampBlocco(b);
    render();
    muoviBadgePixel(badge, ev, Math.round(larghezza(b)) + ' × ' + Math.round(altezza(b)) + ' px');
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    badge.remove();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ---- TASTIERA: frecce = spostamento di precisione, Canc = elimina ----

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    $('scelta').style.display = 'none';
    $('anteprima').style.display = 'none';
    return;
  }
  if (selezionato < 0 || selezionato >= blocchi.length) return;
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  var b = blocchi[selezionato];
  var passo = e.shiftKey ? 10 : 1;
  var preso = true;
  if (e.key === 'ArrowLeft') b.x -= passo;
  else if (e.key === 'ArrowRight') b.x += passo;
  else if (e.key === 'ArrowUp') b.y -= passo;
  else if (e.key === 'ArrowDown') b.y += passo;
  else if (e.key === 'Delete') {
    blocchi.splice(selezionato, 1);
    selezionato = -1;
    render();
    return;
  } else {
    preso = false;
  }
  if (preso) {
    e.preventDefault();
    clampBlocco(b);
    render();
  }
});

// ---- COMPOSIZIONE ED EXPORT ----

async function componi() {
  var imgs = await Promise.all(blocchi.map(function(b) { return caricaImmagine(b.img); }));
  var W = Math.round(canvasW), H = Math.round(canvasH);
  // Limiti canvas di Chrome: ~32k px per lato, ~268M px di area totale.
  if (W > 32000 || H > 32000 || W * H > 240000000) {
    alert('The composition is too large for the browser canvas.\nShrink the canvas (Fit) or remove some pieces and try again.');
    return null;
  }
  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f4f6';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Ordine dell'array = ordine di sovrapposizione (l'ultimo sta sopra).
  blocchi.forEach(function(b, i) {
    ctx.drawImage(imgs[i], Math.round(b.x), Math.round(b.y),
      Math.round(larghezza(b)), Math.round(altezza(b)));
  });
  return canvas;
}

async function salva() {
  if (!blocchi.length) return;
  var canvas = await componi();
  if (!canvas) return;
  var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  chrome.downloads.download({
    url: canvas.toDataURL('image/png'),
    filename: 'screenshots/multisnip_' + ts + '.png',
    saveAs: false
  });
  // Copia negli appunti: la pagina dell'editor ha il focus (click su Save).
  try {
    var blob = await new Promise(function(res) { canvas.toBlob(res, 'image/png'); });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  } catch (e) {
    console.warn('Copia negli appunti fallita:', e);
  }
  chrome.runtime.sendMessage({ action: 'multiDone' }).catch(function() {});
  $('salvato').style.display = 'block';
  setTimeout(function() { window.close(); }, 1400);
}

// ---- BARRA AZIONI ----

$('btnAggiungi').addEventListener('click', function() {
  $('scelta').style.display = 'flex';
});
$('btnFit').addEventListener('click', adattaTela);
// Anteprima: la STESSA composizione del Save, mostrata pulita a schermo pieno.
$('btnAnteprima').addEventListener('click', async function() {
  if (!blocchi.length) return;
  var canvas = await componi();
  if (!canvas) return;
  $('anteprimaImg').src = canvas.toDataURL('image/png');
  $('anteprima').style.display = 'flex';
});
$('anteprima').addEventListener('click', function() {
  $('anteprima').style.display = 'none';
});
$('scelta').addEventListener('click', function(e) {
  if (e.target === $('scelta')) $('scelta').style.display = 'none';
});
document.querySelectorAll('.opzione').forEach(function(op) {
  op.addEventListener('click', function() {
    $('scelta').style.display = 'none';
    chrome.runtime.sendMessage({ action: 'multiAdd', kind: op.getAttribute('data-kind') }).catch(function() {});
  });
});
$('btnAnnulla').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'multiDone' }).catch(function() {});
  window.close();
});
$('btnSalva').addEventListener('click', salva);

window.addEventListener('resize', function() { render(); });

importaNuoviPezzi();
