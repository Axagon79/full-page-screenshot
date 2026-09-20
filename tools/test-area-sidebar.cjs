'use strict';
// Approved diagnostic: actual Area selection/capture in a real DOM, Chrome APIs adapted via CDP.
// No installed extension, user profile, account, or real download is involved.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { openBrowser, wait } = require('./lib/browser-fixture.cjs');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'full-page-screenshot-extension');
// Keep the recorded pre-fix comparison stable after committing this tool.
const baselineRef = '06d75a4';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function fixture(independent, release) {
  document.head.innerHTML = `<style>
    *{box-sizing:border-box}body{margin:0;background:#fff;font:16px Arial}header{position:sticky;top:0;height:60px;background:#e6edf5;z-index:5;padding:18px}
    .layout{display:flex}aside{width:260px;flex-shrink:0;margin-top:-60px;border-right:1px solid #ddd}.sidebar{position:sticky;top:0;height:100vh;max-height:100vh;padding-top:60px}
    nav{height:100%;overflow:auto;background:#fff}nav div{height:44px;padding:12px}main{flex:1;display:flex;padding:20px;gap:20px}
    article{flex:1;min-width:0}.block{height:360px;padding:30px;background:#f0f5fa;border-bottom:1px solid #fff}
    .toc-wrap{width:220px;flex-shrink:0}.toc{position:sticky;top:76px;max-height:calc(100vh - 90px);overflow:auto;background:#24b7a3;padding:20px;height:130px}
    footer{height:220px;background:#ae2565;color:white;padding:30px}
  </style>`;
  document.body.innerHTML = '<header>Page navigation</header><div class="layout"><aside><div class="sidebar"><nav>' +
    Array.from({length:24},(_,i)=>'<div data-nav-item>MENU ITEM '+(i+1)+'</div>').join('') + '</nav></div></aside><main><article>' +
    Array.from({length:13},(_,i)=>'<section class="block">ARTICLE BLOCK '+(i+1)+'</section>').join('') +
    '</article><div class="toc-wrap"><div class="toc">RIGHT CONTENTS<br>Must appear only once</div></div></main></div><footer>PAGE FOOTER — must remain below the article</footer>';
  scrollTo(0,0);
  if (independent) {
    const style=document.createElement('style');
    style.textContent='html,body{height:100%;overflow:hidden}.layout{height:calc(100vh - 60px)}aside{margin-top:0}.sidebar{position:static;height:100%;padding-top:0}main{height:100%;overflow:auto}.toc{position:static}.toc-wrap{display:none}footer{display:none}';
    document.head.appendChild(style);
  }
  if (release) {
    // A short sticky rail releases at its parent's bottom, well before the
    // document ends. It must not reappear in the later Area frames.
    document.querySelector('aside').remove();
    document.querySelector('.toc-wrap').style.height='3960px';
    const rail=document.querySelector('.toc');
    rail.id='release-rail';rail.style.height='340px';
    rail.textContent='RAIL: keep once at the start';
    const bar=document.createElement('div');bar.id='real-bottom-bar';
    bar.style.cssText='position:fixed;bottom:0;left:0;width:100%;height:70px;background:rgb(113,51,199);z-index:8';
    bar.textContent='REAL BOTTOM BAR: keep at the end';document.body.appendChild(bar);
  }
}

function frameState() {
  const hud=document.getElementById('__shot_capture_progress');
  const list=window.__screenshotStickies||[];
  window.__testStickyElements ||= [];
  const stickies=list.map(item=>{
    let id=window.__testStickyElements.findIndex(rec=>rec.el===item.el);
    if(id<0){id=window.__testStickyElements.length;window.__testStickyElements.push({el:item.el,oldVis:item.oldVis});}
    const r=item.el.getBoundingClientRect(),css=getComputedStyle(item.el);
    return {id,name:item.el.id||item.el.tagName+'.'+item.el.className,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
      visible:css.visibility==='visible'&&css.display!=='none'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight,
      hiddenByCapture:!!item.hiddenByCapture,repeat:!!item.hiddenAsRepeat,bottomGroup:!!item.bottomGroup};
  });
  return {y:scrollY,hudHidden:!hud||getComputedStyle(hud).display==='none'||getComputedStyle(hud).visibility==='hidden',stickies,
    panes:(window.__screenshotAreaPanes||[]).map(p=>({isWindow:p.isWindow,scroll:p.el.scrollTop,rect:p.el.getBoundingClientRect().toJSON()})),
    footer:document.querySelector('footer')?.getBoundingClientRect().toJSON()};
}

