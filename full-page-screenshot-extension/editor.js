// Editor Multi Snip — TELA FISSA. La tela ha una dimensione stabile (quella
// dell'immagine finale): non "balla" mentre trascini. Cresce solo quando
// entra un pezzo che non ci sta, e il bottone "Fit canvas" la riadatta al
// contenuto quando lo decidi tu. Ogni pezzo si trascina liberamente dentro
// la tela (sovrapposizioni permesse, calamita sui bordi) e si ridimensiona
// da tutti e 4 gli angoli (proporzionale) e dai 4 lati (stira quel lato).

// Ogni blocco: { pid, img, natW, natH, cx, cy, cw, ch, sx, sy, x, y }.
// cx/cy/cw/ch = RITAGLIO non distruttivo (rettangolo sorgente in pixel
// naturali, default immagine intera): si può sempre riallargare.
// Ordine dell'array = ordine di sovrapposizione.
var blocchi = [];
var importati = new Set();  // id dei pezzi di sessione già portati in tela
var selezionato = -1;
var ritaglioIdx = -1;       // blocco in modalità ritaglio (-1 = nessuno)

// Annotazioni sopra il collage: oggetti leggeri, stessi gesti dei pezzi.
// { tipo:'oscura'|'evidenzia'|'testo', x, y, w, h, colore, testo?, fs? }
// { tipo:'linea', x1, y1, x2, y2, colore }
var note = [];
var selNota = -1;
var strumento = null;       // strumento armato dalla barra (one-shot)
var testoEdit = -1;         // indice della nota testo in modifica
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
// Zoom dell'area di lavoro. null = "adatta alla finestra" (il comportamento
// storico); un numero = zoom scelto a mano, anche oltre il 100%.
var zoomUtente = null;
var ZOOM_PASSI = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
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

// Dimensioni visibili = regione ritagliata × scala.
function sorgW(b) { return (b.cw != null) ? b.cw : b.natW; }
function sorgH(b) { return (b.ch != null) ? b.ch : b.natH; }
function larghezza(b) { return sorgW(b) * b.sx; }
function altezza(b) { return sorgH(b) * b.sy; }

// ---- ANCORAGGIO DELLE ANNOTAZIONI AI PEZZI ----
// Una toppa disegnata sopra un pezzo DEVE seguirlo. Se vive solo in
// coordinate della tela, basta spostare il pezzo e il dato coperto riemerge
// da sotto: un difetto di privacy, non un dettaglio estetico. Ogni nota
// tiene quindi l'id del pezzo che sta sotto e le proprie coordinate nello
// spazio NATURALE di quell'immagine; le coordinate in tela si ricalcolano
// prima di ogni disegno, così la nota segue spostamenti, scale e ritagli.

function bloccoSotto(x, y) {
  for (var i = blocchi.length - 1; i >= 0; i--) {
    var b = blocchi[i];
    if (x >= b.x && x <= b.x + larghezza(b) && y >= b.y && y <= b.y + altezza(b)) return b;
  }
  return null;
}

function bloccoDaPid(pid) {
  for (var i = 0; i < blocchi.length; i++) if (blocchi[i].pid === pid) return blocchi[i];
  return null;
}

function versoSorgente(b, x, y) {
  return { x: (x - b.x) / b.sx + (b.cx || 0), y: (y - b.y) / b.sy + (b.cy || 0) };
}
function versoTela(b, sx, sy) {
  return { x: b.x + (sx - (b.cx || 0)) * b.sx, y: b.y + (sy - (b.cy || 0)) * b.sy };
}

// Aggancia la nota al pezzo che sta sotto il suo centro (nessun pezzo =
// nota libera, si comporta come prima).
// La lente di richiamo tiene DUE rettangoli: la regione da ingrandire —
// ancorata alla foto, in coordinate naturali — e il riquadro ingrandito, che
// invece sta libero sulla tela. Qui si ricava dove cade la regione adesso.
function lenteSorgente(n) {
  var b = bloccoDaPid(n.pid);
  if (!b || !n.src) return null;
  var p = versoTela(b, n.src.x, n.src.y);
  return { x: p.x, y: p.y, w: n.src.w * b.sx, h: n.src.h * b.sy, b: b };
}

// Le due linee di richiamo: partono dal lato della regione rivolto verso il
// riquadro ingrandito e arrivano al lato opposto di quello, così non si
// incrociano mai e formano il classico cono.
function lenteRichiami(s, n) {
  var scx = s.x + s.w / 2, scy = s.y + s.h / 2;
  var dcx = n.x + n.w / 2, dcy = n.y + n.h / 2;
  var dx = dcx - scx, dy = dcy - scy;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (dx > 0) return [[s.x + s.w, s.y, n.x, n.y], [s.x + s.w, s.y + s.h, n.x, n.y + n.h]];
    return [[s.x, s.y, n.x + n.w, n.y], [s.x, s.y + s.h, n.x + n.w, n.y + n.h]];
  }
  if (dy > 0) return [[s.x, s.y + s.h, n.x, n.y], [s.x + s.w, s.y + s.h, n.x + n.w, n.y]];
  return [[s.x, s.y, n.x, n.y + n.h], [s.x + s.w, s.y, n.x + n.w, n.y + n.h]];
}

function ancoraNota(n) {
  if (n.tipo === 'lente') return;   // la lente ancora la REGIONE, non il riquadro
  var cx, cy;
  if (n.tipo === 'linea') { cx = (n.x1 + n.x2) / 2; cy = (n.y1 + n.y2) / 2; }
  else { cx = n.x + (n.w || 0) / 2; cy = n.y + (n.h || (n.fs || 0)) / 2; }
  var b = bloccoSotto(cx, cy);
  if (!b) { n.pid = null; n.anc = null; return; }
  n.pid = b.pid;
  if (n.tipo === 'linea') {
    var p1 = versoSorgente(b, n.x1, n.y1), p2 = versoSorgente(b, n.x2, n.y2);
    n.anc = { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  } else {
    var p = versoSorgente(b, n.x, n.y);
    n.anc = { x: p.x, y: p.y, w: (n.w || 0) / b.sx, h: (n.h || 0) / b.sy };
  }
}

// Ricalcola le coordinate in tela dall'ancora: chiamata prima di ogni
// disegno a schermo e prima dell'export, così non esiste un istante in cui
// la toppa e il contenuto coperto siano disallineati.
function sincronizzaNote() {
  note.forEach(function(n) {
    if (!n.pid || !n.anc) return;
    var b = bloccoDaPid(n.pid);
    if (!b) return;   // pezzo eliminato: la nota resta dov'è
    if (n.tipo === 'linea') {
      var p1 = versoTela(b, n.anc.x1, n.anc.y1), p2 = versoTela(b, n.anc.x2, n.anc.y2);
      n.x1 = p1.x; n.y1 = p1.y; n.x2 = p2.x; n.y2 = p2.y;
    } else {
      var p = versoTela(b, n.anc.x, n.anc.y);
      n.x = p.x; n.y = p.y;
      n.w = n.anc.w * b.sx;
      if (n.tipo !== 'testo') n.h = n.anc.h * b.sy;
    }
  });
}

// Raggio della sfocatura: generoso di proposito. Una sfocatura leggera su
// testo piccolo si può ricostruire; a questo raggio no.
function raggioSfoca(n) {
  return Math.max(10, Math.min(n.w || 0, n.h || 0) / 4);
}

// ---- CRONOLOGIA (annulla / ripeti) ----
// Le immagini dei pezzi sono data URL da megabyte: tenerle in ogni
// istantanea farebbe esplodere la memoria. Restano in un registro a parte e
// si riagganciano per id al ripristino.
var storia = [];
var storiaIdx = -1;
var imgPerPid = {};
var statoPreFit = null;   // per il Fit canvas che fa avanti-indietro

function istantanea() {
  return JSON.stringify({
    blocchi: blocchi.map(function(b) {
      var c = {};
      for (var k in b) if (k !== 'img') c[k] = b[k];
      return c;
    }),
    note: note,
    cw: canvasW,
    ch: canvasH,
    sf: sfondo
  });
}

function salvaStato() {
  var s = istantanea();
  if (storiaIdx >= 0 && storia[storiaIdx] === s) return;   // niente di cambiato
  storia = storia.slice(0, storiaIdx + 1);
  storia.push(s);
  if (storia.length > 60) storia.shift();
  storiaIdx = storia.length - 1;
  aggiornaBottoniStoria();
}

function ripristina(s) {
  var d = JSON.parse(s);
  blocchi = d.blocchi.map(function(b) { b.img = imgPerPid[b.pid]; return b; })
                     .filter(function(b) { return !!b.img; });
  note = d.note || [];
  canvasW = d.cw;
  canvasH = d.ch;
  if (d.sf) { sfondo = d.sf; aggiornaPannelloSfondo(); }
  selezionato = -1;
  selNota = -1;
  ritaglioIdx = -1;
  testoEdit = -1;
  render();
}

function annulla() {
  if (storiaIdx <= 0) return;
  storiaIdx--;
  ripristina(storia[storiaIdx]);
  aggiornaBottoniStoria();
}

function rifai() {
  if (storiaIdx >= storia.length - 1) return;
  storiaIdx++;
  ripristina(storia[storiaIdx]);
  aggiornaBottoniStoria();
}

function aggiornaBottoniStoria() {
  var u = $('btnUndo'), r = $('btnRedo');
  if (u) u.disabled = (storiaIdx <= 0);
  if (r) r.disabled = (storiaIdx >= storia.length - 1);
}

// Ogni gesto col mouse finisce qui: se lo stato è cambiato davvero, entra
// nella cronologia. Il rinvio serve a lasciar finire i gestori del gesto
// (che a volte annullano una nota troppo piccola).
window.addEventListener('mouseup', function() { setTimeout(salvaStato, 0); });

// Il pezzo resta sempre DENTRO la tela.
function clampBlocco(b) {
  var w = larghezza(b), h = altezza(b);
  if (w > canvasW) { b.sx = canvasW / sorgW(b); w = canvasW; }
  if (h > canvasH) { b.sy = canvasH / sorgH(b); h = canvasH; }
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
        blocchi.push({ pid: p.id, img: p.img, natW: w, natH: h, cx: 0, cy: 0, cw: w, ch: h, sx: 1, sy: 1, x: MARGINE, y: MARGINE });
      } else {
        // pezzi successivi: sotto la pila; la tela cresce SOLO se non ci stanno
        var fondo = 0;
        blocchi.forEach(function(b) { fondo = Math.max(fondo, b.y + altezza(b)); });
        var y = fondo + GAP;
        if (w + MARGINE * 2 > canvasW) canvasW = w + MARGINE * 2;
        if (y + h + MARGINE > canvasH) canvasH = y + h + MARGINE;
        blocchi.push({ pid: p.id, img: p.img, natW: w, natH: h, cx: 0, cy: 0, cw: w, ch: h, sx: 1, sy: 1, x: MARGINE, y: y });
      }
      // La tela non può superare il limite dell'export (32000px per lato):
      // un pezzo fuori misura (full page enorme su schermo retina) viene
      // adattato dentro da clampBlocco invece di sfondare il foglio.
      if (canvasW > 32000) canvasW = 32000;
      if (canvasH > 32000) canvasH = 32000;
      clampBlocco(blocchi[blocchi.length - 1]);
      selezionato = blocchi.length - 1;
      // Registro delle immagini: le istantanee della cronologia non se le
      // portano dietro (sono data URL da megabyte), si riagganciano per id.
      imgPerPid[p.id] = p.img;
    } catch (e) {
      if (p.id != null) importati.delete(p.id);
      console.warn('Pezzo illeggibile, saltato:', e);
    }
  }
  render();
  salvaStato();
  // Editor aperto e vuoto: si apre da solo il pannello di scelta.
  if (!blocchi.length && !pannelloAutoAperto) {
    pannelloAutoAperto = true;
    $('scelta').style.display = 'flex';
  }
}

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'session' && changes.multi) importaNuoviPezzi();
});

