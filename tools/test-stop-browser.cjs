// Local real-DOM integration checks. Chrome APIs are adapted through CDP;
// this does not claim to test the actual toolbar or an installed extension.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'full-page-screenshot-extension');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const skipStopIconComparison = process.env.SKIP_STOP_ICON_COMPARISON === '1';

function fixture(custom) {
  document.head.innerHTML = '<style>html{scroll-behavior:auto}body{margin:0;background:#eef1f5;font:16px Arial}header{position:sticky;top:0;height:54px;background:#234;color:white;z-index:3;padding:15px;box-sizing:border-box}aside{position:absolute;left:12px;top:85px;width:165px;height:230px;overflow:auto;border:2px solid #789;background:white}aside>div{height:750px}main{margin:20px 30px 0 210px;background:white}section{height:210px;border-bottom:1px solid #bbc;padding:20px;box-sizing:border-box}section:nth-child(2n){background:#eaf5fb}footer{height:170px;background:#234;color:white}</style>';
  document.body.innerHTML = '<header id="sticky" style="visibility:visible">Capture stop fixture <span id="ticker" style="display:inline-block;transform:translateX(0px)">motion</span></header><aside id="nested"><div>Nested scrolling content</div></aside><main id="main">' + Array.from({length:22},(_,i)=>'<section>Complete content block '+(i+1)+'</section>').join('') + '</main><footer>End of fixture</footer>';
  if (custom) {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';
    document.getElementById('main').style.cssText = 'position:absolute;top:74px;left:210px;right:30px;height:650px;overflow:auto;margin:0';
    document.querySelector('footer').style.display = 'none';
    document.getElementById('main').scrollTop = 137;
  } else window.scrollTo(0, 231);
  document.getElementById('nested').scrollTop = 91;
  let tick = 0;
  setInterval(() => {
    const el = document.getElementById('ticker');
    if (el) el.style.transform = 'translateX(' + (++tick % 60) + 'px)';
  }, 30);
}

function stateSnapshot() {
  return {
    y: window.scrollY,
    nested: document.getElementById('nested').scrollTop,
    main: document.getElementById('main').scrollTop,
    sticky: document.getElementById('sticky').style.visibility,
    overlay: !!document.getElementById('__screenshot_area_overlay'),
    noselect: !!document.getElementById('__screenshot_noselect'),
    control: !!window.__shotCaptureControl,
    markers: document.querySelectorAll('[data-screenshot-scroll],[data-screenshot-pane],[data-screenshot-area-scroll],[data-screenshot-area-pane],[data-screenshot-start-sticky]').length,
    widget: !!document.getElementById('__shot_multi_widget'),
    progress: !!document.getElementById('__shot_capture_progress')
  };
}

function progressSnapshot() {
  const host = document.getElementById('__shot_capture_progress');
  if (!host) return {exists:false,visible:false};
  const style = getComputedStyle(host);
  const rect = host.getBoundingClientRect();
  const progress = window.__shotCaptureControl && window.__shotCaptureControl.progress;
  const root = host.shadowRoot || (progress && progress.root) || host;
  const panel = root.querySelector('.panel');
  const button = progress && progress.stopButton;
  const buttonRect = button && button.getBoundingClientRect();
  const hit = buttonRect && root.elementFromPoint(buttonRect.x+buttonRect.width/2,buttonRect.y+buttonRect.height/2);
  return {
    exists:true,
    visible:style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0,
    text:(root.textContent || '').replace(/\s+/g,' ').trim(),
    rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
    position:style.position,
    pointerEvents:style.pointerEvents,
    panelBackground:panel?getComputedStyle(panel).backgroundColor:null,
    button:button?{
      text:button.textContent,
      disabled:button.disabled,
      pointerEvents:getComputedStyle(button).pointerEvents,
      background:getComputedStyle(button).backgroundColor,
      rect:{x:buttonRect.x,y:buttonRect.y,width:buttonRect.width,height:buttonRect.height},
      hit:!!hit && (hit===button || button.contains(hit)) && document.elementFromPoint(buttonRect.x+buttonRect.width/2,buttonRect.y+buttonRect.height/2)===host,
      focused:root.activeElement===button
    }:null,
    viewport:{width:innerWidth,height:innerHeight},
    pageWidth:document.documentElement.scrollWidth
  };
}

async function comparePixels(actual, reference) {
  async function load(url) {
    const image = new Image();
    await new Promise((resolve,reject) => {image.onload=resolve;image.onerror=reject;image.src=url;});
    const canvas = document.createElement('canvas');
    canvas.width=image.width; canvas.height=image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0);
    return {width:image.width,height:image.height,data:context.getImageData(0,0,image.width,image.height).data};
  }
  const [a,b]=await Promise.all([load(actual),load(reference)]);
  let changed=0;
  if(a.width !== b.width || a.height !== b.height) return {sameSize:false};
  for(let i=0;i<a.data.length;i+=4) {
    if(a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2] || a.data[i+3] !== b.data[i+3]) changed++;
  }
  return {sameSize:true,changed};
}

