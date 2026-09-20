'use strict';

var expectedJob = null;
var expectedTab = null;
var percent = document.getElementById('percent');
var label = document.getElementById('label');
var bar = document.getElementById('bar');

function updateProgress(value, text) {
  var n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  percent.textContent = n + '%';
  bar.style.width = n + '%';
  if (text) label.textContent = text;
}

chrome.runtime.onMessage.addListener(function(message) {
  if (expectedTab === null || (message.tabId !== undefined && message.tabId !== expectedTab)) return;
  if (message.type === 'progress') updateProgress(message.percent, message.text);
  else if (message.type === 'success') updateProgress(100, 'Complete');
  else if (message.type === 'error') label.textContent = message.message || 'Capture failed';
});

function checkCapture() {
  chrome.runtime.sendMessage({ action: 'getCaptureState' }, function(state) {
    if (chrome.runtime.lastError || !state || !state.active) {
      expectedJob = null;
      expectedTab = null;
      label.textContent = 'Ready';
      return;
    }
    expectedJob = state.jobId;
    expectedTab = state.tabId;
    updateProgress(state.percent, state.text);
  });
}

checkCapture();
setInterval(checkCapture, 500);
