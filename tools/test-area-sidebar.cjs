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

function fixture(independent, release, ads) {
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
  if (ads) {
    document.querySelector('aside').remove();
    const rail=document.querySelector('.toc-wrap');rail.style.width='300px';
    rail.innerHTML='<div style="height:1670px"></div>'+
      ['rgb(187,66,77)','rgb(36,183,163)'].map((color,i)=>
        '<div style="height:1600px"><div class="ad-card" style="position:sticky;top:128px;height:532px;background:'+color+'">'+
        '<div data-ad-unit="local-'+i+'">TEST AD '+(i+1)+' — must remain complete</div></div></div>').join('');
    window.__testAds=[...document.querySelectorAll('.ad-card')].map((el,i)=>({el,color:[[187,66,77],[36,183,163]][i],top:el.getBoundingClientRect().top,height:532}));
  }
}

async function checkAdPixels(source, origin) {
  const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=no;im.src=source;});
  const c=document.createElement('canvas');c.width=im.width;c.height=im.height;
  const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const data=ctx.getImageData(0,0,c.width,c.height).data;
  return window.__testAds.map(rec=>{
    const rows=[];for(let y=0;y<c.height;y++){
      let count=0;for(let x=0;x<c.width;x++){const p=(y*c.width+x)*4;if(rec.color.every((value,i)=>data[p+i]===value))count++;}
      if(count>30)rows.push(y);
    }
    return {rows:rows.length,top:Math.min(...rows),bottom:Math.max(...rows),expectedTop:Math.round(rec.top-origin),expectedHeight:rec.height};
  });
}

function growthFixture(mode) {
  document.head.innerHTML = '<style>*{box-sizing:border-box}body{margin:0;font:16px Arial}section{height:400px;padding:60px}footer{height:200px;padding:60px;background:rgb(174,37,101)}</style>';
  document.body.innerHTML = '<main></main><footer>REAL END OF DOCUMENT</footer>';
  const state=window.__testGrowth={mode,batches:0,pending:false,blocks:[],events:[]};
  const colors=[[60,130,190],[180,160,45],[75,175,100],[185,80,130],[110,90,200],[45,165,175],[170,100,55]];
  function append(count){for(let j=0;j<count;j++){
    const color=colors[state.blocks.length%colors.length];state.blocks.push(color);
    const el=document.createElement('section');el.style.background='rgb('+color.join(',')+')';
    el.textContent='CONTENT BLOCK '+state.blocks.length;document.querySelector('main').appendChild(el);
  }}
  append(mode==='exact'?4:5);
  window.addEventListener('scroll',()=>{
    if(mode==='static'||mode==='exact'||state.pending||(mode!=='continuous'&&state.batches>=3)||scrollY+innerHeight<document.documentElement.scrollHeight-2)return;
    state.pending=true;state.events.push({type:'loading',at:performance.now(),height:document.documentElement.scrollHeight});
    const footer=document.querySelector('footer');
    if(mode!=='fast')footer.setAttribute('aria-busy','true');
    if(mode==='stalled')return;
    setTimeout(()=>{
      append(mode==='continuous'?8:[1,3,2][state.batches]);state.batches++;
      footer.removeAttribute('aria-busy');state.pending=false;
      state.events.push({type:'loaded',at:performance.now(),height:document.documentElement.scrollHeight});
    },mode==='slow'?2000:100);
  });
  scrollTo(0,0);
}

async function checkGrowthPixels(source, full, selected) {
  const img=new Image();await new Promise((yes,no)=>{img.onload=yes;img.onerror=no;img.src=source;});
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  const colors=window.__testGrowth.blocks,scale=devicePixelRatio;
  const pixels=ctx.getImageData(Math.round(10*scale),0,1,c.height).data;
  let wrong=0;
  if(full)for(let y=0;y<c.height;y++){
    const index=Math.floor((y+0.1)/scale/400);
    const color=index<colors.length?colors[index]:[174,37,101];
    if(color.some((v,k)=>pixels[y*4+k]!==v))wrong++;
  }
  return {wrong,height:img.height,expectedHeight:Math.round((full?document.documentElement.scrollHeight:selected.h_doc)*scale),
    batches:window.__testGrowth.batches,blocks:colors.length};
}