async function checkReleasePixels(source) {
  const im=new Image();await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=reject;im.src=source;});
  const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);
  const pixels=ctx.getImageData(0,0,c.width,c.height).data;
  const railRows=[],barRows=[];
  for(let y=0;y<c.height;y++){
    let rail=0,bar=0;for(let x=0;x<c.width;x++){
      const p=(y*c.width+x)*4;
      if(pixels[p]===36&&pixels[p+1]===183&&pixels[p+2]===163)rail++;
      if(pixels[p]===113&&pixels[p+1]===51&&pixels[p+2]===199)bar++;
    }
    if(rail>100)railRows.push(y);if(bar>c.width*.8)barRows.push(y);
  }
  return {railRows:railRows.length,railBottom:Math.max(...railRows),barRows:barRows.length,barTop:Math.min(...barRows),height:c.height};
}

function selectArea(overshoot, rightEdge, fromContent) {
  const overlay = document.getElementById('__screenshot_area_overlay');
  const right = rightEdge ? innerWidth + 20 : document.documentElement.clientWidth - 1;
  const startX = fromContent ? Math.ceil(document.querySelector('main').getBoundingClientRect().left) + 30 : 1;
  const startY = fromContent ? 160 : 1;
  const mouse = (type,x,y) => overlay.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,buttons:type==='mouseup'?0:1}));
  mouse('mousemove',startX,startY); mouse('mousedown',startX,startY); mouse('mousemove',right,450);
  overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:right,clientY:450,deltaY:100000}));
  const bottom=innerHeight-1+(overshoot||0);
  mouse('mousemove',right,bottom); mouse('mouseup',right,bottom);
  return {area:window.__screenshotArea, paneElements:[...document.querySelectorAll('[data-screenshot-area-pane]')].map(el=>({
    name:el.tagName+'.'+el.className,rect:el.getBoundingClientRect().toJSON(),scrollTop:el.scrollTop,
    clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}))};
}

async function selectNativeRightEdge(browser, dragToBottom, outsideRight) {
  const bounds=await browser.evaluate(`(()=>{
    window.__nativeSelectionEvents=[];
    for(const type of ['mousedown','mouseup'])document.addEventListener(type,e=>window.__nativeSelectionEvents.push({type:e.type,x:e.clientX,y:e.clientY,target:e.target.id}),true);
    return {width:innerWidth,height:innerHeight,contentWidth:document.documentElement.clientWidth,
      scrollbar:getComputedStyle(document.documentElement).scrollbarWidth};
  })()`);
  console.log('Native selection bounds',JSON.stringify(bounds));
  const x=outsideRight?bounds.width+20:bounds.width-1;
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:50,y:160});
  await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:50,y:160,button:'left',buttons:1,clickCount:1});
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:450,buttons:1});
  if(!dragToBottom){
    await browser.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:x-25,y:450,deltaX:0,deltaY:100000,buttons:1});
    await wait(150);
  }
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y:bounds.height-1,buttons:1});
  const dragSamples=[];
  if(dragToBottom){
    const started=Date.now();let lastLog=-Infinity;
    while(Date.now()-started<15000){
      await wait(150);
      const sample=await browser.evaluate(`(()=>{const o=document.getElementById('__screenshot_area_overlay'),b=o?.firstElementChild;return {y:scrollY,height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,viewport:[innerWidth,innerHeight],box:b?.getBoundingClientRect().toJSON()};})()`);
      dragSamples.push(sample);
      if(sample.y-lastLog>=800){console.log('Dragging at right edge',JSON.stringify(sample));lastLog=sample.y;}
      if(sample.y+sample.viewport[1]>=sample.height-1){await wait(250);break;}
    }
    const preRelease=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(root,'tools/artifacts','selection-drag-edge'+(outsideRight?'-outside':'')+'.png'),Buffer.from(preRelease.data,'base64'));
  }
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y:bounds.height-1,button:'left',buttons:0,clickCount:1});
  const selected=await browser.evaluate('({area:window.__screenshotArea,events:window.__nativeSelectionEvents})');
  assert(selected.area,'Native mouse release must complete the selection');
  return {...selected,dragSamples};
}

