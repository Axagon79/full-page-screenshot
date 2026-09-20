var events = [];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  events.push(message.action);
  if (message.action === 'opened') {
    chrome.action.setPopup({ popup: '' }).then(() => respond({ ready: true }));
    return true;
  }
});
chrome.runtime.onConnect.addListener(port => {
  events.push('connected');
  port.onDisconnect.addListener(() => events.push('disconnected'));
});
chrome.action.onClicked.addListener(() => events.push('actionClicked'));
