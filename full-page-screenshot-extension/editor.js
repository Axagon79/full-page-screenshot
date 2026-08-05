// Editor Multi Snip — TELA FISSA. La tela ha una dimensione stabile (quella
// dell'immagine finale): non "balla" mentre trascini. Cresce solo quando
// entra un pezzo che non ci sta, e il bottone "Fit canvas" la riadatta al
// contenuto quando lo decidi tu. Ogni pezzo si trascina liberamente dentro
// la tela (sovrapposizioni permesse, calamita sui bordi) e si ridimensiona
// da tutti e 4 gli angoli (proporzionale) e dai 4 lati (stira quel lato).

var blocchi = [];    // { pid, img, natW, natH, sx, sy, x, y } — ordine = sovrapposizione
var importati = new Set();  // id dei pezzi di sessione già portati in tela
var selezionato = -1;
var viewKBloccata = null;   // zoom congelato durante il resize della tela
var ancoraTela = null;      // margini congelati: il lato opposto sta fermo
var guidaV = null;          // linee guida della calamita durante il drag
var guidaH = null;

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

// Le esecuzioni sono SERIALIZZATE: due eventi storage ravvicinati non
// devono intrecciare gli import (pezzi doppi in tela).
var codaImport = Promise.resolve();
function importaNuoviPezzi() {
  codaImport = codaImport.then(sincronizzaConSessione).catch(function(e) {
    console.warn('Sync pezzi fallita:', e);
  });
  return codaImport;
}