// This runs inside the real browser. Its returned pixels are then reused by
// the VM API adapter: no mock canvas is presented as an actual icon rendering.
async function renderStopIconComparison(helperSource, actionSource, asset) {
  let setIconArgs, assetRequests=0;
  const browserChrome={
    runtime:{getURL(file){if(file!=='stop_94.png') throw new Error('Unexpected icon source: '+file);assetRequests++;return asset;}},
    action:{setPopup:async()=>{},setIcon:async args=>{setIconArgs=args;},setTitle:async()=>{},setBadgeText:async()=>{}}
  };
  const production=new Function('chrome','helperSource','actionSource',
    'let stopIconImageDataPromise=null;'+
    'const getStopIconImageData=eval("("+helperSource+")");'+
    'const setCaptureAction=eval("("+actionSource+")");'+
    'return {getStopIconImageData,setCaptureAction};')(browserChrome,helperSource,actionSource);
  await production.setCaptureAction(false);
  if(!setIconArgs || !setIconArgs.imageData || setIconArgs.path) throw new Error('Actual Stop renderer fell back to the original PNG');
  const rendered=setIconArgs.imageData;
  await production.setCaptureAction(false);
  if(setIconArgs.imageData!==rendered || assetRequests!==1) throw new Error('Stop icon cache was not reused');
  const bitmap=await createImageBitmap(await (await fetch(asset)).blob());
  const source=new OffscreenCanvas(bitmap.width,bitmap.height);
  const sourceContext=source.getContext('2d',{willReadFrequently:true});sourceContext.drawImage(bitmap,0,0);
  const sourcePixels=sourceContext.getImageData(0,0,bitmap.width,bitmap.height);
  function bounds(image) {
    let left=image.width,top=image.height,right=-1,bottom=-1;
    for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
      if(image.data[(y*image.width+x)*4+3]>0) {left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    }
    return {x:left,y:top,width:right-left+1,height:bottom-top+1};
  }
  const sourceBounds=bounds(sourcePixels);
  const scaleX=bitmap.width/sourceBounds.width,scaleY=bitmap.height/sourceBounds.height;
  if(Math.abs(scaleX-scaleY)>1e-9) throw new Error('The original icon requires unequal horizontal/vertical scale');
  if(scaleX<1.23 || scaleX>1.24) throw new Error('Unexpected source enlargement: '+scaleX);
  const results=[],serialized={},images={};
  for(const size of [16,20,24,32,48]) {
    const data=rendered[size];
    if(!(data instanceof ImageData) || data.width!==size || data.height!==size) throw new Error('Real ImageData missing for '+size);
    const current=new OffscreenCanvas(size,size);current.getContext('2d').putImageData(data,0,0);
    const previous=new OffscreenCanvas(size,size);previous.getContext('2d').drawImage(bitmap,0,0,size,size);
    const previousBounds=bounds(previous.getContext('2d').getImageData(0,0,size,size));
    const currentBounds=bounds(data);
    if(currentBounds.width<=previousBounds.width || currentBounds.height<=previousBounds.height) throw new Error('Visible Stop sign did not grow at '+size+' px');
    if(currentBounds.width!==currentBounds.height) throw new Error('Stop proportions changed at '+size+' px');
    const expected=new OffscreenCanvas(size,size),expectedContext=expected.getContext('2d');
    expectedContext.imageSmoothingEnabled=true;expectedContext.imageSmoothingQuality='high';
    // Keep the fractional transform exact: 76 * (48 / 76) is just below 48,
    // and Chromium can filter those edges differently from integer snapping.
    const uniformScale=size/sourceBounds.width;
    const extent=sourceBounds.width*uniformScale,inset=(size-extent)/2;
    expectedContext.drawImage(bitmap,sourceBounds.x,sourceBounds.y,sourceBounds.width,sourceBounds.height,inset,inset,extent,extent);
    const expectedData=expectedContext.getImageData(0,0,size,size).data;
    let changed=0;
    for(let i=0;i<data.data.length;i++) if(data.data[i]!==expectedData[i]) changed++;
    if(changed) throw new Error('Icon differs from a uniform crop/scale of its original lettering at '+size+' px: '+changed+' channels');
    results.push({size,previousBounds,currentBounds,referenceChangedChannels:changed});
    serialized[size]={width:data.width,height:data.height,data:Array.from(data.data)};
    images[size]={previous,current};
  }
  const canvas=document.createElement('canvas');canvas.width=870;canvas.height=360;
  const context=canvas.getContext('2d');
  for(const [row,bg,fg] of [[0,'#ffffff','#111111'],[1,'#202124','#ffffff']]) {
    const y=row*180;
    context.fillStyle=bg;context.fillRect(0,y,870,180);context.fillStyle=fg;
    context.font='15px Arial';context.fillText((row?'Dark':'Light')+' toolbar background — same PNG, transparent border removed',15,y+22);
    for(const [column,size] of [16,20,24,32,48].entries()) {
      const x=15+column*125;
      context.font='14px Arial';context.fillText(size+' px',x,y+52);
      context.font='12px Arial';context.fillText('Old',x,y+74);context.fillText('New',x+57,y+74);
      context.imageSmoothingEnabled=true;
      context.drawImage(images[size].previous,x+(48-size)/2,y+94+(48-size)/2);
      context.drawImage(images[size].current,x+57+(48-size)/2,y+94+(48-size)/2);
    }
    context.font='14px Arial';context.fillText('16 px × 4 zoom',655,y+52);
    context.font='12px Arial';context.fillText('Old',655,y+74);context.fillText('New',740,y+74);
    context.imageSmoothingEnabled=false;context.drawImage(images[16].previous,655,y+87,64,64);context.drawImage(images[16].current,740,y+87,64,64);
  }
  bitmap.close();
  return {png:canvas.toDataURL('image/png'),serialized,sourceBounds,scaleX,scaleY,assetRequests,results};
}