// Ctrl+V: qualsiasi immagine negli appunti diventa un pezzo del collage —
// screenshot dei DevTools fatti con Win+Shift+S, altre app, immagini
// copiate dal web. Passa dalla sessione, così segue il flusso normale.
document.addEventListener('paste', function(e) {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var k = 0; k < items.length; k++) {
    if (items[k].type && items[k].type.indexOf('image/') === 0) {
      e.preventDefault();
      var blob = items[k].getAsFile();
      if (!blob) return;
      var reader = new FileReader();
      reader.onload = function() {
        chrome.runtime.sendMessage({ action: 'multiIncolla', img: reader.result });
      };
      reader.readAsDataURL(blob);
      return;
    }
  }
});

// "Fit canvas": riadatta la tela al contenuto (pezzi E annotazioni),
// con margini uniformi.
function adattaTela() {
  if (!blocchi.length) return;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  blocchi.forEach(function(b) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + larghezza(b));
    maxY = Math.max(maxY, b.y + altezza(b));
  });
  note.forEach(function(n) {
    if (n.tipo === 'linea') {
      minX = Math.min(minX, n.x1, n.x2);
      minY = Math.min(minY, n.y1, n.y2);
      maxX = Math.max(maxX, n.x1, n.x2);
      maxY = Math.max(maxY, n.y1, n.y2);
    } else {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + (n.w || 0));
      maxY = Math.max(maxY, n.y + (n.h || (n.fs ? n.fs * 1.3 : 0)));
    }
  });
  var spX = MARGINE - minX, spY = MARGINE - minY;
  blocchi.forEach(function(b) { b.x += spX; b.y += spY; });
  note.forEach(function(n) {
    if (n.tipo === 'linea') {
      n.x1 += spX; n.y1 += spY;
      n.x2 += spX; n.y2 += spY;
    } else {
      n.x += spX;
      n.y += spY;
    }
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
    // Prima il CONTATTO esatto (0px, bordo contro bordo), poi l'affiancato
    // col respiro (GAP), poi gli allineamenti di bordo e centro.
    if (Math.abs(x - o.x) < S) { bx = o.x; gv = o.x; }
    else if (Math.abs((x + w) - (o.x + ow)) < S) { bx = o.x + ow - w; gv = o.x + ow; }
    else if (Math.abs((x + w / 2) - (o.x + ow / 2)) < S) { bx = o.x + ow / 2 - w / 2; gv = o.x + ow / 2; }
    else if (Math.abs(x - (o.x + ow)) < S) { bx = o.x + ow; gv = bx; }
    else if (Math.abs((x + w) - o.x) < S) { bx = o.x - w; gv = o.x; }
    else if (Math.abs(x - (o.x + ow + GAP)) < S) { bx = o.x + ow + GAP; gv = bx; }
    else if (Math.abs((x + w + GAP) - o.x) < S) { bx = o.x - GAP - w; gv = bx + w; }
    if (Math.abs(y - (o.y + oh)) < S) { by = o.y + oh; gh = by; }
    else if (Math.abs((y + h) - o.y) < S) { by = o.y - h; gh = o.y; }
    else if (Math.abs(y - (o.y + oh + GAP)) < S) { by = o.y + oh + GAP; gh = by; }
    else if (Math.abs((y + h + GAP) - o.y) < S) { by = o.y - GAP - h; gh = by + h; }
    else if (Math.abs(y - o.y) < S) { by = o.y; gh = o.y; }
    else if (Math.abs((y + h) - (o.y + oh)) < S) { by = o.y + oh - h; gh = o.y + oh; }
  });
  return { x: bx, y: by, gv: gv, gh: gh };
}

// ---- RENDER ----