function trackPreparation() {
  const state=window.__shotCaptureControl?.sidebars;
  window.__sidebarExpected=state?state.changes.map(rec=>({el:rec.el,hadStyle:rec.hadStyle,properties:rec.properties})):[];
  window.__navExpected=state?state.scrolls.flatMap(rec=>[...rec.el.querySelectorAll('a, [data-nav-item]')])
    .filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&el.checkVisibility({checkVisibilityCSS:true,checkOpacity:true});}):[];
  window.__navPixelSamples=[];
  window.__navSampleCovered=-Infinity;
  return {changed:window.__sidebarExpected.length,items:window.__navExpected.length,height:document.documentElement.scrollHeight};
}

async function sampleNavigation(source, originX, originY) {
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source;});
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  // The compositor retains the first copy of overlapping document rows. A
  // later copy can be under the moving header (MDN); it is not used in output.
  const retainedTop=Math.max(0,(window.__navSampleCovered||0)-scrollY);
  (window.__navExpected||[]).forEach((el,index)=>{
    const r=el.getBoundingClientRect();
    const x=Math.max(0,Math.ceil(r.left)),y=Math.max(0,Math.ceil(r.top),retainedTop);
    const w=Math.min(image.width,Math.floor(r.right))-x,h=Math.min(image.height,Math.floor(r.bottom))-y;
    if(w<=0||h<=0)return;
    window.__navPixelSamples.push({index,x:x-originX,y:y+scrollY-originY,w,h,pixels:ctx.getImageData(x,y,w,h).data});
  });
  window.__navSampleCovered=scrollY+image.height;
}

async function checkNavigationPixels(source) {
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source;});
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  let changed=0,checked=0;const seen=new Set(),differences=[];
  for(const sample of window.__navPixelSamples||[]){
    if(sample.x<0||sample.y<0||sample.x+sample.w>canvas.width||sample.y+sample.h>canvas.height)continue;
    const actual=ctx.getImageData(sample.x,sample.y,sample.w,sample.h).data;
    let different=0;for(let p=0;p<actual.length;p++)if(actual[p]!==sample.pixels[p])different++;
    changed+=different;if(different&&differences.length<20)differences.push({index:sample.index,x:sample.x,y:sample.y,w:sample.w,h:sample.h,different});
    seen.add(sample.index);checked++;
  }
  return {width:image.width,height:image.height,expected:(window.__navExpected||[]).length,seen:seen.size,checked,changed,differences};
}