async function checkFinalRows(source, frameSource, frameY) {
  async function load(src){const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=no;im.src=src;});return im;}
  const [output,frame]=await Promise.all([load(source),load(frameSource)]);
  const physicalY=Math.round(frameY*devicePixelRatio),sourceEnd=Math.min(frame.height,output.height-physicalY);
  const rows=Math.min(128,sourceEnd),width=output.width;
  function pixels(img,sy){const c=document.createElement('canvas');c.width=width;c.height=rows;const ctx=c.getContext('2d');ctx.drawImage(img,0,sy,width,rows,0,0,width,rows);return ctx.getImageData(0,0,width,rows).data;}
  const a=pixels(output,output.height-rows),b=pixels(frame,sourceEnd-rows);let changed=0;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
  return {changed,rows,outputHeight:output.height,documentHeight:document.documentElement.scrollHeight};
}

function frameState() {
  const hud=document.getElementById('__shot_capture_progress');
  const list=window.__screenshotStickies||window.__screenshotHidden||[];
  window.__testStickyElements ||= [];
  const stickies=list.map(item=>{
    let id=window.__testStickyElements.findIndex(rec=>rec.el===item.el);
    if(id<0){id=window.__testStickyElements.length;window.__testStickyElements.push({el:item.el,oldVis:item.oldVis??item.oldVisibility});}
    const r=item.el.getBoundingClientRect(),css=getComputedStyle(item.el);
    return {id,name:item.el.id||item.el.tagName+'.'+item.el.className,left:r.left,top:r.top,bottom:r.bottom,width:r.width,height:r.height,position:css.position,
      visible:css.visibility==='visible'&&css.display!=='none'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight,
      hiddenByCapture:!!item.hiddenByCapture,repeat:!!item.hiddenAsRepeat,bottomGroup:!!item.bottomGroup};
  });
  const ads=(window.__testAdRoots||[]).map((el,index)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {index,top:r.top,height:r.height,position:s.position,visible:s.visibility==='visible'&&s.display!=='none'&&s.opacity!=='0',viewport:innerHeight};});
  return {y:scrollY,hudHidden:!hud||getComputedStyle(hud).display==='none'||getComputedStyle(hud).visibility==='hidden',stickies,ads,
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
  const scale=devicePixelRatio;
  const frameY=Math.round(scrollY*scale),outputY=Math.round(originY*scale),outputX=Math.round(originX*scale);
  const retainedTop=Math.max(0,(window.__navSampleCovered||0)-frameY);
  (window.__navExpected||[]).forEach((el,index)=>{
    const r=el.getBoundingClientRect();
    const x=Math.max(outputX,Math.ceil(r.left*scale)),y=Math.max(0,Math.ceil(r.top*scale),retainedTop);
    const w=Math.min(image.width,Math.floor(r.right*scale))-x,h=Math.min(image.height,Math.floor(r.bottom*scale))-y;
    if(w<=0||h<=0)return;
    window.__navPixelSamples.push({index,x:x-outputX,y:y+frameY-outputY,w,h,pixels:ctx.getImageData(x,y,w,h).data});
  });
  window.__navSampleCovered=frameY+image.height;
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
  const sites={mdn:'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position',css:'https://developer.mozilla.org/en-US/docs/Web/CSS',web:'https://developer.mozilla.org/en-US/docs/Web',wiki:'https://it.wikipedia.org/wiki/Pagina_principale',yahoo:'https://finance.yahoo.com/'};
  if(site&&!sites[site])throw Error('Unknown site '+site);
  const live = process.argv.includes('--live') || tailwind || !!site;
  const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--visible') ? 'visible' : 'area';
  const multi = process.argv.includes('--multi');
  const editor = process.argv.includes('--editor');
  const independent = process.argv.includes('--independent');
  const release = process.argv.includes('--release');
  const ads = process.argv.includes('--ads');
  const growth=(process.argv.find(arg=>arg.startsWith('--growth='))||'').slice(9);
  if(growth&&!['static','exact','fast','slow','continuous','stalled'].includes(growth))throw Error('Unknown growth fixture');
  const cold=process.argv.includes('--cold'),stopWait=process.argv.includes('--stop-wait');
  const overshoot=Number((process.argv.find(arg=>arg.startsWith('--overshoot='))||'').slice(12))||0;
  const rightEdge=process.argv.includes('--right-edge'),fromContent=process.argv.includes('--from-content');
  const dragEdge=process.argv.includes('--drag-edge'),outsideRight=process.argv.includes('--outside-right');
  const nativeEdge=process.argv.includes('--native-edge')||dragEdge;
  const stop = process.argv.includes('--stop'), failure = process.argv.includes('--failure');
  const compositionGap = process.argv.includes('--composition-gap');
  const mobile=process.argv.includes('--mobile'),dark=process.argv.includes('--dark');
  const zoomArg=process.argv.find(arg=>arg.startsWith('--zoom='));
  const zoom=zoomArg?Number(zoomArg.slice(7))/100:undefined;
  const refArg=process.argv.find(arg=>arg.startsWith('--ref='));
  const sourceRef=refArg?refArg.slice(6):baseline?baselineRef:null;
  const browser = await openBrowser(mobile?390:1920,zoomArg?911:900,zoomArg?{zoom}:{});
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
      if(!cold)await browser.evaluate(`(async()=>{const bottom=Math.min(45000,document.documentElement.scrollHeight);for(let y=0;y<bottom;y+=innerHeight){scrollTo(0,y);await new Promise(r=>setTimeout(r,100));}scrollTo(0,0);
        await Promise.race([Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,3000))]);return true;})()`);
      await browser.evaluate('document.fonts.ready.then(()=>true)'); await wait(1000);
    } else if(growth)await browser.evaluate('('+growthFixture.toString()+')('+JSON.stringify(growth)+')');
    else await browser.evaluate('('+fixture.toString()+')('+independent+','+release+','+ads+')');
    if(zoomArg)assert(Math.abs(await browser.evaluate('devicePixelRatio')-zoom)<0.001,'Actual browser zoom matches the requested value');
    const initial = await browser.evaluate(`({url:location.href,title:document.title,y:scrollY,height:document.documentElement.scrollHeight,inner:innerHeight,dpr:devicePixelRatio,visualHeight:visualViewport.height,
      scrollers:[...document.querySelectorAll('*')].filter(el=>/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+10).map(el=>({
        tag:el.tagName,cls:el.className,position:getComputedStyle(el).position,rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
        first:el.innerText?.slice(0,80),last:el.innerText?.slice(-100)}))})`);
    if(site==='yahoo')initial.stickyDetails=await browser.evaluate(`([...document.querySelectorAll('*')].filter(el=>getComputedStyle(el).position==='sticky').map(el=>({
      name:el.tagName+'.'+el.className,rect:el.getBoundingClientRect().toJSON(),html:el.outerHTML.slice(0,650),
      ancestors:(()=>{const a=[];let p=el.parentElement;for(let i=0;p&&i<5;i++,p=p.parentElement)a.push({tag:p.tagName,cls:p.className,role:p.getAttribute('role'),position:getComputedStyle(p).position,overflow:getComputedStyle(p).overflowY,rect:p.getBoundingClientRect().toJSON()});return a;})()
    })))`);
    if(site==='yahoo')initial.adRoots=await browser.evaluate(`(()=>{window.__testAdRoots=[...document.querySelectorAll('*')].filter(el=>getComputedStyle(el).position==='sticky'&&el.querySelector('[data-ad-unit]')&&!el.closest('[role="dialog"]')&&el.getBoundingClientRect().height<=innerHeight+2);return window.__testAdRoots.length;})()`);
    console.log('Initial',JSON.stringify(initial));
    const event=()=>({addListener(){}});
    const storage=data=>({async get(keys){const result={};for(const key of Array.isArray(keys)?keys:[keys])if(key in data)result[key]=clone(data[key]);return result;},
      async set(values){Object.assign(data,clone(values));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete data[key];}});
    const frames=[],outputs=[],messages=[],compositions=[],measurements=[];let selection=null,context,preparation=null,adPreparation=null,stopWaitAt=0,lastFrameSource=null;
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
          lastFrameSource='data:image/png;base64,'+image.data;
          await browser.evaluate('('+sampleNavigation.toString()+')('+JSON.stringify('data:image/png;base64,'+image.data)+','+(selection?.area?.x||0)+','+(selection?.area?.y_doc||0)+')');
          return 'data:image/png;base64,'+image.data;
        }},
      downloads:{download:async args=>{outputs.push(args.url);return outputs.length;}},
      scripting:{executeScript:async spec=>{
        const documentMeasurement=spec.func.toString().includes('quietSince = started');
        if(documentMeasurement&&spec.args[1].wait&&stopWait&&!stopWaitAt&&await browser.evaluate('scrollY+innerHeight>=document.documentElement.scrollHeight-2')){
          setTimeout(()=>{stopWaitAt=Date.now();context.cancelCapture();},200);
        }
        if(spec.func.toString().includes('function(imgs, pw, ph, viewH')){
          if(compositionGap){spec.args[0].splice(2,1);spec.args[8].splice(2,1);}
          const comp={mode:'full',frames:spec.args[0].length,height:spec.args[2],scrolls:spec.args[8]};
          compositions.push(comp);console.log('Full composition',JSON.stringify(comp));
        }
        if(spec.func.toString().includes('function(imgs, ax, aw, ah_doc')){
          // Deliberately omit a source frame: the real composer must refuse the
          // incomplete image, and the real controller must restore Multi state.
          if(compositionGap){spec.args[0].splice(2,1);spec.args[8].splice(2,1);spec.args[9].splice(2,1);}
          const bytes=Buffer.from(spec.args[0][0].split(',')[1],'base64');
          const comp={frames:spec.args[0].length,width:spec.args[2],height:spec.args[3],viewportHeight:spec.args[4],dpr:spec.args[5],scrolls:spec.args[9],selectedY:spec.args[15],
            screenshotWidth:bytes.readUInt32BE(16),screenshotHeight:bytes.readUInt32BE(20),unfolded:spec.args[14]};
          compositions.push(comp);console.log('Area composition',JSON.stringify(comp));
          if(zoomArg)fs.writeFileSync(path.join(outputDir,'area-zoom-'+Math.round(zoom*100)+'-composition'+(sourceRef?'-ref':'')+'.json'),JSON.stringify(comp,null,2));
        }
        const result=await browser.evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args||[])+')');
        if(documentMeasurement){measurements.push({...result,wait:spec.args[1].wait});console.log('Document measurement',JSON.stringify(result));}
        if(spec.func.toString().includes('var navigation =')){
          preparation=await browser.evaluate('('+trackPreparation.toString()+')()');
          console.log('Preparation',JSON.stringify(preparation));
        }
        if(spec.func.toString().includes('var adMarkers =')){
          const adsState=await browser.evaluate(`(()=>{const state=window.__shotCaptureControl?.adStickies;window.__adsExpected=state?.changes||[];
            const roots=window.__adsExpected.map(rec=>rec.el),initialCovered=(window.__testAdRoots||[]).every(el=>roots.includes(el));
            if(window.__testAdRoots)window.__testAdRoots=roots;
            return {changed:roots.length,initialCovered,roots:roots.map(el=>({name:el.className,rect:el.getBoundingClientRect().toJSON()}))};})()`);
          adPreparation=adsState;
          console.log('Ad preparation',JSON.stringify(adsState));
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
    const readSource=file=>sourceRef?execFileSync('git',['show',sourceRef+':full-page-screenshot-extension/'+file],{cwd:root,encoding:'utf8',windowsHide:true}):fs.readFileSync(path.join(extension,file),'utf8');
    context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(readSource(file),context,{filename:file}));
    vm.runInContext(readSource('sw.js'),context,{filename:'sw.js'});
    await context.captureRecovery;
    // Normal, widget and editor starts all use the production controller.
    // Toolbar pixels are outside this capture-content diagnostic.
    context.getStopIconImageData=async()=>({});
    context.startControlledCapture(multi?null:1,mode,multi?{multi:true,sourceRequestTabId:editor?2:1}:undefined);
    await context.activeCaptureJob.done;
    const cancelMs=stopWaitAt?Date.now()-stopWaitAt:null;
    assert.equal(context.activeCaptureJob,null,'The job unlocks after restoration');
    const restored=await browser.evaluate(`({control:!!window.__shotCaptureControl,
      stickyVisibility:(window.__testStickyElements||[]).every(rec=>!rec.el.isConnected||rec.el.style.visibility===rec.oldVis),
      styles:(window.__sidebarExpected||[]).every(rec=>rec.properties.every(prop=>rec.el.style.getPropertyValue(prop.name)===prop.value&&rec.el.style.getPropertyPriority(prop.name)===prop.priority)),
      adsStyles:(window.__adsExpected||[]).every(rec=>rec.properties.every(prop=>rec.el.style.getPropertyValue(prop.name)===prop.value&&rec.el.style.getPropertyPriority(prop.name)===prop.priority)),
      height:document.documentElement.scrollHeight,remaining:document.querySelectorAll('[data-screenshot-area-pane],[data-screenshot-scroll],[data-screenshot-area-scroll]').length})`);
    assert.equal(restored.control,false);assert.equal(restored.styles,true,'Original sidebar styles and priorities restored');
    assert.equal(restored.adsStyles,true,'Original advertisement positions and priorities restored');
    assert.equal(restored.stickyVisibility,true,'Original sticky visibility restored');
    if(site!=='yahoo'&&!growth)assert.equal(restored.height,initial.height,'Original document height restored');assert.equal(restored.remaining,0);
    if(independent||mobile||mode==='visible')assert.equal(preparation?.changed||0,0,'Independent/narrow/visible layout is not unfolded');
    else if(!live&&!baseline&&!release&&!ads&&!growth)assert(preparation?.changed>0,'The local long document navigation is unfolded before selection/capture');
    const growthLimit=mode==='full'&&['continuous','stalled'].includes(growth);
    if(stop||failure||compositionGap||stopWait||growthLimit){
      assert.equal(outputs.length,0,'Interrupted capture produces no file');
      if(multi)assert.deepEqual(session.multi.pieces,[previousPiece],'Interrupted Multi preserves old pieces');
      if(compositionGap){
        assert(JSON.stringify(messages).includes('The page moved during capture'),'The actual composition error reaches the UI');
        assert(!JSON.stringify(messages).includes('Image too large'),'A missing frame is not called an oversized image');
      }
      if(stopWait){assert(stopWaitAt,'Stop reached the actual bottom wait');assert(cancelMs<2000,'Stop interrupts the wait promptly');assert(!messages.some(m=>m.type==='error'),'Stop is not reported as a loading error');}
      if(growthLimit&&!stopWait)assert(messages.some(m=>m.type==='error'&&/keeps adding|keeps changing|still loading/.test(m.message)),'Bounded growth reports a clear error');
      const result={stop,failure,compositionGap,stopWait,cancelMs,growth,measurements,restored,messages};
      fs.writeFileSync(path.join(outputDir,'growth-'+growth+'-'+mode+(multi?editor?'-multi-editor':'-multi-widget':'')+(stopWait?'-stop-wait':'')+'-result.json'),JSON.stringify(result,null,2));
      console.log('Restoration passed',JSON.stringify(result));return;
    }
    if(multi){
      assert.equal(outputs.length,0,'Multi does not download an ordinary image');
      assert.deepEqual(session.multi.pieces[0],previousPiece,'The previous piece is preserved');
      assert.equal(session.multi.pieces.length,2,'Multi adds exactly one piece');
      outputs.push(session.multi.pieces[1].img);
    }
    const label=(site|| (tailwind?'tailwind':live?'deepseek':growth?'growth-'+growth:independent?'independent':release?'release':ads?'ads':'fixture'))+(cold?'-cold':'')+(multi?(editor?'-multi-editor':'-multi-widget'):'')+(mobile?'-mobile':'')+(dark?'-dark':'')+(baseline?'-baseline':'')+(refArg?'-ref-'+sourceRef:'')+(zoomArg?'-zoom'+Math.round(zoom*100):'')+(overshoot?'-overshoot'+overshoot:'')+(rightEdge?'-right-edge':'')+(fromContent?'-from-content':'')+(nativeEdge?'-native-edge':'')+(dragEdge?'-drag':'')+(outsideRight?'-outside':'');
    assert.equal(outputs.length,1,'Area returns one complete PNG');
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-after.png'),Buffer.from(outputs[0].split(',')[1],'base64'));
    const pixels=await browser.evaluate('('+checkNavigationPixels.toString()+')('+JSON.stringify(outputs[0])+')');
    console.log('Pixel comparison',JSON.stringify(pixels));
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-diagnostic.json'),JSON.stringify({initial,preparation,adPreparation,selection,frames,compositions,measurements,messages,restored,pixels,outputs:outputs.length},null,2));
    assert.equal(pixels.seen,pixels.expected,'Every visible navigation item is present in the composed image');
    assert.equal(pixels.changed,0,'Composed navigation pixels match their captured source fragments');
    if(mode==='full'&&!independent){
      const bottom=await browser.evaluate('('+checkFinalRows.toString()+')('+JSON.stringify(outputs[0])+','+JSON.stringify(lastFrameSource)+','+frames.at(-1).y+')');
      bottom.capturedDocumentHeight=measurements.at(-1)?.height;
      console.log('Final rows',JSON.stringify(bottom));
      assert(bottom.rows>0&&bottom.changed===0,'Bottom output pixels match the final captured frame');
      // Restoring the original navigation can change document height again.
      // Compare against the document actually captured, not its restored layout.
      if(bottom.capturedDocumentHeight)assert(Math.abs(bottom.outputHeight-bottom.capturedDocumentHeight*(zoom||1))<=2,'The document bottom measured during capture is included');
    }
    if(growth){
      const checked=await browser.evaluate('('+checkGrowthPixels.toString()+')('+JSON.stringify(outputs[0])+','+(mode==='full')+','+JSON.stringify(selection?.area||null)+')');
      console.log('Growth pixels',JSON.stringify(checked));
      assert(Math.abs(checked.height-checked.expectedHeight)<=1,'Output reaches the actual end (Full) or selected bound (Area)');
      if(mode==='full'){
        assert.equal(checked.wrong,0,'Every colored document row and footer are present, once, in order');
        assert.equal(checked.batches,['static','exact'].includes(growth)?0:3,'All finite loading waves were captured');
        if(growth==='exact')assert.equal(checked.height,checked.expectedHeight,'Even the final reachable physical pixel is captured');
        const waits=measurements.filter(m=>m.wait&&m.waited>20);
        if(growth==='static'){assert.equal(waits.length,1,'Static page waits only at its end');assert(waits[0].waited<1000,'Static final check is short');}
        if(growth==='slow')assert(waits.some(m=>m.waited>=1000),'Slow loading actually exercised the longer wait');
      }
    }
    if(site==='yahoo'&&!sourceRef&&mode!=='visible'){
      assert(adPreparation?.changed>0,'Live Yahoo supplied sticky advertisement cards to exercise');
      assert(adPreparation.initialCovered,'All initially observed eligible ad roots were prepared, including before cold-load additions');
      const coverage=Array.from({length:adPreparation.changed},(_,index)=>{
        const samples=frames.flatMap(frame=>frame.ads.filter(ad=>ad.index===index&&ad.visible&&ad.top<ad.viewport&&ad.top+ad.height>0).map(ad=>({...ad,y:frame.y})));
        const rows=new Set();let expected=0;const positions=[];
        for(const ad of samples){
          expected=Math.max(expected,Math.floor(ad.height));positions.push(ad.top+ad.y);
          for(let y=Math.ceil(Math.max(0,-ad.top));y<Math.floor(Math.min(ad.height,ad.viewport-ad.top));y++)rows.add(y);
        }
        return {index,expected,covered:rows.size,drift:Math.max(...positions)-Math.min(...positions)};
      });
      console.log('Live ad coverage',JSON.stringify(coverage));
      for(const ad of coverage){assert(ad.expected>0&&ad.covered>=ad.expected-1,'Ad bottom is captured, not hidden as a duplicate: '+JSON.stringify(ad));assert(ad.drift<1,'Prepared ad keeps its document position');}
    }
    if(ads){
      const cards=await browser.evaluate('('+checkAdPixels.toString()+')('+JSON.stringify(outputs[0])+','+(selection?.area?.y_doc||0)+')');
      console.log('Ad cards',JSON.stringify(cards));
      for(const card of cards){
        assert.equal(card.rows,card.expectedHeight,'Every advertisement row is present exactly once');
        assert.equal(card.top,card.expectedTop,'Advertisement stays in its original document position');
        assert.equal(card.bottom-card.top+1,card.rows,'Advertisement has no split or gaps');
      }
    }
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
