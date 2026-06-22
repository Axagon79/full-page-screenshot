var water = document.getElementById('water');
var pct = document.getElementById('pct');
var text = document.getElementById('text');
var waterbody = document.getElementById('waterbody');

// Ascolta aggiornamenti dal service worker
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.type === 'progress') {
    water.style.height = Math.min(msg.percent, 100) + '%';
    pct.textContent = Math.round(msg.percent) + '%';
    text.textContent = msg.text;
    if (msg.percent > 50) {
      pct.style.color = 'white';
      pct.style.textShadow = '0 1px 3px rgba(0,0,0,0.3)';
    } else {
      pct.style.color = '#1e3a5f';
      pct.style.textShadow = '0 1px 2px rgba(255,255,255,0.5)';
    }
  } else if (msg.type === 'success') {
    pct.textContent = '\u2713';
    text.textContent = 'Screenshot salvato!';
    document.body.classList.add('success');
    setTimeout(function() { window.close(); }, 1500);
  } else if (msg.type === 'error') {
    pct.textContent = '\u2717';
    text.textContent = msg.message || 'Errore';
    document.body.classList.add('error');
    setTimeout(function() { window.close(); }, 3000);
  }
});

// Appena il popup si apre, chiedi al service worker di iniziare la cattura
chrome.storage.local.get('captureMode', function(data) {
  var mode = data.captureMode || 'full';
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      if (mode === 'area') {
        // Mostra messaggio e chiudi
        pct.textContent = '\u2702';
        pct.style.fontSize = '28px';
        text.textContent = 'Seleziona l\'area';
        chrome.runtime.sendMessage({
          action: 'startCapture',
          tabId: tabs[0].id,
          mode: mode
        });
        setTimeout(function() { window.close(); }, 800);
      } else if (mode === 'visible') {
        pct.textContent = '\u{1F4F7}';
        pct.style.fontSize = '28px';
        text.textContent = 'Cattura...';
        chrome.runtime.sendMessage({
          action: 'startCapture',
          tabId: tabs[0].id,
          mode: mode
        });
        setTimeout(function() { window.close(); }, 600);
      } else {
        chrome.runtime.sendMessage({
          action: 'startCapture',
          tabId: tabs[0].id,
          mode: mode
        });
      }
    }
  });
});