function render() {
  sincronizzaNote();   // le toppe seguono sempre il pezzo che coprono
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
  viewK = (viewKBloccata != null) ? viewKBloccata
        : (zoomUtente != null) ? zoomUtente
        : Math.min(1, stageW() / canvasW);
  var zv = $('zoomVal');
  if (zv) zv.textContent = Math.round(viewK * 100) + '%';
  var z1 = $('zoom100'), zf = $('zoomFit');
  if (z1) z1.classList.toggle('attivo', zoomUtente === 1);
  if (zf) zf.classList.toggle('attivo', zoomUtente == null);

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
  // click sul VUOTO della tela = deseleziona (e chiude il ritaglio)
  tela.addEventListener('mousedown', function(e) {
    if (e.target === tela) {
      selezionato = -1;
      selNota = -1;
      chiudiRitaglio();
      render();
    }
  });
  // Strumento armato: il disegno dell'annotazione parte OVUNQUE sulla
  // tela, anche sopra i pezzi (fase di cattura, prima dei loro handler).
  tela.addEventListener('mousedown', function(e) {
    if (!strumento) return;
    e.preventDefault();
    e.stopPropagation();
    iniziaCreazioneNota(e, tela);
  }, true);
  blocchi.forEach(function(b, i) {
    tela.appendChild(i === ritaglioIdx ? creaBloccoRitaglio(i) : creaBlocco(i));
  });
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
  // Contorno della regione e linee di richiamo delle lenti: stanno SOTTO i
  // riquadri ingranditi e non si possono cliccare (si trascina il riquadro).
  note.forEach(function(n) {
    if (n.tipo !== 'lente') return;
    var s = lenteSorgente(n);
    if (!s) return;
    var cont = document.createElement('div');
    cont.style.cssText = 'position:absolute;pointer-events:none;z-index:780;' +
      'left:' + Math.round(s.x * viewK) + 'px;top:' + Math.round(s.y * viewK) + 'px;' +
      'width:' + Math.round(s.w * viewK) + 'px;height:' + Math.round(s.h * viewK) + 'px;' +
      'border:' + Math.max(2, Math.round(2 * viewK)) + 'px solid ' + n.colore + ';box-sizing:border-box;';
    tela.appendChild(cont);
    var sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'pointer-events:none;z-index:779;overflow:visible');
    lenteRichiami(s, n).forEach(function(L) {
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', L[0] * viewK); ln.setAttribute('y1', L[1] * viewK);
      ln.setAttribute('x2', L[2] * viewK); ln.setAttribute('y2', L[3] * viewK);
      ln.setAttribute('stroke', n.colore);
      ln.setAttribute('stroke-width', Math.max(1, 2 * viewK));
      sv.appendChild(ln);
    });
    tela.appendChild(sv);
  });
  // Annotazioni sopra il collage + barretta della nota selezionata.
  note.forEach(function(n, j) { tela.appendChild(creaNota(j)); });
  if (selNota >= 0 && selNota < note.length) tela.appendChild(creaBarraNota(selNota));
  if (strumento) { tela.style.cursor = 'crosshair'; tela.classList.add('armato'); }
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

  // Sfondo acceso: la cornice si vede DAL VIVO attorno all'area di lavoro,
  // non solo al salvataggio, così si regola guardando invece che indovinando.
  if (sfondo.attivo) {
    var telaio = document.createElement('div');
    telaio.style.cssText = 'display:inline-block;box-sizing:border-box;' +
      'padding:' + Math.round(sfondo.margine * viewK) + 'px;' +
      'border-radius:' + Math.round(sfondo.raggioEsterno * viewK) + 'px;' +
      'background:' + sfondoCss() + ';';
    telaio.appendChild(cornice);
    var centro = document.createElement('div');
    centro.style.cssText = 'text-align:center;';
    centro.appendChild(telaio);
    palco.appendChild(centro);
    return;
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

// La tela non può mai stringersi sotto il contenuto (pezzi e annotazioni).
function minimiTela() {
  var mw = 200, mh = 150;
  blocchi.forEach(function(b) {
    mw = Math.max(mw, b.x + larghezza(b));
    mh = Math.max(mh, b.y + altezza(b));
  });
  note.forEach(function(n) {
    if (n.tipo === 'linea') {
      mw = Math.max(mw, n.x1, n.x2);
      mh = Math.max(mh, n.y1, n.y2);
    } else {
      mw = Math.max(mw, n.x + (n.w || 0));
      mh = Math.max(mh, n.y + (n.h || (n.fs ? n.fs * 1.3 : 0)));
    }
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
  // Anche le annotazioni scivolano con i pezzi quando lo spazio si
  // aggiunge da sinistra/alto: devono restare incollate al contenuto.
  var origN = new Map();
  note.forEach(function(n) {
    origN.set(n, (n.tipo === 'linea')
      ? { x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2 }
      : { x: n.x, y: n.y });
  });
  function scivolaNote(dx, dy) {
    note.forEach(function(n) {
      var o = origN.get(n);
      if (!o) return;
      if (n.tipo === 'linea') {
        n.x1 = o.x1 + dx; n.y1 = o.y1 + dy;
        n.x2 = o.x2 + dx; n.y2 = o.y2 + dy;
      } else {
        n.x = o.x + dx;
        n.y = o.y + dy;
      }
    });
  }
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
    var scorriX = 0, scorriY = 0;
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
      scorriX = delta;
    }
    if (hnd.indexOf('n') !== -1) {
      var nh = Math.min(capH, Math.max(Math.max(150, h0 - minY0), Math.round(h0 - dy)));
      var deltaY = nh - h0;
      canvasH = nh;
      blocchi.forEach(function(b) {
        var o = orig.get(b);
        if (o) b.y = o.y + deltaY;
      });
      scorriY = deltaY;
    }
    scivolaNote(scorriX, scorriY);
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

  // Ritaglio non distruttivo: si mostra SOLO la regione cw×ch; l'immagine
  // intera vive dentro una finestra con l'eccedenza nascosta.
  var wVis = Math.max(16, Math.round(larghezza(b) * viewK));
  var hVis = Math.max(16, Math.round(altezza(b) * viewK));
  wrap.style.width = wVis + 'px';
  wrap.style.height = hVis + 'px';
  var clip = document.createElement('div');
  clip.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:4px;';
  var im = document.createElement('img');
  im.src = b.img;
  im.style.maxWidth = 'none';
  im.style.width = Math.round(b.natW * b.sx * viewK) + 'px';
  im.style.height = Math.round(b.natH * b.sy * viewK) + 'px';
  im.style.marginLeft = -Math.round((b.cx || 0) * b.sx * viewK) + 'px';
  im.style.marginTop = -Math.round((b.cy || 0) * b.sy * viewK) + 'px';
  clip.appendChild(im);
  wrap.appendChild(clip);

  var ctr = document.createElement('div');
  ctr.className = 'controlli';
  ctr.appendChild(bottone('✂', 'Crop — trim the edges (nothing is lost)', function() {
    chiudiRitaglio();
    ritaglioIdx = portaSopra(i);
    selezionato = ritaglioIdx;
    selNota = -1;
    render();
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
  // Il click porta il pezzo SOPRA gli altri (come nei collage veri).
  // Alt+click seleziona invece il pezzo SOTTO al punto cliccato — per
  // ripescare un pezzo coperto senza spostare quello che gli sta sopra
  // (Alt+click ripetuti scendono di un piano alla volta, poi si ricomincia).
  wrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.controlli') || e.target.classList.contains('man')) return;
    e.preventDefault();
    chiudiRitaglio();
    selNota = -1;
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

// Uscita dalla modalità ritaglio: il pezzo torna un blocco normale.
function chiudiRitaglio() {
  if (ritaglioIdx === -1) return;
  var b = blocchi[ritaglioIdx];
  if (b) clampBlocco(b);
  ritaglioIdx = -1;
}

// ---- MODALITÀ RITAGLIO ----
// L'immagine INTERA appare come fantasma trasparente; la finestra luminosa
// è la parte che resta. Le maniglie TAGLIANO i bordi invece di scalare,
// trascinando la finestra si sceglie un'altra zona. Non distruttivo:
// rientrando nel ritaglio i bordi si possono riallargare.
function creaBloccoRitaglio(i) {
  var b = blocchi[i];
  // Origine dell'immagine intera in tela: il fantasma sta fermo, la
  // finestra (e quindi il pezzo) si muove sopra di lui.
  var fx = b.x - (b.cx || 0) * b.sx;
  var fy = b.y - (b.cy || 0) * b.sy;
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;z-index:990;' +
    'left:' + Math.round(fx * viewK) + 'px;top:' + Math.round(fy * viewK) + 'px;' +
    'width:' + Math.round(b.natW * b.sx * viewK) + 'px;' +
    'height:' + Math.round(b.natH * b.sy * viewK) + 'px;';

  var fantasma = document.createElement('img');
  fantasma.src = b.img;
  fantasma.style.cssText = 'display:block;width:100%;height:100%;opacity:0.3;' +
    'pointer-events:none;user-select:none;';
  wrap.appendChild(fantasma);

  var fin = document.createElement('div');
  fin.style.cssText = 'position:absolute;cursor:move;' +
    'outline:2px dashed #00d4ff;outline-offset:-2px;' +
    'left:' + Math.round((b.cx || 0) * b.sx * viewK) + 'px;' +
    'top:' + Math.round((b.cy || 0) * b.sy * viewK) + 'px;' +
    'width:' + Math.round(larghezza(b) * viewK) + 'px;' +
    'height:' + Math.round(altezza(b) * viewK) + 'px;';
  var clipFin = document.createElement('div');
  clipFin.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  var nit = document.createElement('img');
  nit.src = b.img;
  nit.style.cssText = 'display:block;pointer-events:none;user-select:none;max-width:none;' +
    'width:' + Math.round(b.natW * b.sx * viewK) + 'px;' +
    'height:' + Math.round(b.natH * b.sy * viewK) + 'px;' +
    'margin-left:' + (-Math.round((b.cx || 0) * b.sx * viewK)) + 'px;' +
    'margin-top:' + (-Math.round((b.cy || 0) * b.sy * viewK)) + 'px;';
  clipFin.appendChild(nit);
  fin.appendChild(clipFin);
  wrap.appendChild(fin);

  function badgeTxt() { return Math.round(b.cw) + ' × ' + Math.round(b.ch) + ' px'; }

  // Finestra sempre dentro l'immagine, minimo 10px sorgente; il pezzo in
  // tela segue la finestra (b.x/b.y ancorati al fantasma fermo).
  function normalizza() {
    b.cx = Math.min(Math.max(0, b.cx), b.natW - 10);
    b.cy = Math.min(Math.max(0, b.cy), b.natH - 10);
    b.cw = Math.min(Math.max(10, b.cw), b.natW - b.cx);
    b.ch = Math.min(Math.max(10, b.ch), b.natH - b.cy);
    b.x = fx + b.cx * b.sx;
    b.y = fy + b.cy * b.sy;
  }

  // Trascinare la finestra = scegliere un'altra zona, stessa misura.
  fin.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('man') || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    e.stopPropagation();
    var sx0 = e.clientX, sy0 = e.clientY;
    var cx0 = b.cx, cy0 = b.cy;
    var badge = creaBadgePixel();
    muoviBadgePixel(badge, e, badgeTxt());
    function onMove(ev) {
      b.cx = cx0 + (ev.clientX - sx0) / viewK / b.sx;
      b.cy = cy0 + (ev.clientY - sy0) / viewK / b.sy;
      normalizza();
      render();
      muoviBadgePixel(badge, ev, badgeTxt());
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      badge.remove();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Le 8 maniglie TAGLIANO i bordi (in pixel sorgente).
  MANIGLIE.forEach(function(hnd) {
    var man = document.createElement('div');
    man.className = 'man man-' + hnd;
    man.style.display = 'block';
    man.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var sx0 = e.clientX, sy0 = e.clientY;
      var c0 = { cx: b.cx, cy: b.cy, cw: b.cw, ch: b.ch };
      var badge = creaBadgePixel();
      muoviBadgePixel(badge, e, badgeTxt());
      function onMove(ev) {
        var dx = (ev.clientX - sx0) / viewK / b.sx;
        var dy = (ev.clientY - sy0) / viewK / b.sy;
        if (hnd.indexOf('e') !== -1) b.cw = c0.cw + dx;
        if (hnd.indexOf('w') !== -1) { b.cx = c0.cx + dx; b.cw = c0.cw - dx; }
        if (hnd.indexOf('s') !== -1) b.ch = c0.ch + dy;
        if (hnd.indexOf('n') !== -1) { b.cy = c0.cy + dy; b.ch = c0.ch - dy; }
        normalizza();
        render();
        muoviBadgePixel(badge, ev, badgeTxt());
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        badge.remove();
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    fin.appendChild(man);
  });

  var ok = document.createElement('button');
  ok.textContent = '✓ Done';
  ok.title = 'Finish cropping';
  ok.style.cssText = 'position:absolute;top:-36px;right:0;z-index:5;' +
    'background:#00d4ff;color:#0d1220;border:none;border-radius:7px;' +
    'font-family:inherit;font-size:12px;font-weight:700;padding:5px 10px;cursor:pointer;';
  ok.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  ok.addEventListener('click', function(e) {
    e.stopPropagation();
    chiudiRitaglio();
    render();
  });
  fin.appendChild(ok);

  return wrap;
}

// ---- ANNOTAZIONI: oggetti leggeri sopra il collage, stessi gesti dei pezzi ----

// Colori a vista, niente pannelli: il primo è il default.
var PALETTE = {
  oscura: ['#0b0b10', '#ffffff', '#e11d48'],
  evidenzia: ['#ffe14d', '#7dff8a', '#ff7ad9'],
  linea: ['#e11d48', '#0b0b10', '#00b3e6'],
  testo: ['#e11d48', '#0b0b10', '#ffffff'],
  forma: ['#e11d48', '#00b3e6', '#ffe14d', '#0b0b10', '#ffffff'],
  contatore: ['#e11d48', '#00b3e6', '#16a34a', '#0b0b10'],
  lente: ['#e11d48', '#00b3e6', '#16a34a', '#0b0b10', '#ffffff']
};

// Numero mostrato da un contatore: NON è memorizzato, si ricava dalla
// posizione fra gli altri contatori. Così cancellandone uno in mezzo la
// numerazione si richiude da sola e non restano buchi né doppioni.
function numeroContatore(j) {
  var k = 0;
  for (var i = 0; i <= j; i++) if (note[i] && note[i].tipo === 'contatore') k++;
  return k;
}

// ---- LIBRERIA DELLE FORME ----
// Ogni forma è un percorso disegnato dentro una scatola 100×100. Da lì si
// adatta a qualunque rettangolo: a schermo con un SVG che si stira, e
// nell'export con lo STESSO percorso ridisegnato sul canvas (Path2D). Una
// sola definizione per entrambi: non possono divergere.
// soloTratto = forme che vivono di linea, non di riempimento (spunta,
// croce, frecce sottili, mirino).
var FORME = [
  { id: 'rettangolo', nome: 'Rectangle', d: 'M4 4H96V96H4Z' },
  { id: 'arrotondato', nome: 'Rounded box', d: 'M22 4H78A18 18 0 0 1 96 22V78A18 18 0 0 1 78 96H22A18 18 0 0 1 4 78V22A18 18 0 0 1 22 4Z' },
  { id: 'cerchio', nome: 'Circle', d: 'M50 5A45 45 0 1 0 50 95A45 45 0 1 0 50 5Z' },
  { id: 'triangolo', nome: 'Triangle', d: 'M50 6L95 94H5Z' },
  { id: 'triangoloGiu', nome: 'Triangle down', d: 'M50 94L5 6H95Z' },
  { id: 'rombo', nome: 'Diamond', d: 'M50 5L95 50L50 95L5 50Z' },
  { id: 'pentagono', nome: 'Pentagon', d: 'M50 5L95 39L78 92H22L5 39Z' },
  { id: 'esagono', nome: 'Hexagon', d: 'M28 8H72L95 50L72 92H28L5 50Z' },
  { id: 'ottagono', nome: 'Octagon', d: 'M32 5H68L95 32V68L68 95H32L5 68V32Z' },
  { id: 'parallelogramma', nome: 'Parallelogram', d: 'M26 12H96L74 88H4Z' },
  { id: 'trapezio', nome: 'Trapezoid', d: 'M26 12H74L96 88H4Z' },
  { id: 'stella5', nome: 'Star', d: 'M50 4L62 37H97L69 58L80 93L50 71L20 93L31 58L3 37H38Z' },
  { id: 'stella6', nome: 'Six-point star', d: 'M50 6L88 72H12Z M50 94L12 28H88Z' },
  { id: 'cuore', nome: 'Heart', d: 'M50 92C20 70 6 52 6 34C6 18 18 8 31 8C40 8 46 13 50 20C54 13 60 8 69 8C82 8 94 18 94 34C94 52 80 70 50 92Z' },
  { id: 'mezzaluna', nome: 'Crescent', d: 'M64 5A45 45 0 1 0 64 95A37 37 0 1 1 64 5Z' },
  { id: 'nuvola', nome: 'Cloud', d: 'M27 82A23 23 0 0 1 27 36A27 27 0 0 1 75 30A21 21 0 0 1 79 82Z' },
  { id: 'fulmine', nome: 'Lightning', d: 'M58 3L20 55H45L38 97L82 41H55Z' },
  { id: 'scudo', nome: 'Shield', d: 'M50 4L92 18V50C92 74 74 90 50 96C26 90 8 74 8 50V18Z' },
  { id: 'goccia', nome: 'Drop', d: 'M50 4C50 4 84 44 84 64A34 34 0 1 1 16 64C16 44 50 4 50 4Z' },
  { id: 'croce', nome: 'Plus', d: 'M38 4H62V38H96V62H62V96H38V62H4V38H38Z' },
  { id: 'segnalibro', nome: 'Bookmark', d: 'M22 4H78V96L50 74L22 96Z' },
  { id: 'cornice', nome: 'Frame', d: 'M4 4H96V96H4Z M18 18V82H82V18Z' },
  { id: 'frecciaDx', nome: 'Arrow right', d: 'M4 36H58V14L96 50L58 86V64H4Z' },
  { id: 'frecciaSx', nome: 'Arrow left', d: 'M96 36H42V14L4 50L42 86V64H96Z' },
  { id: 'frecciaSu', nome: 'Arrow up', d: 'M36 96V42H14L50 4L86 42H64V96Z' },
  { id: 'frecciaGiu', nome: 'Arrow down', d: 'M36 4V58H14L50 96L86 58H64V4Z' },
  { id: 'frecciaDoppia', nome: 'Double arrow', d: 'M4 50L28 22V38H72V22L96 50L72 78V62H28V78Z' },
  { id: 'frecciaDoppiaV', nome: 'Double arrow up/down', d: 'M50 4L78 28H62V72H78L50 96L22 72H38V28H22Z' },
  { id: 'frecciaSottile', nome: 'Thin arrow', d: 'M6 50H88 M68 28L92 50L68 72', soloTratto: true },
  { id: 'frecciaCurva', nome: 'Curved arrow', d: 'M8 90C8 42 38 16 84 16 M84 16L62 4 M84 16L62 30', soloTratto: true },
  { id: 'spunta', nome: 'Check', d: 'M8 54L38 84L92 16', soloTratto: true },
  { id: 'ics', nome: 'Cross', d: 'M12 12L88 88 M88 12L12 88', soloTratto: true },
  { id: 'mirino', nome: 'Target', d: 'M50 6V26 M50 74V94 M6 50H26 M74 50H94 M50 22A28 28 0 1 0 50 78A28 28 0 1 0 50 22Z', soloTratto: true },
  { id: 'fumetto', nome: 'Speech bubble', d: 'M50 8C24 8 6 24 6 44C6 60 18 73 36 78L27 96L56 78C79 76 94 61 94 44C94 24 76 8 50 8Z' },
  { id: 'fumettoQuadro', nome: 'Square bubble', d: 'M8 10H92V68H48L26 94V68H8Z' },
  { id: 'fumettoPensiero', nome: 'Thought bubble', d: 'M50 8C27 8 10 21 10 37C10 51 22 61 39 63L33 76L52 63C75 61 90 51 90 37C90 21 73 8 50 8Z M24 78A8 8 0 1 0 24 94A8 8 0 1 0 24 78Z M10 88A5 5 0 1 0 10 98A5 5 0 1 0 10 88Z' },
  { id: 'fumettoUrlo', nome: 'Burst bubble', d: 'M50 3L60 21L80 13L76 33L96 39L80 51L94 67L74 69L76 89L58 79L50 97L42 79L24 89L26 69L6 67L20 51L4 39L24 33L20 13L40 21Z' }
];

// ---- SFONDO E CORNICE ----
// La cornice che trasforma uno screenshot in un'immagine da presentazione:
// sfondo (tinta o sfumatura), margine, ombra, angoli arrotondati, formato
// forzato e filigrana. Si applica IN CODA alla composizione, quindi non
// tocca nulla di come sono montati i pezzi.
var SFONDI = [
  { id: 'menta', da: '#7ee8b2', a: '#22d3ee' },
  { id: 'oceano', da: '#38bdf8', a: '#2563eb' },
  { id: 'lilla', da: '#c4b5fd', a: '#7c3aed' },
  { id: 'rosa', da: '#fda4af', a: '#e11d48' },
  { id: 'tramonto', da: '#fbbf24', a: '#f43f5e' },
  { id: 'lime', da: '#bef264', a: '#16a34a' },
  { id: 'corallo', da: '#fb923c', a: '#db2777' },
  { id: 'ghiaccio', da: '#e0f2fe', a: '#93c5fd' },
  { id: 'crema', da: '#fef3c7', a: '#fcd34d' },
  { id: 'ardesia', da: '#64748b', a: '#0f172a' },
  { id: 'notte', da: '#334155', a: '#020617' },
  { id: 'carta', da: '#ffffff', a: '#d1d5db' }
];

var sfondo = {
  attivo: false,
  tinta: 'sfumatura',      // 'sfumatura' | 'solido'
  preset: 'menta',
  margine: 60,
  ombra: 28,
  raggioEsterno: 18,
  raggioInterno: 10,
  proporzioni: 'originale',
  filigrana: ''
};

function sfondoPreset() {
  for (var i = 0; i < SFONDI.length; i++) if (SFONDI[i].id === sfondo.preset) return SFONDI[i];
  return SFONDI[0];
}

function sfondoCss(p, tinta) {
  p = p || sfondoPreset();
  tinta = tinta || sfondo.tinta;
  return (tinta === 'solido') ? p.da : ('linear-gradient(135deg,' + p.da + ',' + p.a + ')');
}

// Rettangolo con gli angoli arrotondati: serve sia al riquadro esterno sia
// all'immagine dentro.
function percorsoArrotondato(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// Passo finale dell'export: prende la composizione già pronta e la posa
// sullo sfondo. Se non è acceso, restituisce l'originale intatto.
function applicaSfondo(canvas) {
  if (!sfondo.attivo || !canvas) return canvas;
  var m = Math.round(sfondo.margine);
  var W = canvas.width + m * 2, H = canvas.height + m * 2;
  if (sfondo.proporzioni !== 'originale') {
    var r = parseFloat(sfondo.proporzioni);
    if (r > 0) {
      if (W / H < r) W = Math.round(H * r);
      else H = Math.round(W / r);
    }
  }
  // Stessi limiti del canvas di Chrome: meglio niente cornice che un export
  // che fallisce in silenzio.
  if (W > 32000 || H > 32000 || W * H > 240000000) return canvas;
  var out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  var c = out.getContext('2d');
  var p = sfondoPreset();
  if (sfondo.tinta === 'solido') {
    c.fillStyle = p.da;
  } else {
    var g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, p.da);
    g.addColorStop(1, p.a);
    c.fillStyle = g;
  }
  percorsoArrotondato(c, 0, 0, W, H, sfondo.raggioEsterno);
  c.fill();
  var ix = Math.round((W - canvas.width) / 2), iy = Math.round((H - canvas.height) / 2);
  if (sfondo.ombra > 0) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = sfondo.ombra;
    c.shadowOffsetY = Math.round(sfondo.ombra * 0.35);
    percorsoArrotondato(c, ix, iy, canvas.width, canvas.height, sfondo.raggioInterno);
    c.fillStyle = '#ffffff';
    c.fill();
    c.restore();
  }
  c.save();
  percorsoArrotondato(c, ix, iy, canvas.width, canvas.height, sfondo.raggioInterno);
  c.clip();
  c.drawImage(canvas, ix, iy);
  c.restore();
  if (sfondo.filigrana) {
    var fs = Math.max(12, Math.round(W * 0.013));
    c.font = '600 ' + fs + "px 'Segoe UI', sans-serif";
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillText(sfondo.filigrana, W / 2 + 1, H - Math.max(8, m * 0.28) + 1);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillText(sfondo.filigrana, W / 2, H - Math.max(8, m * 0.28));
  }
  return out;
}

function formaDaId(id) {
  for (var i = 0; i < FORME.length; i++) if (FORME[i].id === id) return FORME[i];
  return FORME[0];
}

var formaScelta = 'rettangolo';   // ultima forma presa dal pannellino

// Arma (o disarma) uno strumento della barra. Lo strumento RESTA armato
// finché non si torna alla manina (bottone Move o Esc): disegnare dieci
// riquadri di seguito non deve costare dieci click sulla barra.
function armaStrumento(t) {
  strumento = (strumento === t) ? null : t;
  selezionato = -1;
  selNota = -1;
  chiudiRitaglio();
  aggiornaBarraStrumenti();
  render();
}

function aggiornaBarraStrumenti() {
  [['btnOscura', 'oscura'], ['btnEvidenzia', 'evidenzia'], ['btnLinea', 'linea'],
   ['btnTesto', 'testo'], ['btnForme', 'forma'], ['btnContatore', 'contatore'],
   ['btnLente', 'lente']].forEach(function(v) {
    var el = $(v[0]);
    if (el) el.classList.toggle('attivo', strumento === v[1]);
  });
  var m = $('btnMano');
  if (m) m.classList.toggle('attivo', !strumento);
}

function iniziaCreazioneNota(e, tela) {
  var r = tela.getBoundingClientRect();
  var x0 = (e.clientX - r.left) / viewK;
  var y0 = (e.clientY - r.top) / viewK;
  var t = strumento;
  // Lo strumento NON si disarma: resta attivo per il disegno successivo.
  // Solo il testo torna alla manina, perché subito dopo si scrive.
  if (t === 'testo') { strumento = null; aggiornaBarraStrumenti(); }
  var n;
  if (t === 'linea') n = { tipo: 'linea', x1: x0, y1: y0, x2: x0, y2: y0, colore: PALETTE.linea[0] };
  else if (t === 'testo') n = { tipo: 'testo', x: x0, y: y0, w: 260, fs: 22, colore: PALETTE.testo[0], testo: '' };
  else if (t === 'lente') n = { tipo: 'lente', x: x0, y: y0, w: 0, h: 0, colore: '#e11d48', zoom: 2 };
  else if (t === 'contatore') {
    // Un click secco lo piazza già bello e pronto; trascinando si decide
    // quanto grande. Il numero arriva da solo.
    var D = 42;
    n = { tipo: 'contatore', x: x0 - D / 2, y: y0 - D / 2, w: D, h: D, colore: PALETTE.contatore[0] };
  }
  else if (t === 'forma') n = {
    tipo: 'forma', forma: formaScelta, x: x0, y: y0, w: 0, h: 0,
    colore: PALETTE.forma[0],
    riempito: !formaDaId(formaScelta).soloTratto,
    spessore: 4
  };
  else n = { tipo: t, x: x0, y: y0, w: 0, h: 0, colore: PALETTE[t][0], stile: 'solid' };
  note.push(n);
  selNota = note.length - 1;
  function onMove(ev) {
    var x = (ev.clientX - r.left) / viewK;
    var y = (ev.clientY - r.top) / viewK;
    if (n.tipo === 'linea') { n.x2 = x; n.y2 = y; }
    else if (n.tipo === 'testo') { n.w = Math.max(80, x - n.x); }
    else if (n.tipo === 'contatore') {
      // resta un cerchio e resta centrato sul punto cliccato
      var d = Math.max(20, Math.hypot(x - x0, y - y0) * 2);
      n.w = d; n.h = d;
      n.x = x0 - d / 2;
      n.y = y0 - d / 2;
    }
    else {
      n.x = Math.min(x0, x);
      n.y = Math.min(y0, y);
      n.w = Math.abs(x - x0);
      n.h = Math.abs(y - y0);
    }
    render();
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    if (n.tipo === 'lente') {
      // Quello che hai trascinato è la REGIONE da ingrandire: si converte
      // nelle coordinate della foto e il riquadro ingrandito nasce accanto.
      var bl = (n.w >= 8 && n.h >= 8) ? bloccoSotto(n.x + n.w / 2, n.y + n.h / 2) : null;
      if (!bl) {
        note.pop();
        selNota = -1;
      } else {
        var ps = versoSorgente(bl, n.x, n.y);
        n.pid = bl.pid;
        n.src = { x: ps.x, y: ps.y, w: n.w / bl.sx, h: n.h / bl.sy };
        var dw = n.w * n.zoom, dh = n.h * n.zoom;
        var dxn = n.x + n.w / 2 - dw / 2;
        var dyn = n.y + n.h + 34;
        if (dyn + dh > canvasH) dyn = n.y - dh - 34;          // non ci sta sotto: sopra
        if (dyn < 0) dyn = Math.min(n.y + n.h + 34, Math.max(0, canvasH - dh));
        dxn = Math.min(Math.max(0, dxn), Math.max(0, canvasW - dw));
        n.x = dxn; n.y = dyn; n.w = dw; n.h = dh;
      }
    } else if (n.tipo === 'oscura' || n.tipo === 'evidenzia' || n.tipo === 'forma') {
      if (n.w < 6 || n.h < 6) { note.pop(); selNota = -1; }
    } else if (n.tipo === 'linea') {
      if (Math.hypot(n.x2 - n.x1, n.y2 - n.y1) < 6) { note.pop(); selNota = -1; }
    } else if (n.tipo === 'testo') {
      testoEdit = selNota;   // si scrive subito, senza altri click
    }
    if (note[selNota]) ancoraNota(note[selNota]);
    render();
  }
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  render();
}

function creaNota(j) {
  var n = note[j];
  var sel = (j === selNota);
  var el = document.createElement('div');
  var base = 'position:absolute;z-index:' + (800 + j) + ';';
  if (n.tipo === 'linea') {
    var len = Math.hypot(n.x2 - n.x1, n.y2 - n.y1);
    var ang = Math.atan2(n.y2 - n.y1, n.x2 - n.x1);
    // La zona cliccabile è una fascia di 16px trasparente: la linea vera è
    // spessa 3px e prenderla al pixel era impossibile — sembrava che una
    // volta disegnata non si potesse più né spostare né selezionare.
    var PRESA = 16;
    el.style.cssText = base +
      'left:' + Math.round(n.x1 * viewK) + 'px;top:' + (Math.round(n.y1 * viewK) - PRESA / 2) + 'px;' +
      'width:' + Math.round(len * viewK) + 'px;height:' + PRESA + 'px;' +
      'background:transparent;transform-origin:0 ' + (PRESA / 2) + 'px;transform:rotate(' + ang + 'rad);' +
      'cursor:grab;';
    var tratto = document.createElement('div');
    tratto.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);' +
      'height:' + Math.max(2, Math.round(3 * viewK)) + 'px;border-radius:2px;pointer-events:none;' +
      'background:' + n.colore + ';' +
      (sel ? 'box-shadow:0 0 0 2px rgba(0,212,255,0.7);' : '');
    el.appendChild(tratto);
  } else if (n.tipo === 'testo') {
    el.style.cssText = base +
      'left:' + Math.round(n.x * viewK) + 'px;top:' + Math.round(n.y * viewK) + 'px;' +
      'width:' + Math.round(n.w * viewK) + 'px;min-height:' + Math.round(n.fs * viewK) + 'px;' +
      'cursor:grab;color:' + n.colore + ';font-weight:600;' +
      'font-size:' + (n.fs * viewK) + "px;line-height:1.3;font-family:'Segoe UI', sans-serif;" +
      'white-space:pre-wrap;word-break:break-word;' +
      (sel || testoEdit === j ? 'outline:1px dashed rgba(0,212,255,0.8);outline-offset:2px;' : '');
    el.textContent = n.testo || '';
    if (testoEdit === j) {
      el.contentEditable = 'true';
      el.style.cursor = 'text';
      el.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      el.addEventListener('blur', function() {
        n.testo = el.innerText.replace(/\n+$/, '');
        testoEdit = -1;
        if (!n.testo.trim()) { note.splice(j, 1); selNota = -1; }
        render();
      });
      setTimeout(function() { el.focus(); }, 0);
    }
  } else if (n.tipo === 'lente') {
    // Il riquadro ingrandito: la foto stessa, riscalata con lo sfondo CSS.
    // Il contorno della regione e le linee di richiamo li disegna render(),
    // perché stanno FUORI da questo riquadro.
    var sl = lenteSorgente(n);
    el.style.cssText = base +
      'left:' + Math.round(n.x * viewK) + 'px;top:' + Math.round(n.y * viewK) + 'px;' +
      'width:' + Math.round(n.w * viewK) + 'px;height:' + Math.round(n.h * viewK) + 'px;' +
      'cursor:grab;overflow:hidden;background-color:#fff;' +
      'border:' + Math.max(2, Math.round(3 * viewK)) + 'px solid ' + n.colore + ';' +
      'box-sizing:border-box;box-shadow:0 4px 14px rgba(0,0,0,0.4);' +
      (sel ? 'outline:2px solid rgba(0,212,255,0.9);outline-offset:3px;' : '');
    if (sl) {
      var kIng = n.w / n.src.w;   // da pixel naturali della foto a unità di tela
      var interno = document.createElement('div');
      interno.style.cssText = 'position:absolute;inset:0;pointer-events:none;' +
        'background-repeat:no-repeat;background-image:url(' + sl.b.img + ');' +
        'background-size:' + (sl.b.natW * kIng * viewK) + 'px ' + (sl.b.natH * kIng * viewK) + 'px;' +
        'background-position:' + (-n.src.x * kIng * viewK) + 'px ' + (-n.src.y * kIng * viewK) + 'px;';
      el.appendChild(interno);
    }
  } else if (n.tipo === 'contatore') {
    var lato = Math.max(n.w, n.h) * viewK;
    el.style.cssText = base +
      'left:' + Math.round(n.x * viewK) + 'px;top:' + Math.round(n.y * viewK) + 'px;' +
      'width:' + Math.round(lato) + 'px;height:' + Math.round(lato) + 'px;' +
      'background:' + n.colore + ';border-radius:50%;cursor:grab;' +
      'display:flex;align-items:center;justify-content:center;' +
      'color:#fff;font-weight:800;font-family:\'Segoe UI\', sans-serif;' +
      'font-size:' + Math.round(lato * 0.56) + 'px;line-height:1;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.35);' +
      (sel ? 'outline:2px solid rgba(0,212,255,0.9);outline-offset:3px;' : '');
    el.textContent = String(numeroContatore(j));
  } else if (n.tipo === 'forma') {
    // La forma è lo STESSO percorso dell'export, stirato dentro il rettangolo
    // che hai trascinato. Il tratto non si deforma (non-scaling-stroke): un
    // contorno resta di spessore uniforme anche su una forma schiacciata.
    var f = formaDaId(n.forma);
    var pieno = n.riempito && !f.soloTratto;
    el.style.cssText = base +
      'left:' + Math.round(n.x * viewK) + 'px;top:' + Math.round(n.y * viewK) + 'px;' +
      'width:' + Math.round(n.w * viewK) + 'px;height:' + Math.round(n.h * viewK) + 'px;' +
      'cursor:grab;' +
      (sel ? 'outline:2px solid rgba(0,212,255,0.7);outline-offset:3px;border-radius:3px;' : '');
    el.innerHTML = '<svg width="100%" height="100%" viewBox="0 0 100 100" ' +
      'preserveAspectRatio="none" style="display:block;overflow:visible;pointer-events:none">' +
      '<path d="' + f.d + '" fill-rule="evenodd" ' +
      'fill="' + (pieno ? n.colore : 'none') + '" ' +
      'stroke="' + n.colore + '" ' +
      'stroke-width="' + (pieno ? 0 : Math.max(1, n.spessore * viewK)) + '" ' +
      'vector-effect="non-scaling-stroke" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    // oscura = coprente (o sfocata); evidenzia = colore al 40% (alpha nel
    // colore, non opacity: le maniglie non devono sbiadire)
    var sfoca = (n.tipo === 'oscura' && n.stile === 'blur');
    var fondo = sfoca ? 'transparent'
      : (n.tipo === 'evidenzia') ? (n.colore + '66') : n.colore;
    var rs = sfoca ? (raggioSfoca(n) * viewK) : 0;
    el.style.cssText = base +
      'left:' + Math.round(n.x * viewK) + 'px;top:' + Math.round(n.y * viewK) + 'px;' +
      'width:' + Math.round(n.w * viewK) + 'px;height:' + Math.round(n.h * viewK) + 'px;' +
      'background:' + fondo + ';cursor:grab;border-radius:2px;' +
      (sfoca ? 'backdrop-filter:blur(' + rs + 'px);-webkit-backdrop-filter:blur(' + rs + 'px);' : '') +
      (sel ? 'box-shadow:0 0 0 2px rgba(0,212,255,0.7);' : '');
  }

  if (!(n.tipo === 'testo' && testoEdit === j)) {
    el.addEventListener('mousedown', function(e) {
      if (e.target.classList.contains('man') || e.target.classList.contains('capo')) return;
      e.preventDefault();
      e.stopPropagation();
      selNota = j;
      selezionato = -1;
      chiudiRitaglio();
      var sx0 = e.clientX, sy0 = e.clientY;
      var o = (n.tipo === 'linea')
        ? { x1: n.x1, y1: n.y1, x2: n.x2, y2: n.y2 }
        : { x: n.x, y: n.y };
      function onMove(ev) {
        var dx = (ev.clientX - sx0) / viewK;
        var dy = (ev.clientY - sy0) / viewK;
        if (n.tipo === 'linea') {
          n.x1 = o.x1 + dx; n.y1 = o.y1 + dy;
          n.x2 = o.x2 + dx; n.y2 = o.y2 + dy;
        } else {
          n.x = o.x + dx;
          n.y = o.y + dy;
        }
        render();
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        ancoraNota(n);   // spostata: si riaggancia al pezzo che ora sta sotto
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      render();
    });
    if (n.tipo === 'testo') {
      el.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        testoEdit = j;
        selNota = j;
        render();
      });
    }
  }

  if (sel && testoEdit !== j) {
    if (n.tipo === 'linea') {
      // due capi trascinabili
      var lung = Math.hypot(n.x2 - n.x1, n.y2 - n.y1) * viewK;
      [0, 1].forEach(function(capo) {
        var man = document.createElement('div');
        man.className = 'capo';
        man.style.cssText = 'position:absolute;width:12px;height:12px;border-radius:50%;' +
          'background:#00d4ff;border:2px solid #0d1220;cursor:crosshair;top:50%;' +
          'left:' + (capo ? Math.round(lung) : 0) + 'px;transform:translate(-50%,-50%);';
        man.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var telaEl = $('tela');
          var r = telaEl.getBoundingClientRect();
          function onMove(ev) {
            var x = (ev.clientX - r.left) / viewK;
            var y = (ev.clientY - r.top) / viewK;
            // Con Shift l'angolo scatta di 15 in 15 gradi: è il modo per
            // ottenere una linea esattamente a 30° (o 45°, o orizzontale)
            // senza andare a occhio.
            if (ev.shiftKey) {
              var fx = capo ? n.x1 : n.x2, fy = capo ? n.y1 : n.y2;
              var d = Math.hypot(x - fx, y - fy);
              var a = Math.round(Math.atan2(y - fy, x - fx) / (Math.PI / 12)) * (Math.PI / 12);
              x = fx + Math.cos(a) * d;
              y = fy + Math.sin(a) * d;
            }
            if (capo) { n.x2 = x; n.y2 = y; } else { n.x1 = x; n.y1 = y; }
            render();
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            ancoraNota(n);
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
        el.appendChild(man);
      });
    } else if (n.tipo !== 'testo') {
      ['nw', 'ne', 'sw', 'se'].forEach(function(hnd) {
        var man = document.createElement('div');
        man.className = 'man man-' + hnd;
        man.style.display = 'block';
        man.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var sx0 = e.clientX, sy0 = e.clientY;
          var o = { x: n.x, y: n.y, w: n.w, h: n.h };
          function onMove(ev) {
            var dx = (ev.clientX - sx0) / viewK;
            var dy = (ev.clientY - sy0) / viewK;
            if (hnd.indexOf('e') !== -1) n.w = Math.max(8, o.w + dx);
            if (hnd.indexOf('w') !== -1) { n.w = Math.max(8, o.w - dx); n.x = o.x + (o.w - n.w); }
            if (hnd.indexOf('s') !== -1) n.h = Math.max(8, o.h + dy);
            if (hnd.indexOf('n') !== -1) { n.h = Math.max(8, o.h - dy); n.y = o.y + (o.h - n.h); }
            // Il contatore resta tondo: un cerchio schiacciato non è un
            // contatore, è un errore.
            if (n.tipo === 'contatore') {
              var d = Math.max(n.w, n.h);
              if (hnd.indexOf('w') !== -1) n.x = o.x + (o.w - d);
              if (hnd.indexOf('n') !== -1) n.y = o.y + (o.h - d);
              n.w = d; n.h = d;
            }
            render();
          }
          function onUp() {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            ancoraNota(n);
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
        el.appendChild(man);
      });
    }
  }
  return el;
}

// Barretta della nota selezionata: colori a vista, A−/A+ per il testo, 🗑.
function creaBarraNota(j) {
  var n = note[j];
  var bar = document.createElement('div');
  var bx = (n.tipo === 'linea') ? Math.min(n.x1, n.x2) : n.x;
  var by = (n.tipo === 'linea') ? Math.min(n.y1, n.y2) : n.y;
  bar.style.cssText = 'position:absolute;z-index:970;display:flex;gap:5px;align-items:center;' +
    'left:' + Math.round(bx * viewK) + 'px;top:' + (Math.round(by * viewK) - 34) + 'px;' +
    'background:#16162a;border:1px solid rgba(0,212,255,0.4);border-radius:7px;padding:4px 6px;';
  bar.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  // Col riempimento sfocato il colore non c'entra nulla: i pallini spariscono.
  if (!(n.tipo === 'oscura' && n.stile === 'blur')) {
    PALETTE[n.tipo].forEach(function(c) {
      var dot = document.createElement('span');
      dot.style.cssText = 'width:14px;height:14px;border-radius:50%;cursor:pointer;display:inline-block;' +
        'background:' + c + ';border:2px solid ' + (n.colore === c ? '#00d4ff' : 'rgba(255,255,255,0.25)') + ';';
      dot.addEventListener('click', function() { n.colore = c; render(); salvaStato(); });
      bar.appendChild(dot);
    });
  }
  // Lente: quanto ingrandire. Il riquadro cresce dal centro, la regione
  // inquadrata resta la stessa.
  if (n.tipo === 'lente') {
    var sLn = lenteSorgente(n);
    var fatt = (sLn && sLn.w) ? (n.w / sLn.w) : 1;
    var et = document.createElement('span');
    et.textContent = (Math.round(fatt * 10) / 10) + '×';
    et.style.cssText = 'color:#8b8ba3;font-size:11px;font-weight:700;padding:0 2px;';
    bar.appendChild(et);
    [['−', 1 / 1.25], ['+', 1.25]].forEach(function(v) {
      var bt = document.createElement('button');
      bt.textContent = v[0];
      bt.title = 'Magnification';
      bt.style.cssText = 'border:none;background:transparent;color:#00d4ff;font-family:inherit;' +
        'font-weight:700;cursor:pointer;font-size:13px;padding:0 4px;';
      bt.addEventListener('click', function() {
        var c = n.x + n.w / 2, m = n.y + n.h / 2;
        n.w = Math.max(30, n.w * v[1]);
        n.h = Math.max(30, n.h * v[1]);
        n.x = c - n.w / 2;
        n.y = m - n.h / 2;
        render();
        salvaStato();
      });
      bar.appendChild(bt);
    });
  }
  // Contatore: solo la misura del pallino (il numero se lo fa da solo).
  if (n.tipo === 'contatore') {
    [['−', -6], ['+', 6]].forEach(function(v) {
      var bt = document.createElement('button');
      bt.textContent = v[0];
      bt.title = 'Size';
      bt.style.cssText = 'border:none;background:transparent;color:#00d4ff;font-family:inherit;' +
        'font-weight:700;cursor:pointer;font-size:13px;padding:0 4px;';
      bt.addEventListener('click', function() {
        var c = n.x + n.w / 2, m = n.y + n.h / 2;
        var d = Math.min(200, Math.max(20, n.w + v[1]));
        n.w = d; n.h = d;
        n.x = c - d / 2;
        n.y = m - d / 2;
        ancoraNota(n);
        render();
        salvaStato();
      });
      bar.appendChild(bt);
    });
  }
  // Forme: pieno o solo contorno, e lo spessore del contorno.
  if (n.tipo === 'forma') {
    var fm = formaDaId(n.forma);
    if (!fm.soloTratto) {
      [['Fill', true], ['Outline', false]].forEach(function(v) {
        var bt = document.createElement('button');
        bt.textContent = v[0];
        var on = (!!n.riempito === v[1]);
        bt.style.cssText = 'border:1px solid ' + (on ? '#00d4ff' : 'rgba(255,255,255,0.2)') + ';' +
          'background:' + (on ? '#00d4ff' : 'transparent') + ';' +
          'color:' + (on ? '#0d1220' : '#8b8ba3') + ';font-family:inherit;' +
          'font-weight:700;cursor:pointer;font-size:11px;padding:2px 7px;border-radius:5px;';
        bt.addEventListener('click', function() { n.riempito = v[1]; render(); salvaStato(); });
        bar.appendChild(bt);
      });
    }
    if (fm.soloTratto || !n.riempito) {
      [['−', -1], ['+', 1]].forEach(function(v) {
        var bt = document.createElement('button');
        bt.textContent = v[0];
        bt.title = 'Line thickness';
        bt.style.cssText = 'border:none;background:transparent;color:#00d4ff;font-family:inherit;' +
          'font-weight:700;cursor:pointer;font-size:13px;padding:0 4px;';
        bt.addEventListener('click', function() {
          n.spessore = Math.min(24, Math.max(1, (n.spessore || 4) + v[1]));
          render();
          salvaStato();
        });
        bar.appendChild(bt);
      });
    }
  }
  // Coprente o sfocato: due modi di nascondere, si scelgono qui.
  if (n.tipo === 'oscura') {
    [['Solid', 'solid', 'Solid fill — the safest way to hide data'],
     ['Blur', 'blur', 'Blur the area — see-through effect']].forEach(function(v) {
      var bt = document.createElement('button');
      bt.textContent = v[0];
      bt.title = v[2];
      var on = ((n.stile || 'solid') === v[1]);
      bt.style.cssText = 'border:1px solid ' + (on ? '#00d4ff' : 'rgba(255,255,255,0.2)') + ';' +
        'background:' + (on ? '#00d4ff' : 'transparent') + ';' +
        'color:' + (on ? '#0d1220' : '#8b8ba3') + ';font-family:inherit;' +
        'font-weight:700;cursor:pointer;font-size:11px;padding:2px 7px;border-radius:5px;';
      bt.addEventListener('click', function() { n.stile = v[1]; render(); salvaStato(); });
      bar.appendChild(bt);
    });
  }
  if (n.tipo === 'testo') {
    [['A−', -3], ['A+', 3]].forEach(function(v) {
      var bt = document.createElement('button');
      bt.textContent = v[0];
      bt.style.cssText = 'border:none;background:transparent;color:#00d4ff;font-weight:700;cursor:pointer;font-size:12px;padding:0 3px;';
      bt.addEventListener('click', function() {
        n.fs = Math.min(120, Math.max(10, n.fs + v[1]));
        render();
        salvaStato();
      });
      bar.appendChild(bt);
    });
  }
  var del = document.createElement('button');
  del.textContent = '\u{1F5D1}';
  del.title = 'Remove';
  del.style.cssText = 'border:none;background:transparent;color:#ff6b6b;cursor:pointer;font-size:12px;padding:0 3px;';
  del.addEventListener('click', function() {
    note.splice(j, 1);
    selNota = -1;
    render();
    salvaStato();
  });
  bar.appendChild(del);
  return bar;
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
      b.sx = nw / sorgW(b);
      b.sy = nh / sorgH(b);
    } else if (hnd === 'e' || hnd === 'w') {
      b.sx = nw / sorgW(b);
    } else {
      b.sy = nh / sorgH(b);
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
  // Mentre si scrive un testo, la tastiera è sua.
  if (document.activeElement && document.activeElement.isContentEditable) return;
  // Annulla / ripeti: le scorciatoie di sempre.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) rifai(); else annulla();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    rifai();
    return;
  }
  if (e.key === 'Escape') {
    $('scelta').style.display = 'none';
    $('anteprima').style.display = 'none';
    chiudiPannelloForme();
    if (strumento) { strumento = null; aggiornaBarraStrumenti(); }
    chiudiRitaglio();
    selNota = -1;
    render();
    return;
  }
  if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  var passo = e.shiftKey ? 10 : 1;
  // Prima le annotazioni selezionate, poi i pezzi.
  if (selNota >= 0 && selNota < note.length) {
    var n = note[selNota];
    var dx = 0, dy = 0;
    var presoN = true;
    if (e.key === 'ArrowLeft') dx = -passo;
    else if (e.key === 'ArrowRight') dx = passo;
    else if (e.key === 'ArrowUp') dy = -passo;
    else if (e.key === 'ArrowDown') dy = passo;
    else if (e.key === 'Delete') {
      note.splice(selNota, 1);
      selNota = -1;
      render();
      salvaStato();
      return;
    } else presoN = false;
    if (presoN) {
      e.preventDefault();
      if (n.tipo === 'linea') {
        n.x1 += dx; n.y1 += dy;
        n.x2 += dx; n.y2 += dy;
      } else {
        n.x += dx;
        n.y += dy;
      }
      ancoraNota(n);
      render();
      salvaStato();
    }
    return;
  }
  if (selezionato < 0 || selezionato >= blocchi.length) return;
  var b = blocchi[selezionato];
  var preso = true;
  if (e.key === 'ArrowLeft') b.x -= passo;
  else if (e.key === 'ArrowRight') b.x += passo;
  else if (e.key === 'ArrowUp') b.y -= passo;
  else if (e.key === 'ArrowDown') b.y += passo;
  else if (e.key === 'Delete') {
    blocchi.splice(selezionato, 1);
    selezionato = -1;
    ritaglioIdx = -1;   // niente clamp: gli indici sono appena slittati
    render();
    salvaStato();
    return;
  } else {
    preso = false;
  }
  if (preso) {
    e.preventDefault();
    clampBlocco(b);
    render();
    salvaStato();
  }
});

// ---- COMPOSIZIONE ED EXPORT ----

async function componi() {
  sincronizzaNote();   // mai esportare con le toppe fuori posto
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
  // Il ritaglio usa il drawImage a 9 argomenti: dal rettangolo sorgente
  // cx,cy,cw,ch alla posizione in tela.
  blocchi.forEach(function(b, i) {
    ctx.drawImage(imgs[i],
      (b.cx || 0), (b.cy || 0), sorgW(b), sorgH(b),
      Math.round(b.x), Math.round(b.y),
      Math.round(larghezza(b)), Math.round(altezza(b)));
  });
  // Annotazioni SOPRA i pezzi, nell'ordine in cui sono state fatte.
  note.forEach(function(n, jn) {
    if (n.tipo === 'oscura' && n.stile === 'blur') {
      // Sfocatura VERA sui pixel finali: si preleva la regione già composta,
      // la si sfoca e la si rimette al suo posto ritagliata. Il margine extra
      // evita che i bordi risucchino il trasparente fuori dalla tela.
      var bx = Math.round(n.x), by = Math.round(n.y);
      var bw = Math.round(n.w), bh = Math.round(n.h);
      if (bw <= 0 || bh <= 0) return;
      var r = raggioSfoca(n);
      var pad = Math.ceil(r * 2);
      var sx = Math.max(0, bx - pad), sy = Math.max(0, by - pad);
      var sw = Math.min(W - sx, bw + pad * 2), sh = Math.min(H - sy, bh + pad * 2);
      if (sw <= 0 || sh <= 0) return;
      var tmp = document.createElement('canvas');
      tmp.width = sw;
      tmp.height = sh;
      tmp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.clip();
      ctx.filter = 'blur(' + r + 'px)';
      ctx.drawImage(tmp, sx, sy);
      ctx.filter = 'none';
      ctx.restore();
    } else if (n.tipo === 'oscura') {
      ctx.fillStyle = n.colore;
      ctx.fillRect(Math.round(n.x), Math.round(n.y), Math.round(n.w), Math.round(n.h));
    } else if (n.tipo === 'evidenzia') {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = n.colore;
      ctx.fillRect(Math.round(n.x), Math.round(n.y), Math.round(n.w), Math.round(n.h));
      ctx.globalAlpha = 1;
    } else if (n.tipo === 'forma') {
      // Stesso percorso mostrato a schermo, ridisegnato sul canvas: una sola
      // definizione, così anteprima ed export non possono divergere.
      var f = formaDaId(n.forma);
      if (!n.w || !n.h) return;
      var p2 = new Path2D(f.d);
      ctx.save();
      ctx.translate(Math.round(n.x), Math.round(n.y));
      ctx.scale(n.w / 100, n.h / 100);
      if (n.riempito && !f.soloTratto) {
        ctx.fillStyle = n.colore;
        ctx.fill(p2, 'evenodd');
      } else {
        // La scala è diversa sui due assi: si compensa lo spessore, altrimenti
        // un contorno su una forma schiacciata verrebbe ovale.
        var sc = ((Math.abs(n.w) + Math.abs(n.h)) / 200) || 1;
        ctx.strokeStyle = n.colore;
        ctx.lineWidth = n.spessore / sc;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke(p2);
      }
      ctx.restore();
    } else if (n.tipo === 'lente') {
      var s = lenteSorgente(n);
      if (!s) return;
      var bi = blocchi.indexOf(s.b);
      if (bi < 0) return;
      ctx.save();
      ctx.strokeStyle = n.colore;
      // Prima le linee di richiamo e il contorno della regione: il riquadro
      // ingrandito ci va sopra e ne copre i capi.
      ctx.lineWidth = 2;
      lenteRichiami(s, n).forEach(function(L) {
        ctx.beginPath();
        ctx.moveTo(L[0], L[1]);
        ctx.lineTo(L[2], L[3]);
        ctx.stroke();
      });
      ctx.strokeRect(s.x + 1, s.y + 1, Math.max(1, s.w - 2), Math.max(1, s.h - 2));
      ctx.save();
      ctx.beginPath();
      ctx.rect(n.x, n.y, n.w, n.h);
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.drawImage(imgs[bi], n.src.x, n.src.y, n.src.w, n.src.h, n.x, n.y, n.w, n.h);
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeRect(n.x + 1.5, n.y + 1.5, Math.max(1, n.w - 3), Math.max(1, n.h - 3));
      ctx.restore();
    } else if (n.tipo === 'contatore') {
      var lato = Math.max(n.w, n.h);
      var rc = lato / 2;
      var ccx = n.x + rc, ccy = n.y + rc;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ccx, ccy, rc, 0, Math.PI * 2);
      ctx.fillStyle = n.colore;
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 ' + Math.round(lato * 0.56) + "px 'Segoe UI', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(numeroContatore(jn)), ccx, ccy + lato * 0.02);
      ctx.restore();
    } else if (n.tipo === 'linea') {
      ctx.strokeStyle = n.colore;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(n.x1, n.y1);
      ctx.lineTo(n.x2, n.y2);
      ctx.stroke();
    } else if (n.tipo === 'testo' && n.testo) {
      ctx.fillStyle = n.colore;
      ctx.font = '600 ' + n.fs + "px 'Segoe UI', sans-serif";
      ctx.textBaseline = 'top';
      var righe = spezzaTesto(ctx, n.testo, n.w);
      righe.forEach(function(r, ri) {
        ctx.fillText(r, Math.round(n.x), Math.round(n.y + ri * n.fs * 1.3));
      });
    }
  });
  return applicaSfondo(canvas);
}

// A capo del testo: rispetta i newline manuali e spezza le righe troppo
// lunghe per la larghezza della casella (stessa resa del div in tela).
function spezzaTesto(ctx, testo, maxW) {
  var out = [];
  testo.split('\n').forEach(function(riga) {
    var parole = riga.split(' ');
    var cur = '';
    parole.forEach(function(p) {
      var prova = cur ? cur + ' ' + p : p;
      if (ctx.measureText(prova).width > maxW && cur) {
        out.push(cur);
        cur = p;
      } else {
        cur = prova;
      }
    });
    out.push(cur);
  });
  return out;
}

// PDF senza librerie: una pagina con la JPEG del collage incapsulata
// (struttura PDF minima scritta a mano — coerente con zero dipendenze).
function creaPdf(jpegDataUrl, wPx, hPx) {
  var bin = atob(jpegDataUrl.split(',')[1]);
  var wPt = wPx * 72 / 96, hPt = hPx * 72 / 96;
  // Le pagine PDF hanno un tetto di 14400pt per lato: si scala la CARTA,
  // l'immagine dentro resta a risoluzione piena.
  var sc = Math.min(1, 14400 / wPt, 14400 / hPt);
  wPt = +(wPt * sc).toFixed(2);
  hPt = +(hPt * sc).toFixed(2);
  var testa = '%PDF-1.4\n';
  var corpo = '';
  var offset = [];
  function oggetto(num, contenuto) {
    offset[num] = testa.length + corpo.length;
    corpo += num + ' 0 obj\n' + contenuto + '\nendobj\n';
  }
  oggetto(1, '<< /Type /Catalog /Pages 2 0 R >>');
  oggetto(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  oggetto(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + wPt + ' ' + hPt + '] ' +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  oggetto(4, '<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bin.length +
    ' >>\nstream\n' + bin + '\nendstream');
  var flusso = 'q ' + wPt + ' 0 0 ' + hPt + ' 0 0 cm /Im0 Do Q';
  oggetto(5, '<< /Length ' + flusso.length + ' >>\nstream\n' + flusso + '\nendstream');
  var posXref = testa.length + corpo.length;
  var xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (var n = 1; n <= 5; n++) {
    xref += String(offset[n]).padStart(10, '0') + ' 00000 n \n';
  }
  var tutto = testa + corpo + xref +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + posXref + '\n%%EOF';
  var bytes = new Uint8Array(tutto.length);
  for (var i = 0; i < tutto.length; i++) bytes[i] = tutto.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

async function salva() {
  if (!blocchi.length) return;
  chiudiRitaglio();
  var canvas = await componi();
  if (!canvas) return;
  var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  var fmt = $('formato') ? $('formato').value : 'png';
  var url, ext;
  if (fmt === 'jpeg') {
    url = canvas.toDataURL('image/jpeg', 0.92);
    ext = 'jpg';
  } else if (fmt === 'webp') {
    // WEBP: stessa resa del PNG a una frazione del peso. Se il browser non
    // lo producesse, toDataURL ricade da solo sul PNG: in quel caso si
    // salva col nome giusto invece di spacciare un PNG per webp.
    url = canvas.toDataURL('image/webp', 0.92);
    ext = (url.indexOf('data:image/webp') === 0) ? 'webp' : 'png';
  } else if (fmt === 'pdf') {
    url = URL.createObjectURL(creaPdf(canvas.toDataURL('image/jpeg', 0.92), canvas.width, canvas.height));
    ext = 'pdf';
  } else {
    url = canvas.toDataURL('image/png');
    ext = 'png';
  }
  chrome.downloads.download({
    url: url,
    filename: 'screenshots/multisnip_' + ts + '.' + ext,
    saveAs: false
  });
  // Copia negli appunti SEMPRE in PNG (è il formato che gli appunti
  // capiscono): Ctrl+V in mail/Word/chat funziona con qualsiasi formato.
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
// "Fit canvas" fa avanti-indietro: la seconda pressione rimette la tela
// esattamente com'era, così si può provare l'adattamento senza perdere la
// disposizione di prima.
$('btnFit').addEventListener('click', function() {
  if (statoPreFit) {
    var s = statoPreFit;
    statoPreFit = null;
    ripristina(s);
    salvaStato();
    $('btnFit').classList.remove('attivo');
    return;
  }
  statoPreFit = istantanea();
  adattaTela();
  salvaStato();
  $('btnFit').classList.add('attivo');
});
// Strumenti di annotazione: un click arma e lo strumento RESTA armato
// finché non si torna alla manina (bottone Move o Esc).
$('btnMano').addEventListener('click', function() { armaStrumento(strumento); });
$('btnOscura').addEventListener('click', function() { armaStrumento('oscura'); });
$('btnEvidenzia').addEventListener('click', function() { armaStrumento('evidenzia'); });
$('btnLinea').addEventListener('click', function() { armaStrumento('linea'); });
$('btnTesto').addEventListener('click', function() { armaStrumento('testo'); });
$('btnContatore').addEventListener('click', function() { armaStrumento('contatore'); });
$('btnLente').addEventListener('click', function() { armaStrumento('lente'); });
$('btnUndo').addEventListener('click', annulla);
$('btnRedo').addEventListener('click', rifai);

// ---- PANNELLINO DELLE FORME ----
// Si apre sotto il bottone, si prende una forma, e da lì lo strumento resta
// armato: se ne disegnano quante se ne vuole senza tornare al pannello.
function costruisciGrigliaForme() {
  var g = $('formeGriglia');
  if (!g || g.childNodes.length) return;
  FORME.forEach(function(f) {
    var b = document.createElement('button');
    b.className = 'forma-cella';
    b.title = f.nome;
    b.setAttribute('data-forma', f.id);
    b.innerHTML = '<svg width="24" height="24" viewBox="0 0 100 100" style="pointer-events:none">' +
      '<path d="' + f.d + '" fill-rule="evenodd" ' +
      'fill="' + (f.soloTratto ? 'none' : 'currentColor') + '" ' +
      'stroke="currentColor" stroke-width="' + (f.soloTratto ? 9 : 0) + '" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    b.addEventListener('click', function() {
      formaScelta = f.id;
      chiudiPannelloForme();
      strumento = 'forma';
      selezionato = -1;
      selNota = -1;
      chiudiRitaglio();
      aggiornaBarraStrumenti();
      render();
    });
    g.appendChild(b);
  });
}

function apriPannelloForme() {
  costruisciGrigliaForme();
  var g = $('formeGriglia');
  Array.prototype.forEach.call(g.children, function(c) {
    c.classList.toggle('scelta', c.getAttribute('data-forma') === formaScelta);
  });
  var p = $('formePanel'), b = $('btnForme');
  p.classList.add('aperto');
  var r = b.getBoundingClientRect();
  var w = p.offsetWidth;
  p.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)) + 'px';
  p.style.top = (r.bottom + 8) + 'px';
}

function chiudiPannelloForme() {
  var p = $('formePanel');
  if (p) p.classList.remove('aperto');
}

$('btnForme').addEventListener('click', function(e) {
  e.stopPropagation();
  var p = $('formePanel');
  if (p.classList.contains('aperto')) { chiudiPannelloForme(); return; }
  apriPannelloForme();
});

// Click fuori: il pannellino si chiude, come qualunque menu a tendina.
document.addEventListener('mousedown', function(e) {
  var p = $('formePanel');
  if (!p || !p.classList.contains('aperto')) return;
  if (p.contains(e.target) || $('btnForme').contains(e.target)) return;
  chiudiPannelloForme();
});

// ---- PANNELLO DELLO SFONDO ----
function costruisciGrigliaSfondi() {
  var g = $('sfGriglia');
  if (!g || g.childNodes.length) return;
  SFONDI.forEach(function(p) {
    var b = document.createElement('button');
    b.className = 'sf-tinta';
    b.title = p.id;
    b.setAttribute('data-sfondo', p.id);
    b.addEventListener('click', function() {
      sfondo.preset = p.id;
      aggiornaPannelloSfondo();
      render();
      salvaStato();
    });
    g.appendChild(b);
  });
}

function aggiornaPannelloSfondo() {
  if (!$('sfAttivo')) return;
  costruisciGrigliaSfondi();
  $('sfAttivo').checked = sfondo.attivo;
  $('sfCorpo').classList.toggle('acceso', sfondo.attivo);
  $('btnSfondo').classList.toggle('attivo', sfondo.attivo);
  Array.prototype.forEach.call($('sfGriglia').children, function(c) {
    var id = c.getAttribute('data-sfondo'), p = null;
    for (var i = 0; i < SFONDI.length; i++) if (SFONDI[i].id === id) p = SFONDI[i];
    c.style.background = sfondoCss(p, sfondo.tinta);
    c.classList.toggle('scelta', id === sfondo.preset);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.sf-modo'), function(b) {
    b.classList.toggle('attivo', b.getAttribute('data-tinta') === sfondo.tinta);
  });
  [['sfMargine', 'margine'], ['sfOmbra', 'ombra'],
   ['sfREsterno', 'raggioEsterno'], ['sfRInterno', 'raggioInterno']].forEach(function(v) {
    $(v[0]).value = sfondo[v[1]];
    $(v[0] + 'V').textContent = sfondo[v[1]];
  });
  $('sfProporzioni').value = sfondo.proporzioni;
  $('sfFiligrana').value = sfondo.filigrana;
}

$('btnSfondo').addEventListener('click', function(e) {
  e.stopPropagation();
  var p = $('sfondoPanel');
  if (p.classList.contains('aperto')) { p.classList.remove('aperto'); return; }
  aggiornaPannelloSfondo();
  p.classList.add('aperto');
  var r = $('btnSfondo').getBoundingClientRect();
  p.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - p.offsetWidth - 8)) + 'px';
  p.style.top = (r.bottom + 8) + 'px';
});

document.addEventListener('mousedown', function(e) {
  var p = $('sfondoPanel');
  if (!p || !p.classList.contains('aperto')) return;
  if (p.contains(e.target) || $('btnSfondo').contains(e.target)) return;
  p.classList.remove('aperto');
});

$('sfAttivo').addEventListener('change', function() {
  sfondo.attivo = this.checked;
  aggiornaPannelloSfondo();
  render();
  salvaStato();
});

Array.prototype.forEach.call(document.querySelectorAll('.sf-modo'), function(b) {
  b.addEventListener('click', function() {
    sfondo.tinta = this.getAttribute('data-tinta');
    aggiornaPannelloSfondo();
    render();
    salvaStato();
  });
});

// I cursori aggiornano dal vivo mentre li trascini; nella cronologia entra
// solo il valore finale, altrimenti un trascinamento riempirebbe l'undo.
[['sfMargine', 'margine'], ['sfOmbra', 'ombra'],
 ['sfREsterno', 'raggioEsterno'], ['sfRInterno', 'raggioInterno']].forEach(function(v) {
  $(v[0]).addEventListener('input', function() {
    sfondo[v[1]] = parseInt(this.value, 10) || 0;
    $(v[0] + 'V').textContent = sfondo[v[1]];
    render();
  });
  $(v[0]).addEventListener('change', salvaStato);
});

$('sfProporzioni').addEventListener('change', function() {
  sfondo.proporzioni = this.value;
  render();
  salvaStato();
});
$('sfFiligrana').addEventListener('input', function() { sfondo.filigrana = this.value; });
$('sfFiligrana').addEventListener('change', salvaStato);

// ---- ZOOM DELL'AREA DI LAVORO ----
// Il "100%" al centro è anche un bottone: riporta all'adatta-alla-finestra.
function zoomVerso(su) {
  var attuale = (zoomUtente != null) ? zoomUtente : Math.min(1, stageW() / canvasW);
  var z = null;
  if (su) {
    for (var i = 0; i < ZOOM_PASSI.length; i++) {
      if (ZOOM_PASSI[i] > attuale + 0.001) { z = ZOOM_PASSI[i]; break; }
    }
    if (z == null) z = ZOOM_PASSI[ZOOM_PASSI.length - 1];
  } else {
    for (var k = ZOOM_PASSI.length - 1; k >= 0; k--) {
      if (ZOOM_PASSI[k] < attuale - 0.001) { z = ZOOM_PASSI[k]; break; }
    }
    if (z == null) z = ZOOM_PASSI[0];
  }
  zoomUtente = z;
  render();
}

$('zoomPiu').addEventListener('click', function() { zoomVerso(true); });
$('zoomMeno').addEventListener('click', function() { zoomVerso(false); });
$('zoom100').addEventListener('click', function() { zoomUtente = 1; render(); });
$('zoomFit').addEventListener('click', function() { zoomUtente = null; render(); });

// Ctrl + rotellina: lo zoom come in qualunque programma di disegno.
document.addEventListener('wheel', function(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  if (!blocchi.length) return;
  e.preventDefault();
  zoomVerso(e.deltaY < 0);
}, { passive: false });
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

// Copia senza salvare: si manda il lavoro in corso su una chat o dentro un
// documento con Ctrl+V, senza lasciare un file nei Download che poi nessuno
// cancella. Stessa composizione del Save, solo che finisce negli appunti.
$('btnCopia').addEventListener('click', async function() {
  if (!blocchi.length) return;
  var bt = $('btnCopia');
  var prima = bt.innerHTML;
  var canvas = await componi();
  if (!canvas) return;
  try {
    var blob = await new Promise(function(res) { canvas.toBlob(res, 'image/png'); });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    bt.innerHTML = '✓ Copied — paste with Ctrl+V';
    bt.classList.add('attivo');
  } catch (e) {
    console.warn('Copia negli appunti fallita:', e);
    bt.innerHTML = '✗ Copy failed';
  }
  setTimeout(function() {
    bt.innerHTML = prima;
    bt.classList.remove('attivo');
  }, 1800);
});

window.addEventListener('resize', function() { render(); });

importaNuoviPezzi();
