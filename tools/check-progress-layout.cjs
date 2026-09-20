'use strict';
// Check the actual injected HUD in Edge and exclude it from captured pixels.
// Chrome extension APIs are stubbed; this does not photograph browser chrome.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-panel-layout-'));
  const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--user-data-dir='+profile, 'about:blank'],
    {windowsHide:true, stdio:'ignore'});
  let socket;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i=0; i<100 && !fs.existsSync(portFile); i++) await new Promise(r=>setTimeout(r,100));
    const port = fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
    const targets = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    socket = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej;});
    let id=0; const pending=new Map();
    socket.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
    await cdp('Page.enable');
    const evaluate=async expression=>{
      const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const source=fs.readFileSync('full-page-screenshot-extension/capture-control.js','utf8');
    const helpers=source.slice(source.indexOf('async function installCaptureControl('),source.indexOf('// A suspended/restarted worker'));
    const context=vm.createContext({
      captureHasToolbarStop:job=>job.mode!=='visible',resumeCssAnims:async()=>{},console,
      chrome:{
        action:{setTitle:async()=>{}},
        scripting:{executeScript:async({func,args})=>[{result:await evaluate(`(${func.toString()})(...${JSON.stringify(args)})`)}]}
      }
    });
    vm.runInContext(helpers,context);
    const job={id:'hud-check',tabId:1,mode:'full',phase:'capturing',percent:67};
    context.activeCaptureJob=job;
    const results=[];
    for(const width of [1280,390]) for(const theme of ['light','dark']) {
      await cdp('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});
      await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
      await evaluate(`document.body.innerHTML='<main style="height:3000px;padding:24px;font:20px system-ui">Screenshot test page</main>';document.body.style.cssText='margin:0;background:${theme==='dark'?'#10141c':'#f3f5f7'};color:${theme==='dark'?'white':'black'}';document.title='Match 0-0';`);
      const before=await cdp('Page.captureScreenshot',{format:'png'});
      await context.installCaptureControl(job);
      await context.createCaptureProgress(job);
      await context.updateCaptureProgress(job);
      assert.equal(await evaluate('document.title'),'Match 0-0');
      const layout=await evaluate(`(()=>{const p=window.__shotCaptureControl.progress;return {text:p.percentEl.textContent,rect:p.host.getBoundingClientRect().toJSON(),right:document.documentElement.clientWidth-16,background:getComputedStyle(p.root.querySelector('.panel')).backgroundColor,pointer:getComputedStyle(p.host).pointerEvents}})()`);
      assert.equal(layout.text,'67%');assert.equal(layout.rect.width,124);
      assert.equal(layout.rect.top,16);assert.equal(layout.rect.right,layout.right);
      assert.equal(layout.background,'rgb(255, 255, 255)');assert.equal(layout.pointer,'none');
      const preview=await cdp('Page.captureScreenshot',{format:'png'});
      fs.mkdirSync(path.resolve('tools/artifacts'),{recursive:true});
      fs.writeFileSync(path.resolve(`tools/artifacts/progress-restored-${width}-${theme}.png`),Buffer.from(preview.data,'base64'));
      await context.setCaptureProgressSnapshot(job.tabId,job.id,true);
      // Concurrent progress/magnifier activity must not reveal the HUD early.
      await context.setCaptureProgressSnapshot(job.tabId,job.id,true);
      job.percent=81;
      await context.updateCaptureProgress(job);
      await context.setCaptureProgressSnapshot(job.tabId,job.id,false);
      assert.equal(await evaluate("getComputedStyle(window.__shotCaptureControl.progress.host).display"),'none');
      const during=await cdp('Page.captureScreenshot',{format:'png'});
      assert.equal(during.data,before.data,'The frame must match the original page with no HUD pixels');
      await context.setCaptureProgressSnapshot(job.tabId,job.id,false);
      assert.equal(await evaluate("getComputedStyle(window.__shotCaptureControl.progress.host).display"),'block');
      await evaluate("document.title='Match 1-0'");
      await context.updateCaptureProgress(job);
      assert.equal(await evaluate('document.title'),'Match 1-0');
      assert.equal(await evaluate('window.__shotCaptureControl.progress.percentEl.textContent'),'81%');
      await context.cleanupCaptureJob(job,true);
      assert.equal(await evaluate('document.title'),'Match 1-0');
      assert.equal(await evaluate('window.__shotCaptureControl===undefined'),true);
      job.percent=67;
      results.push({width,theme,whiteHUD:layout.rect,identicalPagePixels:true,titleUntouched:true});
    }
    console.log(JSON.stringify(results));
    await cdp('Browser.close');
  } finally {if(socket)socket.close();browser.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
