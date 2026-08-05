// Editor Multi Snip — TELA LIBERA. Ogni pezzo è un blocco con coordinate
// proprie (x, y in pixel "mondo" = pixel naturali per la scala scelta):
// si trascina ovunque con la manina, si può sovrapporre ad altri, si
// aggancia con la calamita ai bordi dei vicini, si ridimensiona con la
// maniglia d'angolo. La cornice tratteggiata mostra i bordi dell'immagine
// FINALE e si riadatta ai pezzi a ogni rilascio.

var blocchi = [];    // { img, natW, natH, scale, x, y } — ordine array = sovrapposizione
var caricati = 0;    // pezzi della sessione già importati
var selezionato = -1;

var STAGE_W = 960;   // larghezza massima di visualizzazione (non di export)
var GAP = 14;        // respiro usato dalla calamita per gli agganci
var MARGINE = 24;    // margine dell'immagine finale attorno ai pezzi

var viewK = 1;                                    // scala di visualizzazione
var bbox = { minX: 0, minY: 0, w: 300, h: 150 };  // riquadro dei pezzi (mondo)
var timerNudge = null;
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

// ---- IMPORT DEI PEZZI DALLA SESSIONE ----

async function importaNuoviPezzi() {
  var st = await chrome.storage.session.get('multi');
  var m = st.multi;
  if (!m || !m.pieces) { render(); return; }
  for (var i = caricati; i < m.pieces.length; i++) {
    var p = m.pieces[i];
    try {
      var im = await caricaImmagine(p.img);
      // Il pezzo nuovo si accoda in fondo alla pila, allineato a sinistra.
      var fondo = 0;
      blocchi.forEach(function(b) { fondo = Math.max(fondo, b.y + b.natH * b.scale); });
      if (blocchi.length) fondo += GAP;
      blocchi.push({ img: p.img, natW: im.naturalWidth, natH: im.naturalHeight, scale: 1, x: 0, y: fondo });
      selezionato = blocchi.length - 1;
    } catch (e) {
      console.warn('Pezzo illeggibile, saltato:', e);
    }
  }
  caricati = Math.max(caricati, m.pieces.length);
  aggiornaBbox();
  render();
  // Editor aperto e ancora vuoto (avvio del Multi Snip dall'icona): si apre
  // da solo il pannello di scelta, così l'utente decide il tipo del PRIMO
  // pezzo senza dover capire di cliccare "+ Add piece".
  if (!blocchi.length && !pannelloAutoAperto) {
    pannelloAutoAperto = true;
    $('scelta').style.display = 'flex';
  }
}

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'session' && changes.multi) importaNuoviPezzi();
});

// ---- GEOMETRIA ----

// Il riquadro NON viene ricalcolato durante un trascinamento: la cornice
// resta ferma (così si vede se si sta uscendo) e si riadatta al rilascio.
function aggiornaBbox() {
  if (!blocchi.length) { bbox = { minX: 0, minY: 0, w: 300, h: 150 }; return; }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  blocchi.forEach(function(b) {
    var w = b.natW * b.scale, h = b.natH * b.scale;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + w);
    maxY = Math.max(maxY, b.y + h);
  });
  bbox = { minX: minX, minY: minY, w: maxX - minX, h: maxY - minY };
}