// La tela si allinea alla sessione PER IDENTITÀ (ogni pezzo ha un id), non
// per conteggio: un undo dal widget toglie il blocco anche dalla tela, un
// redo lo riporta; un blocco eliminato a mano qui dentro non risorge.
async function sincronizzaConSessione() {
  var st = await chrome.storage.session.get('multi');
  var m = st.multi;
  if (!m || !m.pieces) { render(); return; }
  var vivi = new Set();
  m.pieces.forEach(function(p) { if (p.id != null) vivi.add(p.id); });
  for (var k = blocchi.length - 1; k >= 0; k--) {
    if (blocchi[k].pid != null && !vivi.has(blocchi[k].pid)) {
      blocchi.splice(k, 1);
      selezionato = -1;
    }
  }
  importati.forEach(function(id) { if (!vivi.has(id)) importati.delete(id); });
  for (var i = 0; i < m.pieces.length; i++) {
    var p = m.pieces[i];
    if (p.id != null && importati.has(p.id)) continue;
    if (p.id != null) importati.add(p.id);  // prima dell'await: mai doppioni
    try {
      var im = await caricaImmagine(p.img);
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!blocchi.length) {
        // primo pezzo: la SCATOLA nasce gia' grande (1920x1080), o piu'
        // grande se il pezzo da solo la supera — mai su misura del pezzo.
        canvasW = Math.max(DEFAULT_W, w + MARGINE * 2);
        canvasH = Math.max(DEFAULT_H, h + MARGINE * 2);
        blocchi.push({ pid: p.id, img: p.img, natW: w, natH: h, sx: 1, sy: 1, x: MARGINE, y: MARGINE });
      } else {
        // pezzi successivi: sotto la pila; la tela cresce SOLO se non ci stanno
        var fondo = 0;
        blocchi.forEach(function(b) { fondo = Math.max(fondo, b.y + altezza(b)); });
        var y = fondo + GAP;
        if (w + MARGINE * 2 > canvasW) canvasW = w + MARGINE * 2;
        if (y + h + MARGINE > canvasH) canvasH = y + h + MARGINE;
        blocchi.push({ pid: p.id, img: p.img, natW: w, natH: h, sx: 1, sy: 1, x: MARGINE, y: y });
      }
      // La tela non può superare il limite dell'export (32000px per lato):
      // un pezzo fuori misura (full page enorme su schermo retina) viene
      // adattato dentro da clampBlocco invece di sfondare il foglio.
      if (canvasW > 32000) canvasW = 32000;
      if (canvasH > 32000) canvasH = 32000;
      clampBlocco(blocchi[blocchi.length - 1]);
      selezionato = blocchi.length - 1;
    } catch (e) {
      if (p.id != null) importati.delete(p.id);
      console.warn('Pezzo illeggibile, saltato:', e);
    }
  }
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
// il pezzo resta libero, sovrapposizioni comprese. Oltre alla posizione
// agganciata restituisce le LINEE GUIDA (gv verticale, gh orizzontale) da
// accendere sulla tela mentre si trascina.
function calamita(i, x, y) {
  var b = blocchi[i];
  var w = larghezza(b), h = altezza(b);
  var S = 8 / viewK;
  var bx = x, by = y;
  var gv = null, gh = null;
  blocchi.forEach(function(o, j) {
    if (j === i) return;
    var ow = larghezza(o), oh = altezza(o);
    if (Math.abs(x - o.x) < S) { bx = o.x; gv = o.x; }
    else if (Math.abs((x + w) - (o.x + ow)) < S) { bx = o.x + ow - w; gv = o.x + ow; }
    else if (Math.abs((x + w / 2) - (o.x + ow / 2)) < S) { bx = o.x + ow / 2 - w / 2; gv = o.x + ow / 2; }
    else if (Math.abs(x - (o.x + ow + GAP)) < S) { bx = o.x + ow + GAP; gv = bx; }
    else if (Math.abs((x + w + GAP) - o.x) < S) { bx = o.x - GAP - w; gv = bx + w; }
    if (Math.abs(y - (o.y + oh + GAP)) < S) { by = o.y + oh + GAP; gh = by; }
    else if (Math.abs((y + h + GAP) - o.y) < S) { by = o.y - GAP - h; gh = by + h; }
    else if (Math.abs(y - o.y) < S) { by = o.y; gh = o.y; }
    else if (Math.abs((y + h) - (o.y + oh)) < S) { by = o.y + oh - h; gh = o.y + oh; }
  });
  return { x: bx, y: by, gv: gv, gh: gh };
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
  // Durante il resize della tela lo zoom resta CONGELATO: così il bordo
  // segue il mouse 1:1 (il refit alla nuova misura avviene al rilascio).
  viewK = (viewKBloccata != null) ? viewKBloccata : Math.min(1, stageW() / canvasW);

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
  // Alone di selezione: cornice tratteggiata SOPRA tutti i pezzi, così un
  // pezzo selezionato con Alt+click resta visibile anche se sta sotto.
  if (selezionato >= 0 && selezionato < blocchi.length - 1) {
    var sb = blocchi[selezionato];
    var alone = document.createElement('div');
    alone.style.cssText = 'position:absolute;pointer-events:none;z-index:900;' +
      'border:2px dashed #00d4ff;border-radius:4px;' +
      'left:' + Math.round(sb.x * viewK - 2) + 'px;top:' + Math.round(sb.y * viewK - 2) + 'px;' +
      'width:' + Math.round(larghezza(sb) * viewK) + 'px;height:' + Math.round(altezza(sb) * viewK) + 'px;';
    tela.appendChild(alone);
  }
  // Linee guida della calamita: righe luminose che compaiono mentre
  // trascini un pezzo quando un bordo (o il centro) si allinea a un altro.
  if (guidaV != null) {
    var lv = document.createElement('div');
    lv.style.cssText = 'position:absolute;pointer-events:none;z-index:950;' +
      'left:' + Math.round(guidaV * viewK) + 'px;top:0;width:1px;height:100%;' +
      'background:#ff4fa3;box-shadow:0 0 4px rgba(255,79,163,0.8);';
    tela.appendChild(lv);
  }
  if (guidaH != null) {
    var lh = document.createElement('div');
    lh.style.cssText = 'position:absolute;pointer-events:none;z-index:950;' +
      'top:' + Math.round(guidaH * viewK) + 'px;left:0;height:1px;width:100%;' +
      'background:#ff4fa3;box-shadow:0 0 4px rgba(255,79,163,0.8);';
    tela.appendChild(lh);
  }
  cornice.appendChild(tela);

  // Maniglie della TELA su tutti i lati e gli angoli: allargano il
  // "foglio" a piacere. Da sinistra/alto lo spazio si aggiunge da quel
  // lato e i pezzi scivolano per restare ancorati al lato opposto.
  // "Fit canvas" lo ristringe al contenuto.
  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(function(hnd) {
    var man = document.createElement('div');
    man.className = 'tman tman-' + hnd;
    man.title = 'Drag to grow the canvas';
    man.addEventListener('mousedown', function(e) { iniziaResizeTela(e, hnd); });
    cornice.appendChild(man);
  });

  // Durante il resize della tela la centratura viene sospesa e il lato
  // OPPOSTO alla maniglia resta ancorato: senza questo, metà della crescita
  // andrebbe da ciascun lato e il bordo si muoverebbe a metà della velocità
  // del mouse (la maniglia "scappava" dal puntatore).
  if (ancoraTela) {
    var wVis = Math.round(canvasW * viewK), hVis = Math.round(canvasH * viewK);
    var ml = ancoraTela.ml, mt = ancoraTela.mt;
    if (ancoraTela.hnd.indexOf('w') !== -1) ml = ancoraTela.ml - (wVis - ancoraTela.w0);
    if (ancoraTela.hnd.indexOf('n') !== -1) mt = ancoraTela.mt - (hVis - ancoraTela.h0);
    cornice.style.marginTop = mt + 'px';
    cornice.style.marginLeft = ml + 'px';
    cornice.style.marginRight = '0';
    cornice.style.marginBottom = '0';
  }

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
  var k0 = viewK;
  viewKBloccata = k0;  // il bordo segue il mouse 1:1, refit al rilascio
  // Congela i margini attuali (l'auto della centratura risolto in px): da
  // qui in poi la crescita va tutta al lato trascinato.
  var cEl = document.getElementById('cornice');
  if (cEl) {
    var cs = getComputedStyle(cEl);
    ancoraTela = {
      hnd: hnd,
      ml: parseFloat(cs.marginLeft) || 0,
      mt: parseFloat(cs.marginTop) || 0,
      w0: Math.round(canvasW * k0),
      h0: Math.round(canvasH * k0)
    };
  }
  // Posizioni di partenza agganciate ALL'OGGETTO, non all'indice: un pezzo
  // che arriva (o sparisce) a metà trascinamento non deve scombinare gli
  // altri né mandare le coordinate a NaN.
  var orig = new Map();
  blocchi.forEach(function(b) { orig.set(b, { x: b.x, y: b.y }); });
  var minX0 = Infinity, minY0 = Infinity;
  blocchi.forEach(function(b) {
    minX0 = Math.min(minX0, b.x);
    minY0 = Math.min(minY0, b.y);
  });
  if (!isFinite(minX0)) { minX0 = w0; minY0 = h0; }
  // Tetto: 32000, ma una tela nata più grande (full page enorme) non deve
  // scattare di colpo al primo tick — può solo restare com'è o stringersi.
  var capW = Math.max(32000, w0), capH = Math.max(32000, h0);
  var badge = creaBadgePixel();
  muoviBadgePixel(badge, e, Math.round(canvasW) + ' × ' + Math.round(canvasH) + ' px');
  // Offset di presa: a che distanza dal bordo è stato afferrato il mouse.
  // Serve a tenere il bordo INCOLLATO al puntatore compensando lo scroll
  // (su tele più alte della finestra, accorciare dal basso faceva scorrere
  // la pagina e sembrava che si stringesse la parte alta).
  var presaX = 0, presaY = 0;
  var t0 = document.getElementById('tela');
  if (t0) {
    var r0 = t0.getBoundingClientRect();
    if (hnd.indexOf('e') !== -1) presaX = r0.right - e.clientX;
    if (hnd.indexOf('w') !== -1) presaX = r0.left - e.clientX;
    if (hnd.indexOf('s') !== -1) presaY = r0.bottom - e.clientY;
    if (hnd.indexOf('n') !== -1) presaY = r0.top - e.clientY;
  }
  // SEGNAPOSTO anti-clamp: accorciando la tela il documento si accorcia e,
  // se lo scroll è al massimo, il browser lo riclampa — il bordo resta
  // fermo e tutto il resto scivola. Un punto invisibile di 1px alla
  // vecchia estremità del documento tiene la corsa dello scroll intatta
  // per tutto il gesto (via al rilascio).
  var riserva = document.createElement('div');
  riserva.style.cssText = 'position:absolute;width:1px;height:1px;pointer-events:none;visibility:hidden;' +
    'left:' + (document.documentElement.scrollWidth - 1) + 'px;' +
    'top:' + (document.documentElement.scrollHeight - 1) + 'px;';
  document.body.appendChild(riserva);
  function onMove(ev) {
    var dx = (ev.clientX - startX) / k0;
    var dy = (ev.clientY - startY) / k0;
    var min = minimiTela();
    // Est/sud stirano il bordo; ovest/nord aggiungono (o tolgono) spazio da
    // quel lato, e i pezzi scivolano per restare fermi rispetto all'altro.
    if (hnd.indexOf('e') !== -1) canvasW = Math.min(capW, Math.max(min.w, Math.round(w0 + dx)));
    if (hnd.indexOf('s') !== -1) canvasH = Math.min(capH, Math.max(min.h, Math.round(h0 + dy)));
    if (hnd.indexOf('w') !== -1) {
      var nw = Math.min(capW, Math.max(Math.max(200, w0 - minX0), Math.round(w0 - dx)));
      var delta = nw - w0;
      canvasW = nw;
      blocchi.forEach(function(b) {
        var o = orig.get(b);
        if (o) b.x = o.x + delta;
      });
    }
    if (hnd.indexOf('n') !== -1) {
      var nh = Math.min(capH, Math.max(Math.max(150, h0 - minY0), Math.round(h0 - dy)));
      var deltaY = nh - h0;
      canvasH = nh;
      blocchi.forEach(function(b) {
        var o = orig.get(b);
        if (o) b.y = o.y + deltaY;
      });
    }
    render();
    // Scroll di compensazione: il bordo trascinato resta sotto il puntatore
    // anche quando il documento dell'editor si allunga o si accorcia.
    var t = document.getElementById('tela');
    if (t) {
      var r = t.getBoundingClientRect();
      var sx = 0, sy = 0;
      if (hnd.indexOf('e') !== -1) sx = r.right - (ev.clientX + presaX);
      else if (hnd.indexOf('w') !== -1) sx = r.left - (ev.clientX + presaX);
      if (hnd.indexOf('s') !== -1) sy = r.bottom - (ev.clientY + presaY);
      else if (hnd.indexOf('n') !== -1) sy = r.top - (ev.clientY + presaY);
      if (Math.abs(sx) > 1 || Math.abs(sy) > 1) window.scrollBy(sx, sy);
    }
    muoviBadgePixel(badge, ev, Math.round(canvasW) + ' × ' + Math.round(canvasH) + ' px');
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    badge.remove();
    riserva.remove();       // il documento può riprendere la sua misura
    viewKBloccata = null;   // ora la vista si riadatta alla nuova misura
    ancoraTela = null;      // e la tela torna centrata
    render();
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
  // Il click porta il pezzo SOPRA gli altri (come nei collage veri).
  // Alt+click seleziona invece il pezzo SOTTO al punto cliccato — per
  // ripescare un pezzo coperto senza spostare quello che gli sta sopra
  // (Alt+click ripetuti scendono di un piano alla volta, poi si ricomincia).
  wrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.controlli') || e.target.classList.contains('man')) return;
    e.preventDefault();
    if (e.altKey) {
      var rTela = wrap.parentElement.getBoundingClientRect();
      var cx = (e.clientX - rTela.left) / viewK;
      var cy = (e.clientY - rTela.top) / viewK;
      var pila = [];
      blocchi.forEach(function(o, j) {
        if (cx >= o.x && cx <= o.x + larghezza(o) && cy >= o.y && cy <= o.y + altezza(o)) pila.push(j);
      });
      if (pila.length) {
        var rif = pila.indexOf(selezionato) !== -1 ? pila.indexOf(selezionato) : pila.length - 1;
        i = rif > 0 ? pila[rif - 1] : pila[pila.length - 1];
      }
    } else {
      i = portaSopra(i);
    }
    selezionato = i;
    var bb = blocchi[i];
    var startX = e.clientX, startY = e.clientY;
    var origX = bb.x, origY = bb.y;
    function onMove(ev) {
      var nx = origX + (ev.clientX - startX) / viewK;
      var ny = origY + (ev.clientY - startY) / viewK;
      var agg = calamita(i, nx, ny);
      bb.x = agg.x;
      bb.y = agg.y;
      clampBlocco(bb);
      guidaV = agg.gv;
      guidaH = agg.gh;
      render();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (guidaV != null || guidaH != null) {
        guidaV = null;
        guidaH = null;
        render();
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    render();
  });

  return wrap;
}

// Porta il blocco in cima alla pila (ordine array = sovrapposizione) e
// restituisce il suo nuovo indice: è il "click-to-front" dell'editor.
function portaSopra(i) {
  if (i >= blocchi.length - 1) return i;
  var b = blocchi.splice(i, 1)[0];
  blocchi.push(b);
  return blocchi.length - 1;
}

function iniziaResize(e, i, hnd) {
  e.preventDefault();
  e.stopPropagation();
  i = portaSopra(i);
  selezionato = i;
  // Render SUBITO: portaSopra ha riordinato l'array, e un click secco senza
  // trascinamento lascerebbe il DOM con le closure sugli indici vecchi
  // (il cestino di un pezzo finirebbe per eliminarne un altro).
  render();
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
    // CALAMITA anche sul ridimensionamento: il bordo che stai tirando si
    // aggancia ai bordi degli altri pezzi (con linea guida), così porti due
    // foto alla stessa altezza o larghezza senza andare a occhio.
    var S = 8 / viewK;
    var gv = null, gh = null;
    function aggancioX(edge) {
      var t = null;
      blocchi.forEach(function(o, j) {
        if (j === i) return;
        var ow = larghezza(o);
        if (Math.abs(edge - o.x) < S) t = o.x;
        else if (Math.abs(edge - (o.x + ow)) < S) t = o.x + ow;
      });
      return t;
    }
    function aggancioY(edge) {
      var t = null;
      blocchi.forEach(function(o, j) {
        if (j === i) return;
        var oh = altezza(o);
        if (Math.abs(edge - o.y) < S) t = o.y;
        else if (Math.abs(edge - (o.y + oh)) < S) t = o.y + oh;
      });
      return t;
    }
    var tx = null, ty = null;
    if (hnd.indexOf('e') !== -1) { tx = aggancioX(x0 + nw); if (tx != null) { nw = tx - x0; gv = tx; } }
    else if (hnd.indexOf('w') !== -1) { tx = aggancioX(x0 + w0 - nw); if (tx != null) { nw = x0 + w0 - tx; gv = tx; } }
    if (hnd.indexOf('s') !== -1) { ty = aggancioY(y0 + nh); if (ty != null) { nh = ty - y0; gh = ty; } }
    else if (hnd.indexOf('n') !== -1) { ty = aggancioY(y0 + h0 - nh); if (ty != null) { nh = y0 + h0 - ty; gh = ty; } }
    if (hnd.length === 2) {
      // angolo proporzionale: comanda l'asse agganciato (x ha precedenza),
      // l'altro segue in proporzione.
      if (tx != null) { nh = h0 * (nw / w0); gh = null; }
      else if (ty != null) { nw = w0 * (nh / h0); }
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
    guidaV = gv;
    guidaH = gh;
    render();
    muoviBadgePixel(badge, ev, Math.round(larghezza(b)) + ' × ' + Math.round(altezza(b)) + ' px');
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    badge.remove();
    if (guidaV != null || guidaH != null) {
      guidaV = null;
      guidaH = null;
      render();
    }
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
// Stampa DALL'anteprima (stile Excel): sulla carta va solo l'immagine finale.
$('btnStampa').addEventListener('click', function(e) {
  e.stopPropagation();   // non chiudere l'anteprima
  document.body.classList.add('stampa');
  window.addEventListener('afterprint', function via() {
    document.body.classList.remove('stampa');
    window.removeEventListener('afterprint', via);
  });
  window.print();
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
