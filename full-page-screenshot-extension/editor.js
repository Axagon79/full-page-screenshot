// Editor Multi Snip. I pezzi arrivano dal service worker via
// chrome.storage.session ({ multi: { pieces: [{img, tipo}] } }): qui ogni
// pezzo diventa un BLOCCO riordinabile (su/giù), affiancabile al precedente
// e ridimensionabile. Al salvataggio si compone tutto su un canvas — pezzi
// mai riscalati d'ufficio, centrati su sfondo neutro — e si scarica + copia.

var blocchi = [];   // { img, natW, natH, scale, join }
var caricati = 0;   // quanti pezzi della sessione sono già stati importati

var STAGE_W = 960;  // larghezza massima di visualizzazione (non di export)
var GAP = 14;       // spazio tra i pezzi, sia a schermo che nell'export

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
      blocchi.push({ img: p.img, natW: im.naturalWidth, natH: im.naturalHeight, scale: 1, join: false });
    } catch (e) {
      console.warn('Pezzo illeggibile, saltato:', e);
    }
  }
  caricati = Math.max(caricati, m.pieces.length);
  render();
}

// Un nuovo pezzo aggiunto mentre l'editor è aperto arriva da qui.
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'session' && changes.multi) importaNuoviPezzi();
});

// ---- RENDER ----

// Raggruppa i blocchi in righe: un blocco con join=true si accoda alla riga
// del precedente (il primo blocco non può avere join).
function righeDaBlocchi() {
  var righe = [];
  blocchi.forEach(function(b, i) {
    if (i > 0 && b.join && righe.length) {
      righe[righe.length - 1].push(i);
    } else {
      righe.push([i]);
    }
  });
  return righe;
}

function render() {
  var palco = $('palco');
  palco.innerHTML = '';
  $('contatore').textContent = blocchi.length + (blocchi.length === 1 ? ' piece' : ' pieces');
  if (!blocchi.length) {
    palco.innerHTML = '<div id="vuoto">No pieces yet.<br>' +
      'Use <b>+ Area</b>, <b>+ Screen</b> or <b>+ Full page</b> to capture from the page.</div>';
    return;
  }
  righeDaBlocchi().forEach(function(riga) {
    var rowEl = document.createElement('div');
    rowEl.className = 'riga';
    // La riga si mostra rimpicciolita se non entra nel palco: è solo
    // visualizzazione, l'export usa sempre i pixel veri.
    var natRow = GAP * (riga.length - 1);
    riga.forEach(function(idx) { natRow += blocchi[idx].natW * blocchi[idx].scale; });
    var dispK = Math.min(1, STAGE_W / natRow);
    riga.forEach(function(idx) { rowEl.appendChild(creaBlocco(idx, dispK)); });
    palco.appendChild(rowEl);
  });
}

function bottone(txt, titolo, fn) {
  var b = document.createElement('button');
  b.textContent = txt;
  b.title = titolo;
  b.addEventListener('click', fn);
  return b;
}

function muovi(idx, dir) {
  var j = idx + dir;
  if (j < 0 || j >= blocchi.length) return;
  var t = blocchi[idx];
  blocchi[idx] = blocchi[j];
  blocchi[j] = t;
  blocchi[0].join = false;
  render();
}

function creaBlocco(idx, dispK) {
  var b = blocchi[idx];
  var wrap = document.createElement('div');
  wrap.className = 'blocco';

  var im = document.createElement('img');
  im.src = b.img;
  im.style.width = Math.max(40, Math.round(b.natW * b.scale * dispK)) + 'px';
  wrap.appendChild(im);

  var ctr = document.createElement('div');
  ctr.className = 'controlli';
  ctr.appendChild(bottone('↑', 'Move up', function() { muovi(idx, -1); }));
  ctr.appendChild(bottone('↓', 'Move down', function() { muovi(idx, +1); }));
  var bJoin = bottone('⇄', 'Side by side with previous', function() {
    b.join = !b.join;
    render();
  });
  if (idx === 0) {
    bJoin.disabled = true;
    bJoin.style.opacity = '0.35';
  } else if (b.join) {
    bJoin.className = 'attivo';
  }
  ctr.appendChild(bJoin);
  ctr.appendChild(bottone('\u{1F5D1}', 'Remove', function() {
    blocchi.splice(idx, 1);
    if (blocchi.length) blocchi[0].join = false;
    render();
  }));
  wrap.appendChild(ctr);

  var lab = document.createElement('div');
  lab.className = 'scala';
  lab.textContent = Math.round(b.scale * 100) + '%';
  wrap.appendChild(lab);

  // Maniglia d'angolo: trascina per ridimensionare il pezzo (0.2x - 3x).
  var man = document.createElement('div');
  man.className = 'maniglia';
  man.addEventListener('mousedown', function(e) {
    e.preventDefault();
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
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  wrap.appendChild(man);

  return wrap;
}

// ---- COMPOSIZIONE ED EXPORT ----

async function componi() {
  var righe = righeDaBlocchi();
  var imgs = await Promise.all(blocchi.map(function(b) { return caricaImmagine(b.img); }));
  var MARGINE = 24;
  var righeMisurate = righe.map(function(riga) {
    var w = GAP * (riga.length - 1), h = 0;
    riga.forEach(function(idx) {
      var b = blocchi[idx];
      w += Math.round(b.natW * b.scale);
      h = Math.max(h, Math.round(b.natH * b.scale));
    });
    return { riga: riga, w: w, h: h };
  });
  var W = Math.max.apply(null, righeMisurate.map(function(r) { return r.w; })) + MARGINE * 2;
  var H = righeMisurate.reduce(function(s, r) { return s + r.h; }, 0)
        + GAP * (righeMisurate.length - 1) + MARGINE * 2;
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
  var y = MARGINE;
  righeMisurate.forEach(function(r) {
    var x = Math.round((W - r.w) / 2);   // riga centrata in orizzontale
    r.riga.forEach(function(idx) {
      var b = blocchi[idx];
      var w = Math.round(b.natW * b.scale);
      var h = Math.round(b.natH * b.scale);
      ctx.drawImage(imgs[idx], x, y + Math.round((r.h - h) / 2), w, h);
      x += w + GAP;
    });
    y += r.h + GAP;
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
  // Copia negli appunti: la pagina dell'editor ha il focus (click su Save),
  // quindi ClipboardItem funziona direttamente.
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

$('btnArea').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'multiAdd', kind: 'area' }).catch(function() {});
});
$('btnSchermo').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'multiAdd', kind: 'visible' }).catch(function() {});
});
$('btnPagina').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'multiAdd', kind: 'full' }).catch(function() {});
});
$('btnAnnulla').addEventListener('click', function() {
  chrome.runtime.sendMessage({ action: 'multiDone' }).catch(function() {});
  window.close();
});
$('btnSalva').addEventListener('click', salva);

importaNuoviPezzi();
