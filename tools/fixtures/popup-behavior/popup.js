var connection = chrome.runtime.connect({ name: 'popup' });
chrome.runtime.sendMessage({ action: 'opened' });
