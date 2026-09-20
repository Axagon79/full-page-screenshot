'use strict';
// Isolated native extension experiment. No production files or user profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(url) {
  const ws = new WebSocket(url), pending = new Map(); let n = 0;
  await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no; });
  ws.onmessage = e => { const m = JSON.parse(e.data), p = pending.get(m.id); if(p) { pending.delete(m.id); m.error ? p.no(m.error) : p.yes(m.result); } };
  return { ws, call(method, params={}) { return new Promise((yes,no) => { const id=++n; pending.set(id,{yes,no}); ws.send(JSON.stringify({id,method,params})); }); } };
}
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shot-native-popup-'));
  const extension=path.resolve('tools/fixtures/popup-behavior');
  const browser=spawn('C:/Users/lollo/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe',[
    '--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
    '--user-data-dir='+profile,'--disable-extensions-except='+extension,'--load-extension='+extension,'about:blank'
  ],{windowsHide:true,stdio:'ignore'});
  const sockets=[];
  try {
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(portFile);i++) await wait(100);
    const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
    const targets=async()=>await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    let list;
    for(let i=0;i<60;i++){list=await targets();if(list.some(t=>t.type==='service_worker' && t.url.endsWith('/worker.js')))break;await wait(100);}
    const worker=list.find(t=>t.type==='service_worker' && t.url.endsWith('/worker.js'));
    if(!worker)throw Error('Test extension did not load: '+JSON.stringify(list.map(t=>({type:t.type,url:t.url}))));
    const w=await connect(worker.webSocketDebuggerUrl);sockets.push(w.ws);
    const p=await connect(list.find(t=>t.type==='page').webSocketDebuggerUrl);sockets.push(p.ws);
    const evaluate=async expression=>{
      const result=await w.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate('chrome.action.openPopup()');
    await wait(500);
    console.log('AFTER OPEN',JSON.stringify({events:await evaluate('events'),targets:(await targets()).map(t=>({type:t.type,url:t.url}))}));
    await p.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Y',code:'KeyY',windowsVirtualKeyCode:89,modifiers:9});
    await p.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Y',code:'KeyY',windowsVirtualKeyCode:89,modifiers:9});
    await wait(500);
    console.log('AFTER SHORTCUT',JSON.stringify({events:await evaluate('events'),targets:(await targets()).map(t=>({type:t.type,url:t.url}))}));
    await w.call('Browser.close');
  } finally {sockets.forEach(s=>s.close());browser.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