async function renderStopIconPixelsOnly(helperSource, asset) {
  // Load actual controller pixels for the API adapter, without claiming the
  // separately blocked 48px visual comparison has been resolved or rerun.
  const chrome={runtime:{getURL:()=>asset}};
  const helper=new Function('chrome','helperSource',
    'let stopIconImageDataPromise=null;return eval("("+helperSource+")");')(chrome,helperSource);
  const pixels=await helper();
  return Object.fromEntries(Object.entries(pixels).map(([size,data])=>[size,{width:data.width,height:data.height,data:Array.from(data.data)}]));
}

(async () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-stop-browser-'));
  const profile = path.join(artifacts, 'profile');
  fs.mkdirSync(profile);
  const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = spawn(edge, ['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-features=msEdgeSidebarV2','--user-data-dir='+profile,'about:blank'], {windowsHide:true,stdio:'ignore'});
  console.log('ARTIFACTS', artifacts);
  let socket, cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i=0; i<200 && !fs.existsSync(portFile); i++) await wait(50);
    assert(fs.existsSync(portFile), 'Fresh Edge profile opens its own CDP port');
    const port = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0];
    const targets = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const target = targets.find(t => t.type === 'page');
    assert(target, 'Local page target exists');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
    let nextId=0, isolated, runtimeReceiver;
    const pending = new Map();
    socket.onmessage = event => {
      const m=JSON.parse(event.data);
      if (m.method === 'Runtime.bindingCalled' && m.params.name === '__stopRuntime' && runtimeReceiver) {
        const request=JSON.parse(m.params.payload);
        Promise.resolve(runtimeReceiver(request.message)).then(response=>cdp('Runtime.evaluate',{
          expression:'globalThis.__resolveCaptureRuntime('+JSON.stringify(request.id)+','+(JSON.stringify(response)??'undefined')+')',
          contextId:m.params.executionContextId
        })).catch(error=>console.warn('Runtime response bridge:',error.message));
        return;
      }
      const p=pending.get(m.id);
      if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    };
    cdp = (method,params={}) => new Promise((resolve,reject) => {
      const id=++nextId;
      const timer=setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: '+method)); },45000);
      pending.set(id,{resolve,reject,timer});
      socket.send(JSON.stringify({id,method,params}));
    });
    async function evaluate(expression, main=false) {
      const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(!main&&isolated?{contextId:isolated}:{})});
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Runtime.addBinding',{name:'__stopRuntime'});
    await cdp('Page.bringToFront');
    await cdp('Emulation.setFocusEmulationEnabled',{enabled:true});
    await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
    const reports=[];
    let previewsDone=false;
    let stopIconPixels;
    if(skipStopIconComparison) {
      const exclusion={status:'not verified',reason:'Explicitly excluded from the HUD suite: earlier 48px toolbar-icon comparison remains unresolved.'};
      fs.writeFileSync(path.join(artifacts,'stop-icon-comparison-skipped.json'),JSON.stringify(exclusion,null,2));
      console.log('SKIP','stop-icon-visual-comparison',exclusion.reason);
    }

    async function activateHudStop(context, key) {
      const progress=await evaluate('('+progressSnapshot.toString()+')()');
      assert(progress.visible,'Page Stop remains visible between screenshot frames');
      assert(progress.button && !progress.button.disabled,'Page Stop button is enabled');
      assert.equal(progress.button.pointerEvents,'auto','Page Stop button accepts input independently of its transparent host');
      assert(progress.button.hit,'Page Stop is above the selection overlay in hit testing');
      if(key) {
        await evaluate('window.__shotCaptureControl.progress.stopButton.focus()');
        assert((await evaluate('('+progressSnapshot.toString()+')()')).button.focused,'Page Stop receives keyboard focus');
        const event=key==='Space'?{key:' ',code:'Space',windowsVirtualKeyCode:32}:{key:'Enter',code:'Enter',windowsVirtualKeyCode:13};
        await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',...event});
        await cdp('Input.dispatchKeyEvent',{type:'keyUp',...event});
      } else {
        const {x,y,width,height}=progress.button.rect;
        const point={x:x+width/2,y:y+height/2};
        await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
        await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
        await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
      }
      for(let attempt=0;attempt<40 && context.activeCaptureJob && !context.activeCaptureJob.cancelled;attempt++) await wait(10);
      assert(!context.activeCaptureJob || context.activeCaptureJob.cancelled,'Real page button input reaches the active capture controller');
    }

    async function progressPreviews(context) {
      const previews=[];
      // The extension targets desktop Chrome. Narrow viewport checks cover
      // responsive placement, not unsupported mobile extension installation.
      for(const [layout,width,height] of [['desktop',1280,800],['narrow',360,740]]) {
        await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        for(const theme of ['light','dark']) {
          await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
          const background=theme==='dark'?'#161922':'#f8fafc';
          const foreground=theme==='dark'?'#f8fafc':'#162033';
          await evaluate("document.head.innerHTML='<style>html,body{margin:0;min-height:100%;font:18px system-ui;background:"+background+";color:"+foreground+"}main{padding:24px}h1{font-size:24px}</style>';document.body.innerHTML='<main><h1>Capture in progress</h1><p>Local "+theme+" page — "+layout+" layout.</p><p>The toolbar Stop icon stays unobstructed.</p></main>';scrollTo(0,0);");
          const beforeWidth=await evaluate('document.documentElement.scrollWidth');
          const job={id:'preview-'+layout+'-'+theme,tabId:1,mode:'full',phase:'capturing',percent:67,text:'Capturing page…',cancelled:false};
          context.activeCaptureJob=job;
          await context.installCaptureControl(job);
          await context.createCaptureProgress(job);
          await context.updateCaptureProgress(job);
          let progress;
          for(let attempt=0;attempt<40;attempt++) {
            progress=await evaluate('('+progressSnapshot.toString()+')()');
            if(progress.visible && progress.text.includes('67%')) break;
            await wait(25);
          }
          assert(progress.visible,'Progress is visible on '+layout+' '+theme);
          assert(progress.text.includes('67%'),'Real current percentage is rendered on '+layout+' '+theme);
          assert.equal(progress.position,'fixed','Progress does not alter page flow');
          assert.equal(progress.pointerEvents,'none','Progress does not intercept Area selection');
          assert(progress.button && progress.button.text.includes('STOP'),'Progress includes a clearly labelled STOP button');
          assert.equal(progress.button.pointerEvents,'auto','Only the Stop button receives pointer input');
          assert(progress.button.hit,'Stop button is reachable on '+layout+' '+theme);
          assert(progress.button.rect.x>=progress.rect.x && progress.button.rect.x+progress.button.rect.width<=progress.rect.x+progress.rect.width,'Stop fits inside the progress panel');
          assert.equal(progress.panelBackground,theme==='dark'?'rgb(24, 24, 39)':'rgb(255, 255, 255)','Progress uses its actual '+theme+' color scheme');
          assert.equal(progress.pageWidth,beforeWidth,'Progress creates no horizontal page overflow');
          assert(progress.rect.x>=0 && progress.rect.y>=0,'Progress stays inside top/left viewport bounds');
          assert(progress.rect.x+progress.rect.width<=width && progress.rect.y+progress.rect.height<=height,'Progress stays inside right/bottom viewport bounds');
          const screenshot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          const file='progress-'+layout+'-'+theme+'.png';
          fs.writeFileSync(path.join(artifacts,file),Buffer.from(screenshot.data,'base64'));
          previews.push({layout,theme,file,progress});
          await context.cleanupCaptureJob(job,false);
          context.activeCaptureJob=null;
          assert.equal((await evaluate('('+progressSnapshot.toString()+')()')).exists,false,'Preview cleanup removes the indicator');
        }
      }
      await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
      await cdp('Emulation.setEmulatedMedia',{features:[]});
      fs.writeFileSync(path.join(artifacts,'progress-layouts.json'),JSON.stringify(previews,null,2));
      previewsDone=true;
      console.log('PASS','progress-layouts',previews.length);
    }

    async function runCase(name, {mode='full', multi=false, editor=false, custom=false, stop=true, escape=false, areaScroll=false, stopDuringCapture=false, hudStop=false, stopBeforeDrag=false, hudKey=null, releaseOverHud=false}={}) {
      isolated=undefined; runtimeReceiver=undefined;
      await cdp('Page.navigate',{url:'about:blank'});
      await evaluate('('+fixture.toString()+')('+JSON.stringify(custom)+')',true);
      await wait(80);
      const tree=await cdp('Page.getFrameTree');
      isolated=(await cdp('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'capture-stop-fixture'})).executionContextId;
      await evaluate(`(()=>{
        const waiting=new Map();let sequence=0;
        globalThis.__resolveCaptureRuntime=(id,response)=>{const resolve=waiting.get(id);if(resolve){waiting.delete(id);resolve(response);}};
        globalThis.chrome={runtime:{sendMessage:message=>new Promise(resolve=>{
          const id=++sequence;waiting.set(id,resolve);__stopRuntime(JSON.stringify({id,message}));
        })}};
      })()`);
      const initial=await evaluate('('+stateSnapshot.toString()+')()');
      const messages=[],frames=[],outputs=[],icons=[],popups=[],progressStates=[],pixelChecks=[],tabUpdates=[];
      const event = () => ({listeners:[],addListener(fn){this.listeners.push(fn);}});
      const onMessage=event(), onClicked=event();
      const session={};
      const previousMulti={active:true,sessionId:'unchanged-session',sourceTabId:1,editorTabId:editor?2:null,nextId:7,pieces:[{img:'data:image/png;base64,previous',tipo:'visible',id:7}],trash:[{img:'data:image/png;base64,undone',tipo:'area',id:6}]};
      if (multi) session.multi=clone(previousMulti);
      const local={copyToClipboard:false,reviewInviteShown:true,lentePixel:false};
      function storage(data) {
        return {
          async get(keys) {
            if (keys===null||keys===undefined) return clone(data);
            const result={};
            for (const key of Array.isArray(keys)?keys:typeof keys==='string'?[keys]:Object.keys(keys)) if (key in data) result[key]=clone(data[key]);
            return result;
          },
          async set(values) { Object.assign(data,clone(values)); },
          async remove(keys) { for(const key of Array.isArray(keys)?keys:[keys]) delete data[key]; },
          async getBytesInUse() { return JSON.stringify(data).length; }
        };
      }
      let context, screenshotCount=0, hudStopTriggered=false;
      const chrome={
        runtime:{onInstalled:event(),onMessage,getManifest:()=>({name:'Capture fixture',version:'9.11'}),getURL:file=>'chrome-extension://fixture/'+file,sendMessage:async m=>{messages.push(clone(m));}},
        action:{onClicked,setPopup:async v=>{popups.push(v.popup);},setIcon:async v=>{
          if(v.imageData) {
            assert.deepEqual(Object.keys(v.imageData),['16','20','24','32','48'],'Toolbar receives every real rendered scale');
            for(const [size,data] of Object.entries(v.imageData)) {
              assert.equal(data.width,Number(size),'Toolbar scale has correct width');
              assert.equal(data.height,Number(size),'Toolbar scale preserves square proportions');
              assert.deepEqual(Array.from(data.data),stopIconPixels[size].data,'Controller forwards exactly the real browser renderer pixels');
            }
          }
          icons.push(v.path||'enlarged-stop');
        },setTitle:async()=>{},setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setBadgeTextColor:async()=>{}},
        contextMenus:{onClicked:event()},
        storage:{local:storage(local),session:storage(session)},
        tabs:{onRemoved:event(),onActivated:event(),onUpdated:event(),get:async id=>({id,windowId:1,active:true,url:'http://fixture.local/'}),update:async(id,args)=>{tabUpdates.push(id);return {id,windowId:1,active:args.active};},query:async()=>[{id:1,windowId:1,active:true}],
          captureVisibleTab:async()=>{
            screenshotCount++;
            const progress=await evaluate('('+progressSnapshot.toString()+')()');
            assert.equal(progress.visible,false,'Page progress indicator is hidden at the actual screenshot boundary');
            frames.push(await evaluate('('+stateSnapshot.toString()+')()'));
            const frame=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
            if(progress.exists && !pixelChecks.length) {
              // Compare actual screenshot pixels to a second shot with the
              // exact same UI node physically detached, not merely restyled.
              await evaluate("(()=>{const host=document.getElementById('__shot_capture_progress');window.__progressPixelCheck={host,parent:host.parentNode,next:host.nextSibling};host.remove();})()");
              let reference;
              try {reference=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});}
              finally {await evaluate("(()=>{const saved=window.__progressPixelCheck;saved.parent.insertBefore(saved.host,saved.next);delete window.__progressPixelCheck;})()");}
              const actualUrl='data:image/png;base64,'+frame.data;
              const referenceUrl='data:image/png;base64,'+reference.data;
              const result=await evaluate('('+comparePixels.toString()+')('+JSON.stringify(actualUrl)+','+JSON.stringify(referenceUrl)+')');
              assert.equal(result.sameSize,true,'Reference and captured PNG dimensions match');
              assert.equal(result.changed,0,'Captured PNG is pixel-identical to the page with no progress indicator');
              pixelChecks.push(result);
            }
            if(stop && !hudStop && (mode!=='area'||stopDuringCapture) && screenshotCount===(mode==='visible'?1:2)) {
              assert(context.activeCaptureJob, 'Capture lock exists during screenshot');
              assert.equal(context.activeCaptureJob.committed,false,'Image is not committed before stop');
              onClicked.listeners[0]();
              if (mode !== 'full' && mode !== 'area') {
                assert.equal(context.activeCaptureJob.cancelled,false,'Ordinary icon is not a hidden Stop');
                context.cancelCapture(); // Internal cancellation remains safe without a toolbar Stop.
              }
            }
            return 'data:image/png;base64,'+frame.data;
          }
        },
        windows:{update:async()=>{}},
        downloads:{download:async args=>{outputs.push(args.url);return outputs.length;}},
        scripting:{executeScript:async spec=>{
          const result=await evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args||[])+')',spec.world==='MAIN');
          if(context && context.activeCaptureJob) {
            const progress=await evaluate('('+progressSnapshot.toString()+')()');
            if(progress.exists) progressStates.push(progress);
            if(hudStop && !stopBeforeDrag && !hudStopTriggered && screenshotCount>=2 && progress.visible && !context.activeCaptureJob.cancelled && !context.activeCaptureJob.committed) {
              hudStopTriggered=true;
              await activateHudStop(context,hudKey);
            }
          }
          return [{result}];
        }}
      };
      context=vm.createContext({chrome,console,setTimeout,clearTimeout,setInterval,clearInterval,crypto:webcrypto});
      context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(ext,file),'utf8'),context,{filename:file}));
      vm.runInContext(fs.readFileSync(path.join(ext,'sw.js'),'utf8'),context,{filename:'sw.js'});
      await context.captureRecovery;
      icons.length=0; popups.length=0;
      if(!stopIconPixels) {
        const iconAsset='data:image/png;base64,'+fs.readFileSync(path.join(ext,'stop_94.png')).toString('base64');
        if(skipStopIconComparison) {
          stopIconPixels=await evaluate('('+renderStopIconPixelsOnly.toString()+')('+JSON.stringify(context.getStopIconImageData.toString())+','+JSON.stringify(iconAsset)+')');
        } else {
          const rendered=await evaluate('('+renderStopIconComparison.toString()+')('+JSON.stringify(context.getStopIconImageData.toString())+','+JSON.stringify(context.setCaptureAction.toString())+','+JSON.stringify(iconAsset)+')');
          stopIconPixels=rendered.serialized;
          fs.writeFileSync(path.join(artifacts,'stop-icon-light-dark.png'),Buffer.from(rendered.png.split(',')[1],'base64'));
          const {png,serialized,...measurements}=rendered;
          fs.writeFileSync(path.join(artifacts,'stop-icon-measurements.json'),JSON.stringify(measurements,null,2));
          console.log('PASS','stop-icon-native-renderer',JSON.stringify({sourceBounds:rendered.sourceBounds,uniformScale:rendered.scaleX,sizes:rendered.results.length}));
        }
      }
      // Reuse native browser-rendered pixels in the VM/controller adapter.
      // Actual Chrome toolbar placement is deliberately not claimed here.
      context.stopIconImageDataPromise=Promise.resolve(Object.fromEntries(Object.entries(stopIconPixels).map(([size,data])=>[size,{width:data.width,height:data.height,data:new Uint8ClampedArray(data.data)}])));
      runtimeReceiver=message=>new Promise((resolve,reject)=>{
        let answered=false,keepAlive=false;
        const sendResponse=value=>{if(!answered){answered=true;resolve(value);}};
        try {
          for(const listener of onMessage.listeners) if(listener(message,{tab:{id:1}},sendResponse)===true) keepAlive=true;
          if(!answered && !keepAlive) resolve(undefined);
        } catch(error) {reject(error);}
      });
      if(multi && !editor) await context.multiMostraWidget(1);
      const accepted=multi?await context.multiAggiungiDaEditor(mode,editor?2:1):context.startControlledCapture(1,mode);
      assert.equal(accepted.started,true,'Controlled capture starts');
      const job=context.activeCaptureJob;
      assert.equal(context.startControlledCapture(1,mode).started,false,'Second start does not launch a second job');
      if(mode==='area') {
        for(let i=0;i<150;i++) {if(await evaluate("!!document.getElementById('__screenshot_area_overlay')"))break;await wait(30);}
        assert(await evaluate("!!document.getElementById('__screenshot_area_overlay')"),'Area overlay appears');
        if(stopBeforeDrag) {
          hudStopTriggered=true;
          await activateHudStop(context,hudKey);
        } else {
        if(!areaScroll) await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:280,y:160});
        await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:280,y:160});
        await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:1010,y:620});
        await wait(120);
        if(areaScroll) {
          await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:1010,y:793});
          for(let i=0;i<120;i++) {
            if(await evaluate('window.scrollY')>=initial.y+1600) break;
            await wait(30);
          }
          assert(await evaluate('window.scrollY')>=initial.y+1600,'Real Area drag scrolls through more than two screens');
          await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:1010,y:620});
        }
        if(releaseOverHud) {
          const progress=await evaluate('('+progressSnapshot.toString()+')()');
          assert(progress.visible && progress.button.hit,'Stop is under the real mouse release point');
          const {x,y,width,height}=progress.button.rect;
          const point={x:x+width/2,y:y+height/2};
          await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...point});
          await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});
        } else if(stop && !stopDuringCapture) {
          if(escape) await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          else onClicked.listeners[0]();
        } else {
          await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:1010,y:620});
        }
        await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
        await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        if(stop && !stopDuringCapture) await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:1010,y:620});
        }
      }
      let timer;
      try { await Promise.race([job.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(name+': capture did not finish')),releaseOverHud?15000:60000);})]); }
      finally { clearTimeout(timer); }
      if(releaseOverHud) {
        assert(job.cancelled || job.committed,'Releasing Area over Stop either completes or cancels without leaving a drag pending');
        stop=job.cancelled;
      }
      await wait(80);
      const restored=await evaluate('('+stateSnapshot.toString()+')()');
      const paused=await evaluate("({css:!!document.getElementById('__shot_css_pause'),observers:(window.__shotFrozen||[]).length})",true);
      assert.equal(context.activeCaptureJob,null,'Capture lock is released');
      assert.equal(session.captureJob,undefined,'Recovery record is removed');
      assert.equal(restored.overlay,false,'Area overlay is removed');
      assert.equal(restored.noselect,false,'Selection CSS is removed');
      assert.equal(restored.control,false,'Keyboard control is removed');
      assert.equal(restored.progress,false,'Page progress indicator is removed after completion or Stop');
      assert.equal(restored.markers,0,'Temporary scroll markers are removed');
      assert.equal(restored.sticky,initial.sticky,'Sticky visibility is restored');
      assert.equal(paused.css,false,'Capture pause CSS is removed');
      assert.equal(paused.observers,0,'Motion freeze observers are disconnected');
      const toolbarStop=mode==='full'||mode==='area';
      assert.equal(popups.includes(''),toolbarStop,'Full Page and Area disable the popup for toolbar Stop');
      assert.equal(popups.at(-1),'popup.html','Normal popup is restored');
      assert.equal(icons.includes('enlarged-stop'),toolbarStop,'Full Page and Area use the enlarged supplied Stop icon');
      assert.equal(icons.includes('stop_94.png'),false,'Real renderer succeeds without falling back to the padded original icon');
      assert.equal(icons.at(-1),'icon_128.png','Normal icon is requested again');
      const visibleProgress=progressStates.filter(state=>state.visible);
      if(toolbarStop) {
        assert(visibleProgress.length>0,'Full Page and Area expose visible progress between screenshots');
        assert(visibleProgress.some(state=>/\b\d{1,3}%/.test(state.text)),'Progress percentage is visible without a mouse hover');
        assert(visibleProgress.some(state=>/Esc/.test(state.text)),'Visible progress explains how to stop');
        if(frames.length) assert.equal(pixelChecks.length,1,'At least one captured PNG is checked against a clean pixel reference');
      } else assert.equal(progressStates.length,0,'Visible Only does not flash the long-capture indicator');
      assert.equal(messages.filter(m=>m.type==='error').length,0,'No capture error');
      if(areaScroll) assert(frames.length>=(stop?2:3),'Scrolling Area really produces multiple screenshot frames');
      if(stop) {
        if(hudStop) assert(hudStopTriggered,'The on-page Stop button was actually activated');
        assert.equal(job.cancelled,true,'Stop reaches current job');
        assert.equal(job.committed,false,'Stopped job never commits a partial image');
        assert.equal(outputs.length,0,'No incomplete file is downloaded');
        assert.equal(messages.filter(m=>m.type==='success').length,0,'Cancelled capture does not report success');
        for(const key of ['y','nested','main']) assert.equal(restored[key],initial[key],'Initial '+key+' scroll is restored');
        if(multi) assert.deepEqual(session.multi,previousMulti,'Multi Snip preserves pieces, redo and nextId');
      } else {
        assert.equal(job.committed,true,'Complete image is committed');
        if(multi) {
          assert.equal(outputs.length,0,'Multi Snip does not download a standalone file');
          assert.equal(session.multi.pieces.length,2,'Multi Snip adds exactly one complete piece');
          assert.deepEqual(session.multi.pieces[0],previousMulti.pieces[0],'Earlier Multi Snip piece remains intact');
        } else assert.equal(outputs.length,1,'Normal capture downloads one complete image');
        const url=multi?session.multi.pieces.at(-1).img:outputs[0];
        const png=Buffer.from(url.split(',')[1],'base64');
        assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a','Output is an actual PNG');
        fs.writeFileSync(path.join(artifacts,name+'.png'),png);
      }
      if(multi && !editor) assert.equal(restored.widget,true,'Multi Snip widget returns after cleanup');
      if(editor) {
        assert.equal(restored.widget,false,'Editor capture does not leave a widget over the source page');
        assert.equal(tabUpdates.at(-1),2,'Capture requested from editor returns to the editor after cleanup');
        assert.equal(job.tabId,1,'Editor capture uses the remembered source tab');
      }
      const tickerAfter=await evaluate("document.getElementById('ticker').style.transform",true);
      await wait(110);
      assert.notEqual(await evaluate("document.getElementById('ticker').style.transform",true),tickerAfter,'Decorative motion resumes');
      if(releaseOverHud) {
        const stoppedAt=await evaluate('window.scrollY');
        await wait(150);
        assert.equal(await evaluate('window.scrollY'),stoppedAt,'Releasing over Stop leaves no auto-scroll loop running');
      }
      const report={name,mode,multi,editor,custom,stop,escape,areaScroll,stopDuringCapture,hudStop,stopBeforeDrag,hudKey,releaseOverHud,frames:frames.length,outputs:outputs.length,initial,restored,paused,committed:job.committed,cancelled:job.cancelled,messages,
        visibleProgressSamples:visibleProgress.length,progressSample:visibleProgress.at(-1),pixelChecks};
      reports.push(report);
      if(stop || releaseOverHud) {
        const outputsBeforeNext=outputs.length,piecesBeforeNext=session.multi?.pieces.length;
        const followup=multi?await context.multiAggiungiDaEditor('visible',editor?2:1):context.startControlledCapture(1,'visible');
        assert.equal(followup.started,true,'Another capture starts without reloading page or worker');
        const nextJob=context.activeCaptureJob;
        await nextJob.done;
        assert.equal(nextJob.committed,true,'Next capture completes after Stop');
        assert.equal(context.activeCaptureJob,null,'Next capture releases the same worker lock');
        if(multi) {
          assert.equal(outputs.length,0,'Next Multi capture stays inside the session');
          assert.equal(session.multi.pieces.length,piecesBeforeNext+1,'Next Multi capture adds one piece');
          assert.deepEqual(session.multi.pieces[0],previousMulti.pieces[0],'Previous Multi piece also survives next capture');
          if(!editor) assert(await evaluate("!!document.getElementById('__shot_multi_widget')"),'Widget returns after next capture');
          else assert.equal(tabUpdates.at(-1),2,'Next capture also returns to the editor');
        } else assert.equal(outputs.length,outputsBeforeNext+1,'Next complete capture downloads normally');
        report.nextCaptureSucceeded=true;
      }
      fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(reports,null,2));
      console.log('PASS',name,JSON.stringify({frames:report.frames,outputs:report.outputs,nextCaptureSucceeded:report.nextCaptureSucceeded,pieces:session.multi?.pieces.length}));
      runtimeReceiver=undefined;
      if(!previewsDone) await progressPreviews(context);
    }

    const cases=[
      ['full-stop',{mode:'full'}],
      ['custom-full-stop',{mode:'full',custom:true}],
      ['area-escape',{mode:'area',escape:true}],
      ['area-stop',{mode:'area'}],
      ['multi-full-stop',{mode:'full',multi:true}],
      ['multi-visible-stop',{mode:'visible',multi:true}],
      ['multi-area-escape',{mode:'area',multi:true,escape:true}],
      ['multi-area-stop',{mode:'area',multi:true}],
      ['full-normal',{mode:'full',stop:false}],
      ['area-normal',{mode:'area',stop:false}],
      ['multi-full-normal',{mode:'full',multi:true,stop:false}],
      ['multi-visible-normal',{mode:'visible',multi:true,stop:false}],
      ['multi-area-normal',{mode:'area',multi:true,stop:false}],
      ['editor-full-stop',{mode:'full',multi:true,editor:true}],
      ['editor-area-stop',{mode:'area',multi:true,editor:true}],
      ['editor-full-normal',{mode:'full',multi:true,editor:true,stop:false}],
      ['editor-area-normal',{mode:'area',multi:true,editor:true,stop:false}],
      ['area-scroll-normal',{mode:'area',stop:false,areaScroll:true}],
      ['editor-area-scroll-normal',{mode:'area',multi:true,editor:true,stop:false,areaScroll:true}],
      ['area-scroll-stop',{mode:'area',areaScroll:true,stopDuringCapture:true}],
      ['hud-full-stop',{mode:'full',hudStop:true}],
      ['hud-custom-full-stop',{mode:'full',custom:true,hudStop:true}],
      ['hud-area-before-drag',{mode:'area',hudStop:true,stopBeforeDrag:true}],
      ['hud-area-space',{mode:'area',hudStop:true,stopBeforeDrag:true,hudKey:'Space'}],
      ['hud-area-enter',{mode:'area',hudStop:true,stopBeforeDrag:true,hudKey:'Enter'}],
      ['hud-area-scroll-stop',{mode:'area',hudStop:true,areaScroll:true,stopDuringCapture:true}],
      ['hud-multi-full-stop',{mode:'full',multi:true,hudStop:true}],
      ['hud-multi-area-scroll-stop',{mode:'area',multi:true,hudStop:true,areaScroll:true,stopDuringCapture:true}],
      ['hud-editor-full-stop',{mode:'full',multi:true,editor:true,hudStop:true}],
      ['hud-editor-area-before-drag',{mode:'area',multi:true,editor:true,hudStop:true,stopBeforeDrag:true}],
      ['hud-editor-area-scroll-stop',{mode:'area',multi:true,editor:true,hudStop:true,areaScroll:true,stopDuringCapture:true}],
      ['hud-area-release-over-stop',{mode:'area',stop:false,releaseOverHud:true}],
      ['hud-editor-area-release-over-stop',{mode:'area',multi:true,editor:true,stop:false,releaseOverHud:true}]
    ];
    const only=process.argv.slice(2);
    for(const [name,options] of cases) if(!only.length||only.includes(name)) await runCase(name,options);
    console.log('BROWSER_CHECKS_PASSED',reports.length);
  } finally {
    if(cdp) await cdp('Browser.close').catch(()=>{});
    if(socket) socket.close();
    if(browser.exitCode===null) browser.kill();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