// CALAMITA: se un bordo del pezzo trascinato arriva vicino a un bordo di un
// altro pezzo (entro ~8px a schermo), si aggancia: allineato, subito sotto,
// o affiancato. Se non ci si avvicina ai punti magnetici, il pezzo resta
// libero — sovrapposizioni comprese.
function calamita(i, x, y) {
  var b = blocchi[i];
  var w = b.natW * b.scale, h = b.natH * b.scale;
  var S = 8 / viewK;
  var bx = x, by = y;
  blocchi.forEach(function(o, j) {
    if (j === i) return;
    var ow = o.natW * o.scale, oh = o.natH * o.scale;
    // allineamenti orizzontali
    if (Math.abs(x - o.x) < S) bx = o.x;
    else if (Math.abs((x + w) - (o.x + ow)) < S) bx = o.x + ow - w;
    else if (Math.abs((x + w / 2) - (o.x + ow / 2)) < S) bx = o.x + ow / 2 - w / 2;
    else if (Math.abs(x - (o.x + ow + GAP)) < S) bx = o.x + ow + GAP;
    else if (Math.abs((x + w + GAP) - o.x) < S) bx = o.x - GAP - w;
    // agganci verticali
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
  viewK = Math.min(1, STAGE_W / (bbox.w + MARGINE * 2));

  var cornice = document.createElement('div');
  cornice.id = 'cornice';
  cornice.style.padding = Math.round(MARGINE * viewK) + 'px';

  var dim = document.createElement('div');
  dim.id = 'dimensioni';
  dim.textContent = 'Final image: ' + Math.round(bbox.w + MARGINE * 2) + ' × ' + Math.round(bbox.h + MARGINE * 2) + ' px';
  cornice.appendChild(dim);

  var tela = document.createElement('div');
  tela.id = 'tela';
  tela.style.width = Math.round(bbox.w * viewK) + 'px';
  tela.style.height = Math.round(bbox.h * viewK) + 'px';
  blocchi.forEach(function(b, i) { tela.appendChild(creaBlocco(i)); });
  cornice.appendChild(tela);
  palco.appendChild(cornice);
}

function bottone(txt, titolo, fn) {
  var b = document.createElement('button');
  b.textContent = txt;
  b.title = titolo;
  b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
  return b;
}

function creaBlocco(i) {
  var b = blocchi[i];
  var w = b.natW * b.scale;
  var wrap = document.createElement('div');
  wrap.className = 'blocco' + (i === selezionato ? ' selezionato' : '');
  wrap.style.left = Math.round((b.x - bbox.minX) * viewK) + 'px';
  wrap.style.top = Math.round((b.y - bbox.minY) * viewK) + 'px';
  wrap.style.zIndex = 1 + i;

  var im = document.createElement('img');
  im.src = b.img;
  im.style.width = Math.max(24, Math.round(w * viewK)) + 'px';
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
    aggiornaBbox();
    render();
  }));
  wrap.appendChild(ctr);

  var lab = document.createElement('div');
  lab.className = 'scala';
  lab.textContent = Math.round(b.scale * 100) + '%';
  wrap.appendChild(lab);

  // Maniglia d'angolo: ridimensiona (20% - 300%), riadatta al rilascio.
  var man = document.createElement('div');
  man.className = 'maniglia';
  man.addEventListener('mousedown', function(e) {
    e.preventDefault();
    e.stopPropagation();
    selezionato = i;
    var startX = e.clientX;
    var startScale = b.scale;
    function onMove(ev) {
      var d = ev.clientX - startX;
      b.scale = Math.min(3, Math.max(0.2, startScale * (1 + d / 260)));
      render();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      aggiornaBbox();
      render();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  wrap.appendChild(man);

  // LA MANINA: trascinamento libero del pezzo, con calamita.
  wrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.controlli') || e.target.classList.contains('maniglia')) return;
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
      render();   // la cornice resta ferma: bbox si riadatta solo al rilascio
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      aggiornaBbox();
      render();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    render();   // evidenzia subito la selezione
  });

  return wrap;
}

// ---- TASTIERA: frecce = spostamento di precisione, Canc = elimina ----

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { $('scelta').style.display = 'none'; return; }
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
    aggiornaBbox();
    render();
    return;
  } else {
    preso = false;
  }
  if (preso) {
    e.preventDefault();
    render();
    // il riquadro si riadatta solo a raffica finita, per non far "ballare"
    // gli altri pezzi a ogni pressione
    clearTimeout(timerNudge);
    timerNudge = setTimeout(function() { aggiornaBbox(); render(); }, 500);
  }
});

// ---- COMPOSIZIONE ED EXPORT ----

async function componi() {
  aggiornaBbox();
  var imgs = await Promise.all(blocchi.map(function(b) { return caricaImmagine(b.img); }));
  var W = Math.round(bbox.w) + MARGINE * 2;
  var H = Math.round(bbox.h) + MARGINE * 2;
  // Limiti canvas di Chrome: ~32k px per lato, ~268M px di area totale.
  if (W > 32000 || H > 32000 || W * H > 240000000) {
    alert('The composition is too large for the browser canvas.\nShrink or remove some pieces and try again.');
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
    ctx.drawImage(
      imgs[i],
      Math.round(b.x - bbox.minX) + MARGINE,
      Math.round(b.y - bbox.minY) + MARGINE,
      Math.round(b.natW * b.scale),
      Math.round(b.natH * b.scale)
    );
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

importaNuoviPezzi();