(async()=>{
  const tailwind = process.argv.includes('--tailwind');
  const site=(process.argv.find(arg=>arg.startsWith('--site='))||'').slice(7);
  const baseline=process.argv.includes('--baseline');
  const sites={mdn:'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position',css:'https://developer.mozilla.org/en-US/docs/Web/CSS',wiki:'https://it.wikipedia.org/wiki/Pagina_principale',yahoo:'https://finance.yahoo.com/'};
  if(site&&!sites[site])throw Error('Unknown site '+site);
  const live = process.argv.includes('--live') || tailwind || !!site;
  const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--visible') ? 'visible' : 'area';
  const multi = process.argv.includes('--multi');
  const editor = process.argv.includes('--editor');
  const independent = process.argv.includes('--independent');
  const release = process.argv.includes('--release');
  const overshoot=Number((process.argv.find(arg=>arg.startsWith('--overshoot='))||'').slice(12))||0;
  const rightEdge=process.argv.includes('--right-edge'),fromContent=process.argv.includes('--from-content');
  const dragEdge=process.argv.includes('--drag-edge'),outsideRight=process.argv.includes('--outside-right');
  const nativeEdge=process.argv.includes('--native-edge')||dragEdge;
  const stop = process.argv.includes('--stop'), failure = process.argv.includes('--failure');
  const mobile=process.argv.includes('--mobile'),dark=process.argv.includes('--dark');
  const browser = await openBrowser(mobile?390:1920,900);
  const outputDir = path.join(root,'tools/artifacts'); fs.mkdirSync(outputDir,{recursive:true});
  try {
    if(dark)await browser.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
    if(live) {
      await browser.cdp('Page.navigate',{url:sites[site]||(tailwind?'https://tailwindcss.com/docs/installation/using-vite':'https://api-docs.deepseek.com/guides/thinking_mode/')});
      for(let i=0;i<60;i++){if(await browser.evaluate("!!document.querySelector('h1')"))break;await wait(250);}
      assert(await browser.evaluate("!!document.querySelector('h1')"),'The public documentation loaded');
      if(site==='yahoo'&&await browser.evaluate('location.hostname==="consent.yahoo.com"')){
        const buttons=await browser.evaluate('[...document.querySelectorAll("button")].map(b=>({text:b.innerText,name:b.name,value:b.value}))');
        console.log('Yahoo consent buttons',JSON.stringify(buttons));
        const rejected=await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^(Reject all|Rifiuta tutto)$/i.test(b.innerText.trim()));if(!b)return false;b.click();return true;})()`);
        assert(rejected,'Yahoo must offer rejection of optional cookies in this isolated profile');
        for(let i=0;i<60;i++){if(await browser.evaluate('location.hostname==="finance.yahoo.com"&&!!document.querySelector("h1")'))break;await wait(250);}
        assert(await browser.evaluate('location.hostname==="finance.yahoo.com"'),'Yahoo Finance loaded after rejecting optional cookies');
      }
      // Load the documentation's deferred diagrams before taking the baseline
      // height: otherwise a late image looks like failed layout restoration.
      await browser.evaluate(`(async()=>{const bottom=Math.min(45000,document.documentElement.scrollHeight);for(let y=0;y<bottom;y+=innerHeight){scrollTo(0,y);await new Promise(r=>setTimeout(r,100));}scrollTo(0,0);
        await Promise.race([Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,3000))]);return true;})()`);
      await browser.evaluate('document.fonts.ready.then(()=>true)'); await wait(1000);
    } else await browser.evaluate('('+fixture.toString()+')('+independent+','+release+')');
    const initial = await browser.evaluate(`({url:location.href,title:document.title,y:scrollY,height:document.documentElement.scrollHeight,inner:innerHeight,
      scrollers:[...document.querySelectorAll('*')].filter(el=>/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+10).map(el=>({
        tag:el.tagName,cls:el.className,position:getComputedStyle(el).position,rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
        first:el.innerText?.slice(0,80),last:el.innerText?.slice(-100)}))})`);
    console.log('Initial',JSON.stringify(initial));
    const event=()=>({addListener(){}});
    const storage=data=>({async get(keys){const result={};for(const key of Array.isArray(keys)?keys:[keys])if(key in data)result[key]=clone(data[key]);return result;},
      async set(values){Object.assign(data,clone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}});
    const frames=[],outputs=[],messages=[],compositions=[];let selection=null,context,preparation=null;
    const previousPiece={id:1,tipo:'visible',img:'data:image/png;base64,previous'};
    const session=multi?{multi:{active:true,sessionId:'area-diagnostic',sourceTabId:1,editorTabId:editor?2:null,nextId:1,pieces:[previousPiece],trash:[]}}:{};
    const chrome={
      runtime:{onInstalled:event(),onMessage:event(),getManifest:()=>({name:'Area diagnostic',version:'9.11'}),getURL:file=>'chrome-extension://fixture/'+file,sendMessage:async m=>{messages.push(clone(m));}},
      action:{onClicked:event(),setIcon:async()=>{},setPopup:async()=>{},setTitle:async()=>{},setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setBadgeTextColor:async()=>{}},
      contextMenus:{onClicked:event()},storage:{local:storage({lentePixel:false,copyToClipboard:false,reviewInviteShown:true}),session:storage(session)},
      windows:{update:async()=>{}},
      tabs:{onRemoved:event(),onActivated:event(),onUpdated:event(),get:async id=>({id,windowId:1,active:true}),update:async id=>({id,windowId:1,active:true}),query:async()=>[{id:1,windowId:1,active:true}],
        captureVisibleTab:async()=>{
          const state=await browser.evaluate('('+frameState.toString()+')()');
          assert(state.hudHidden,'Progress widget is excluded from every captured frame');
          frames.push(state);console.log('Frame',frames.length,'page scroll',state.y);
          if(frames.length===2&&failure)throw Error('Intentional capture failure for restoration check');
          if(frames.length===2&&stop)context.cancelCapture();
          const image=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          await browser.evaluate('('+sampleNavigation.toString()+')('+JSON.stringify('data:image/png;base64,'+image.data)+','+(selection?.area?.x||0)+','+(selection?.area?.y_doc||0)+')');
          return 'data:image/png;base64,'+image.data;
        }},
      downloads:{download:async args=>{outputs.push(args.url);return outputs.length;}},
      scripting:{executeScript:async spec=>{
        if(spec.func.toString().includes('function(imgs, ax, aw, ah_doc')){
          const bytes=Buffer.from(spec.args[0][0].split(',')[1],'base64');
          const comp={frames:spec.args[0].length,width:spec.args[2],height:spec.args[3],viewportHeight:spec.args[4],
            screenshotWidth:bytes.readUInt32BE(16),screenshotHeight:bytes.readUInt32BE(20),unfolded:spec.args[14]};
          compositions.push(comp);console.log('Area composition',JSON.stringify(comp));
        }
        const result=await browser.evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args||[])+')');
        if(spec.func.toString().includes('var navigation =')){
          preparation=await browser.evaluate('('+trackPreparation.toString()+')()');
          console.log('Preparation',JSON.stringify(preparation));
        }
        if(!selection && spec.func.toString().includes('var SCROLL_TRIGGER_ZONE')){
          selection=nativeEdge?await selectNativeRightEdge(browser,dragEdge,outsideRight):await browser.evaluate('('+selectArea.toString()+')('+[overshoot,rightEdge,fromContent].join(',')+')');
          if(fromContent||nativeEdge)await browser.evaluate('window.__navExpected=[]');
          console.log('Selected',JSON.stringify(selection));
        }
        return [{result}];
      }}
    };
    context=vm.createContext({chrome,console,setTimeout,clearTimeout,setInterval,clearInterval,crypto:webcrypto});
    const readSource=file=>baseline?execFileSync('git',['show',baselineRef+':full-page-screenshot-extension/'+file],{cwd:root,encoding:'utf8',windowsHide:true}):fs.readFileSync(path.join(extension,file),'utf8');
    context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(readSource(file),context,{filename:file}));
    vm.runInContext(readSource('sw.js'),context,{filename:'sw.js'});
    await context.captureRecovery;
    // Normal, widget and editor starts all use the production controller.
    // Toolbar pixels are outside this capture-content diagnostic.
    context.getStopIconImageData=async()=>({});
    context.startControlledCapture(multi?null:1,mode,multi?{multi:true,sourceRequestTabId:editor?2:1}:undefined);
    await context.activeCaptureJob.done;
    assert.equal(context.activeCaptureJob,null,'The job unlocks after restoration');
    const restored=await browser.evaluate(`({control:!!window.__shotCaptureControl,
      stickyVisibility:(window.__testStickyElements||[]).every(rec=>!rec.el.isConnected||rec.el.style.visibility===rec.oldVis),
      styles:(window.__sidebarExpected||[]).every(rec=>rec.properties.every(prop=>rec.el.style.getPropertyValue(prop.name)===prop.value&&rec.el.style.getPropertyPriority(prop.name)===prop.priority)),
      height:document.documentElement.scrollHeight,remaining:document.querySelectorAll('[data-screenshot-area-pane],[data-screenshot-scroll],[data-screenshot-area-scroll]').length})`);
    assert.equal(restored.control,false);assert.equal(restored.styles,true,'Original sidebar styles and priorities restored');
    assert.equal(restored.stickyVisibility,true,'Original sticky visibility restored');
    if(site!=='yahoo')assert.equal(restored.height,initial.height,'Original document height restored');assert.equal(restored.remaining,0);
    if(independent||mobile||mode==='visible')assert.equal(preparation?.changed||0,0,'Independent/narrow/visible layout is not unfolded');
    else if(!site&&!baseline&&!release)assert(preparation?.changed>0,'Document navigation is unfolded before selection/capture');
    if(stop||failure){
      assert.equal(outputs.length,0,'Interrupted capture produces no file');
      if(multi)assert.deepEqual(session.multi.pieces,[previousPiece],'Interrupted Multi preserves old pieces');
      console.log('Restoration passed',JSON.stringify({stop,failure,restored}));return;
    }
    if(multi){
      assert.equal(outputs.length,0,'Multi does not download an ordinary image');
      assert.deepEqual(session.multi.pieces[0],previousPiece,'The previous piece is preserved');
      assert.equal(session.multi.pieces.length,2,'Multi adds exactly one piece');
      outputs.push(session.multi.pieces[1].img);
    }
    const label=(site|| (tailwind?'tailwind':live?'deepseek':independent?'independent':release?'release':'fixture'))+(multi?(editor?'-multi-editor':'-multi-widget'):'')+(mobile?'-mobile':'')+(dark?'-dark':'')+(baseline?'-baseline':'')+(overshoot?'-overshoot'+overshoot:'')+(rightEdge?'-right-edge':'')+(fromContent?'-from-content':'')+(nativeEdge?'-native-edge':'')+(dragEdge?'-drag':'')+(outsideRight?'-outside':'');
    assert.equal(outputs.length,1,'Area returns one complete PNG');
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-after.png'),Buffer.from(outputs[0].split(',')[1],'base64'));
    const pixels=await browser.evaluate('('+checkNavigationPixels.toString()+')('+JSON.stringify(outputs[0])+')');
    console.log('Pixel comparison',JSON.stringify(pixels));
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-diagnostic.json'),JSON.stringify({initial,preparation,selection,frames,compositions,messages,restored,pixels,outputs:outputs.length},null,2));
    assert.equal(pixels.seen,pixels.expected,'Every visible navigation item is present in the composed image');
    assert.equal(pixels.changed,0,'Composed navigation pixels match their captured source fragments');
    if(release&&mode==='area'){
      const rail=await browser.evaluate('('+checkReleasePixels.toString()+')('+JSON.stringify(outputs[0])+')');
      console.log('Released sidebar pixels',JSON.stringify(rail));
      assert(rail.railRows>=330&&rail.railRows<=340,'The complete 340px rail is present only once');
      assert(rail.railBottom<900,'The rail remains in its original first-screen location');
      assert(rail.barRows>=65&&rail.barRows<=70,'A genuine bottom bar is still captured once');
      assert(rail.barTop>=rail.height-75,'The genuine bottom bar stays at the image bottom');
    }
    if(independent&&mode==='area'){
      assert.equal(selection.area.panes.length,2,'Independent columns still use the dedicated Area engine');
      assert(frames.every(frame=>frame.y===0),'Document remains still while independent columns scroll');
    }
    console.log('Content and restoration passed',JSON.stringify({pixels,restored}));
    console.log('Saved diagnostic',label,'with',frames.length,'frames');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
