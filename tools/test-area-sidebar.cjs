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

function chatAreaFixture(documentScroll) {
  const dark=matchMedia('(prefers-color-scheme: dark)').matches;
  document.head.innerHTML='<style>*{box-sizing:border-box}html,body{margin:0;height:100%;'+(documentScroll?'':'overflow:hidden;')+'}body{background:'+(dark?'#141923':'#fff')+';font:16px Arial}header{height:50px;background:#dce9f3;padding:15px}.chat-app{position:relative;height:calc(100vh - 50px)}.thread{height:100%;overflow:auto;scroll-behavior:smooth}.messages{padding-bottom:100px}.message{height:80px;padding:30px}.composer{position:absolute;bottom:0;left:0;width:100%;height:100px;background:rgb(113,51,199);padding:15px;z-index:3}.composer form{visibility:visible;height:60px;max-width:800px;margin:auto;background:#fff;border-radius:20px;padding:15px}textarea{height:30px;max-width:100%;resize:none}@media(max-width:500px){.composer{padding:15px 30px}}</style>';
  if(documentScroll)document.head.innerHTML+='<style>.chat-app{height:auto}.thread{height:auto;overflow:visible}.composer{position:fixed}</style>';
  document.body.innerHTML='<header>LOCAL CHAT — no account</header><main class="chat-app"><div class="thread"><div class="messages">'+Array.from({length:60},(_,i)=>'<section class="message" style="background:rgb('+(i%2?'180,220,240':'240,220,180')+')">MESSAGE '+i+'</section>').join('')+'</div></div><div class="composer"><form><textarea aria-label="Write a message">Write a message</textarea></form></div></main>';
  const pane=document.querySelector('.thread');
  (documentScroll?window:pane).scrollTo({top:640,behavior:'instant'});
  window.__chatInitial={documentScroll,y:documentScroll?scrollY:pane.scrollTop,style:document.querySelector('.composer').getAttribute('style')};
}

function selectChatArea(short) {
  const overlay=document.getElementById('__screenshot_area_overlay');
  const x=18,right=innerWidth-2,start=140;
  const mouse=(type,mx,my)=>overlay.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:mx,clientY:my,buttons:type==='mouseup'?0:1}));
  mouse('mousemove',x,start);mouse('mousedown',x,start);mouse('mousemove',right,350);
  if(!short)overlay.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:right,clientY:350,deltaY:100000}));
  mouse('mousemove',right,short?390:innerHeight-1);mouse('mouseup',right,short?390:innerHeight-1);
  return {area:window.__screenshotArea};
}

async function checkChatArea(source,area) {
  const img=new Image();await new Promise((yes,no)=>{img.onload=yes;img.onerror=no;img.src=source;});
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  const p=ctx.getImageData(2,0,1,c.height).data;let barRows=0,wrong=0;
  const k=devicePixelRatio,origin=area.y_doc-50;
  for(let y=0;y<c.height;y++){
    const a=y*4,isBar=p[a]===113&&p[a+1]===51&&p[a+2]===199;
    if(isBar){barRows++;continue;}
    const contentY=origin+(y+.5)/k;
    if(contentY>=4800)continue;
    const color=Math.floor(contentY/80)%2?[180,220,240]:[240,220,180];
    if(color.some((v,i)=>p[a+i]!==v)||p[a+3]!==255)wrong++;
  }
  const pane=document.querySelector('.thread'),initial=window.__chatInitial;
  return {width:c.width,height:c.height,barRows,wrong,scroll:initial.documentScroll?scrollY:pane.scrollTop,initial:initial.y,
    style:(document.querySelector('.composer').getAttribute('style')||'')===(initial.style||'')};
}

function internalEndFixture() {
  const dark=matchMedia('(prefers-color-scheme: dark)').matches;
  document.head.innerHTML='<style>*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;background:'+(dark?'#141923':'#fff')+';font:16px Arial}header{height:60px;background:rgb(226,237,245);padding:18px}.app{display:flex;height:calc(100vh - 60px)}aside{width:180px;flex:none;overflow:auto}main{flex:1;min-width:0;overflow:auto}section{height:80px;padding:20px}.right{width:140px}nav div{height:70px;padding:20px}@media(max-width:500px){aside{width:80px}.right{width:70px}}</style>';
  const colors=['rgb(60,130,190)','rgb(180,160,45)','rgb(75,175,100)','rgb(185,80,130)','rgb(110,90,200)','rgb(45,165,175)'];
  function rail(id,offset){return '<aside id="'+id+'"'+(offset?' class="right"':'')+'><nav>'+Array.from({length:50},(_,i)=>'<div style="background:rgb('+(offset?200:40)+','+(80+(i%8)*15)+','+(offset?40:200)+')">RAIL '+i+'</div>').join('')+'</nav></aside>';}
  document.body.innerHTML='<header>APP HEADER</header><div class="app">'+rail('left-pane',0)+'<main id="main-pane">'+Array.from({length:60},(_,i)=>'<section style="background:'+colors[i%6]+'">CONTENT '+i+'</section>').join('')+'</main>'+rail('right-pane',1)+'</div>';
  document.getElementById('left-pane').scrollTop=420;
  document.getElementById('right-pane').scrollTop=280;
  document.getElementById('main-pane').scrollTop=1100;
  window.__internalInitial=[...document.querySelectorAll('aside,main')].map(el=>({el,y:el.scrollTop,style:el.getAttribute('style')}));
}

async function checkInternalEndPixels(source, reference, endY, screenEnd) {
  async function load(src){const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=no;im.src=src;});return im;}
  const [image,endView]=await Promise.all([load(source),load(reference)]);
  const scale=devicePixelRatio,r=document.getElementById('main-pane').getBoundingClientRect();
  const left=Math.round(r.left*scale),right=Math.round(r.right*scale),top=Math.round(r.top*scale);
  const expectedHeight=top+Math.round(endY*scale),cut=Math.round(screenEnd*scale),dest=expectedHeight-cut;
  function pixels(im){const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
  const a=pixels(image),b=pixels(endView),colors=[[60,130,190],[180,160,45],[75,175,100],[185,80,130],[110,90,200],[45,165,175]];
  let mainWrong=0,railsWrong=0,earlyRailWrong=0;
  for(let y=top;y<image.height;y++){
    const color=colors[Math.floor((y-top+0.1)/scale/80)%6],p=(y*image.width+left+Math.min(8,right-left-1))*4;
    if(color.some((v,k)=>a[p+k]!==v)||a[p+3]!==255)mainWrong++;
    for(let x=0;x<image.width;x++){
      if(x>=left&&x<right)continue;
      const at=(y*image.width+x)*4;
      if(y>=dest+top){const from=((y-dest)*endView.width+x)*4;if([0,1,2,3].some(k=>a[at+k]!==b[from+k]))railsWrong++;}
      else if(y<dest+top){const expected=matchMedia('(prefers-color-scheme: dark)').matches?[20,25,35]:[255,255,255];if(expected.some((v,k)=>a[at+k]!==v)||a[at+3]!==255)earlyRailWrong++;}
    }
  }
  return {width:image.width,height:image.height,expectedHeight,mainWrong,railsWrong,earlyRailWrong};
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
  const endLine=document.getElementById('__shot_end_line');
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
  return {y:scrollY,hudHidden:!hud||getComputedStyle(hud).display==='none'||getComputedStyle(hud).visibility==='hidden',
    endLineHidden:!endLine||getComputedStyle(endLine).display==='none'||getComputedStyle(endLine).visibility==='hidden',stickies,ads,
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

function modalFixture(kind) {
  document.head.innerHTML = '<style>*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}#wizard{position:fixed;inset:0;margin:0;border:0;padding:0;width:100vw;height:100vh;max-width:none;max-height:none;background:white;transform:translateZ(0);z-index:2147483647}#wizard h1{height:90px;margin:0;padding:24px}#wizard-content{height:calc(100vh - 90px);overflow:auto;outline:none}#wizard-content section{height:320px;padding:50px}::backdrop{background:rgba(0,0,0,.4)}</style>';
  document.body.innerHTML = '<main inert>Background app — must not be changed</main>';
  const wizard=document.createElement(kind==='dialog'?'dialog':'div');wizard.id='wizard';
  wizard.setAttribute('role','dialog');wizard.setAttribute('aria-modal','true');
  wizard.innerHTML='<h1>Database wizard — local test only</h1><div id="wizard-content">'+
    Array.from({length:6},(_,i)=>'<section style="background:rgb('+(i%2?'180,220,240':'240,220,180')+')">STEP '+(i+1)+'</section>').join('')+'</div>';
  document.body.appendChild(wizard);
  if(kind==='custom') {
    // Mirror libraries such as Radix: body blocks outside pointer events;
    // clicks outside the dialog would dismiss it. Do not unlock the body.
    document.body.style.pointerEvents='none';wizard.style.pointerEvents='auto';
    document.addEventListener('pointerdown',event=>{
      if(!wizard.contains(event.target))wizard.remove();
    },true);
  }
  if(kind==='dialog')wizard.showModal();
  if(kind==='popover'){wizard.setAttribute('popover','manual');wizard.showPopover();}
  window.__modalOriginal=wizard.getAttribute('style');
  window.__modalBodyStyle=document.body.getAttribute('style');
}

async function selectPricingArea(browser, inside) {
  const dialog=await browser.evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');window.__pricingDialog=d;window.__pricingBodyStyle=document.body.getAttribute('style');const r=d.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
  const margin=inside?-12:12;
  // Headless input outside the emulated viewport does not deliver a release.
  // Select only the visible portion on narrow layouts, as a real user can.
  const start={x:Math.max(1,Math.min(dialog.width-2,dialog.left-margin)),y:Math.max(1,Math.min(dialog.height-2,dialog.top-margin))};
  const end={x:Math.max(1,Math.min(dialog.width-2,dialog.right+margin)),y:Math.max(1,Math.min(dialog.height-2,dialog.bottom+margin))};
  console.log('Pricing drag bounds',JSON.stringify({dialog,start,end}));
  for(const [type,point,buttons] of [['mouseMoved',start,0],['mousePressed',start,1],['mouseMoved',end,1]]) {
    await browser.cdp('Input.dispatchMouseEvent',{type,...point,buttons,button:type==='mousePressed'?'left':'none',clickCount:1});
  }
  assert.equal(await browser.evaluate('document.getElementById("__screenshot_area_overlay")?.firstElementChild.style.display'),'block','The real pricing popup permits drawing the rectangle');
  assert(await browser.evaluate('window.__pricingDialog.isConnected'),'Selection does not dismiss the real pricing popup');
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',clickCount:1});
  const selection=await browser.evaluate('({area:window.__screenshotArea})');
  assert(selection.area,'Real release produces an Area selection on pricing');
  return selection;
}

async function selectModalArea(browser, cancelSelection) {
  const right=await browser.evaluate('Math.min(800,innerWidth-40)');
  for(const [type,x,y,buttons] of [['mouseMoved',100,180,0],['mousePressed',100,180,1],['mouseMoved',right,450,1]]) {
    await browser.cdp('Input.dispatchMouseEvent',{type,x,y,buttons,button:type==='mousePressed'?'left':'none',clickCount:1});
  }
  const box=await browser.evaluate(`(()=>{const o=document.getElementById('__screenshot_area_overlay');return {display:o?.firstElementChild.style.display,hit:document.elementFromPoint(Math.min(200,innerWidth-40),300)?.id};})()`);
  assert.equal(box.display,'block','Real mouse draws the selection rectangle over the modal');
  assert.equal(box.hit,'__screenshot_area_overlay','The overlay receives real mouse events');
  if(cancelSelection){await cancelSelection();return {cancelled:true};}
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:right,y:450,deltaX:0,deltaY:100000});
  await wait(120);
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:right,y:750,buttons:1});
  await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:right,y:750,button:'left',clickCount:1});
  const selected=await browser.evaluate('({area:window.__screenshotArea})');
  assert(selected.area,'Real mouse release completes selection over the modal');
  assert.equal(await browser.evaluate("!!document.getElementById('__screenshot_area_overlay')"),false,'Release removes the selection layer');
  return selected;
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
  const sites={mdn:'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/position',css:'https://developer.mozilla.org/en-US/docs/Web/CSS',web:'https://developer.mozilla.org/en-US/docs/Web',wiki:'https://it.wikipedia.org/wiki/Pagina_principale',yahoo:'https://finance.yahoo.com/',pricing:'https://www.aitarot.pro/it/pricing'};
  if(site&&!sites[site])throw Error('Unknown site '+site);
  const live = process.argv.includes('--live') || tailwind || !!site;
  const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--visible') ? 'visible' : 'area';
  const chat=process.argv.includes('--chat'),chatDocument=process.argv.includes('--chat-document'),chatShort=process.argv.includes('--chat-short');
  const startScrolled=process.argv.includes('--start-scrolled');
  if(chat&&(mode!=='area'||live))throw Error('--chat requires local Area capture');
  const multi = process.argv.includes('--multi');
  const editor = process.argv.includes('--editor');
  const endLineInternal = process.argv.includes('--end-line-internal');
  const endLineShort = process.argv.includes('--end-line-short');
  const endLineStale = process.argv.includes('--end-line-stale');
  const independent = process.argv.includes('--independent') || endLineInternal;
  const release = process.argv.includes('--release');
  const ads = process.argv.includes('--ads');
  const modal=(process.argv.find(arg=>arg.startsWith('--modal='))||'').slice(8);
  if(modal&&!['dialog','custom','popover'].includes(modal))throw Error('Unknown modal fixture');
  const growth=(process.argv.find(arg=>arg.startsWith('--growth='))||'').slice(9);
  if(growth&&!['static','exact','fast','slow','continuous','stalled'].includes(growth))throw Error('Unknown growth fixture');
  const endLine=process.argv.includes('--end-line');
  const endLineMdn=process.argv.includes('--end-line-mdn');
  const endLineButton=process.argv.includes('--end-line-button');
  const endLineDrag=process.argv.includes('--end-line-drag');
  const endLineAnchor=process.argv.includes('--end-line-anchor');
  if((endLine||endLineMdn)&&(mode!=='full'||(growth!=='static'&&!(endLineMdn&&site==='mdn')&&!endLineInternal)))throw Error('End-line fixture requires --full --growth=static, --end-line-internal, or --full --site=mdn --end-line-mdn');
  if(endLineInternal&&(!endLine||live||growth))throw Error('Internal end-line fixture requires --full --end-line without a live site or growth fixture');
  if((endLineShort||endLineStale)&&!endLineInternal)throw Error('Short/stale line checks require --end-line-internal');
  if(endLineShort&&endLineDrag)throw Error('Short and drag checks are separate cases');
  if(endLineMdn&&!endLine)throw Error('--end-line-mdn also requires --end-line');
  if((endLineButton||endLineDrag||endLineAnchor)&&!endLine)throw Error('End-line interactions require --end-line');
  const cold=process.argv.includes('--cold'),stopWait=process.argv.includes('--stop-wait');
  const overshoot=Number((process.argv.find(arg=>arg.startsWith('--overshoot='))||'').slice(12))||0;
  const rightEdge=process.argv.includes('--right-edge'),fromContent=process.argv.includes('--from-content');
  const dragEdge=process.argv.includes('--drag-edge'),outsideRight=process.argv.includes('--outside-right');
  const nativeEdge=process.argv.includes('--native-edge')||dragEdge;
  const escapeSelection=process.argv.includes('--escape-selection');
  const stopSelection=process.argv.includes('--stop-selection')||escapeSelection;
  if(stopSelection&&(!modal||mode!=='area'))throw Error('--stop-selection requires Area --modal');
  const stop = process.argv.includes('--stop')||stopSelection, failure = process.argv.includes('--failure');
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
      if(site==='pricing') {
        assert(await browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Ottieni Plus$/i.test(b.innerText.trim()));if(!b)return false;b.click();return true;})()`),'The public pricing button opens login, without an account or payment');
        await wait(600);
        assert(await browser.evaluate('!!document.querySelector("[role=dialog]")'),'The real pricing login popup is open');
        await browser.evaluate('window.__pricingDialog=document.querySelector("[role=dialog]");window.__pricingBodyStyle=document.body.getAttribute("style");true');
      }
    } else if(chat)await browser.evaluate('('+chatAreaFixture.toString()+')('+chatDocument+')');
    else if(endLineInternal)await browser.evaluate('('+internalEndFixture.toString()+')()');
    else if(modal)await browser.evaluate('('+modalFixture.toString()+')('+JSON.stringify(modal)+')');
    else if(growth)await browser.evaluate('('+growthFixture.toString()+')('+JSON.stringify(growth)+')');
    else await browser.evaluate('('+fixture.toString()+')('+independent+','+release+','+ads+')');
    if(startScrolled)await browser.evaluate('(()=>{const pane=[...document.querySelectorAll("*")].find(el=>getComputedStyle(el).overflowY==="auto"&&el.scrollHeight>el.clientHeight+640);window.__startedPane=pane||null;(pane||window).scrollTo({top:640,behavior:"instant"});return true;})()');
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
    const frames=[],outputs=[],messages=[],compositions=[],measurements=[];let selection=null,context,preparation=null,adPreparation=null,stopWaitAt=0,lastFrameSource=null,endLineY=null,endLineScreenY=null,endViewSource=null;
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
          if(endLine)assert(state.endLineHidden,'The end line is excluded from every captured frame');
          frames.push(state);console.log('Frame',frames.length,'page scroll',state.y);
          if(frames.length===2&&failure)throw Error('Intentional capture failure for restoration check');
          if(frames.length===(site==='pricing'?1:2)&&stop)context.cancelCapture();
          const image=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
          lastFrameSource='data:image/png;base64,'+image.data;
          if(endLineInternal&&frames.length===1)endViewSource=lastFrameSource;
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
          if(endLineMdn){
            const aligned=await browser.evaluate('({expected:window.__endLineNavTop,actual:window.__endLineNavTarget?.getBoundingClientRect().top,scrollTop:document.querySelector(".layout__left-sidebar")?.scrollTop})');
            console.log('End-line sidebar alignment',JSON.stringify(aligned));
            assert(Math.abs(aligned.actual-aligned.expected)<=3,'Sidebar content remains aligned to the chosen end');
          }
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
          const cancelModalSelection=stopSelection?async()=>{
            if(escapeSelection){
              // Bridge just this cancel request to the worker adapter; the
              // production key listener still handles the real browser key.
              await browser.evaluate('window.chrome={runtime:{sendMessage:async m=>{window.__escapeRequest=m;return {cancelled:true}}}};true');
              await browser.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
              await browser.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
              assert.deepEqual(await browser.evaluate('window.__escapeRequest'),{action:'cancelCapture',jobId:context.activeCaptureJob.id},'Escape requests cancellation of this job, rather than closing the native dialog');
            }
            assert(context.cancelCapture(),'Stop cancels a live modal selection');await wait(100);
            assert.equal(await browser.evaluate("!!document.getElementById('__screenshot_area_overlay')"),false,'Stop removes the top-layer overlay before any shot');
          }:null;
          selection=chat?await browser.evaluate('('+selectChatArea.toString()+')('+chatShort+')'):site==='pricing'?await selectPricingArea(browser,process.argv.includes('--popup-inside')):modal?await selectModalArea(browser,cancelModalSelection):nativeEdge?await selectNativeRightEdge(browser,dragEdge,outsideRight):await browser.evaluate('('+selectArea.toString()+')('+[overshoot,rightEdge,fromContent].join(',')+')');
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
    if(endLine){
      await browser.evaluate('window.chrome={runtime:{id:"test-extension",sendMessage:async m=>{(window.__endLineMessages||=[]).push(m);return {armed:true,started:true}}}};true');
      await browser.evaluate(readSource('end-line.js'));
      if(endLineMdn){
        await browser.evaluate(`(()=>{scrollTo(0,1800);const aside=document.querySelector('.layout__left-sidebar');
          const position=[...aside.querySelectorAll('a')].find(a=>a.textContent.trim()==='position');
          if(!position)throw Error('MDN position link is missing');
          aside.scrollTop+=position.getBoundingClientRect().top-350;
          if(Math.abs(position.getBoundingClientRect().top-350)>3)throw Error('Could not position the independent MDN sidebar');
          const target=[...aside.querySelectorAll('a')].filter(a=>{const r=a.getBoundingClientRect();return r.top>0&&r.bottom<innerHeight})
            .sort((a,b)=>Math.abs((a.getBoundingClientRect().top+a.getBoundingClientRect().bottom)/2-650)-
              Math.abs((b.getBoundingClientRect().top+b.getBoundingClientRect().bottom)/2-650))[0];
          if(!target)throw Error('No visible sidebar link for end-line check');
          window.__endLineNavTarget=target;window.__endLineNavTop=target.getBoundingClientRect().top;
          window.__endLineNavScroll=aside.scrollTop;return true;})()`);
      }else if(!endLineInternal)await browser.evaluate('scrollTo(0,900);true');
      if(endLineShort)await browser.evaluate('document.getElementById("main-pane").scrollTop=0;window.__internalInitial.find(rec=>rec.el.id==="main-pane").y=0;true');
      const pickY=endLineShort?350:650;
      const pickX=process.argv.includes('--end-line-sidebar')?10:endLineInternal?await browser.evaluate('(()=>{const r=document.getElementById("main-pane").getBoundingClientRect();return r.left+r.width/2;})()'):endLineMdn?800:200;
      await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pickX,y:pickY});
      await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:pickX,y:pickY,button:'left',clickCount:1});
      await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:pickX,y:pickY,button:'left',clickCount:1});
      endLineY=await browser.evaluate('window.__shotEndLine?.getY()');
      assert(Math.abs(endLineY-(endLineShort?290:endLineInternal?1690:endLineMdn?2450:1550))<=2,'The real mouse places the line in its scrolling content coordinates');
      if(endLineInternal)assert.equal(await browser.evaluate('window.__shotEndLine.target.id'),'main-pane','The widest main pane owns the end line, not an independent sidebar');
      assert(await browser.evaluate('window.__shotEndLine?.placed===true'),'The line is fixed after one click');
      assert(await browser.evaluate('window.__endLineMessages.some(m=>m.action==="endLineArmed")'),'The line arms the toolbar');
      if(endLineAnchor&&!endLineMdn&&!endLineInternal){
        await browser.evaluate('document.querySelector("main section").style.height="450px";true');
        assert(Math.abs((await browser.evaluate('window.__shotEndLine?.getY()'))-1600)<=2,
          'The line follows its content when earlier content grows');
        await browser.evaluate('document.querySelector("main section").style.height="";true');
        assert(Math.abs((await browser.evaluate('window.__shotEndLine?.getY()'))-1550)<=2,
          'The line returns with its content before capture');
      }
      if(endLineAnchor&&endLineInternal){
        const before=endLineY;
        await browser.evaluate('document.querySelector("main section").style.height="130px";true');
        assert(Math.abs(await browser.evaluate('window.__shotEndLine.getY()')-before-50)<2,'The internal marker follows content inserted above its anchor');
        await browser.evaluate('document.querySelector("main section").style.height="";document.getElementById("main-pane").scrollTop=1100;true');
        assert(Math.abs(await browser.evaluate('window.__shotEndLine.getY()')-before)<2,'The internal anchor returns to its original content coordinate');
      }
      if(endLineDrag){
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pickX,y:650});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:pickX,y:650,button:'left',clickCount:1});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pickX,y:700,buttons:1});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:pickX,y:700,button:'left',clickCount:1});
        endLineY=await browser.evaluate('window.__shotEndLine?.getY()');
        assert(Math.abs(endLineY-(endLineInternal?1740:1600))<=2,`Dragging adjusts the target in content coordinates (got ${endLineY})`);
      }
      if(dark&&!endLineMdn&&!endLineInternal)await browser.evaluate('window.__endLinePreviewSection=document.querySelectorAll("main section")[3];window.__endLinePreviewOldBackground=window.__endLinePreviewSection.style.background;window.__endLinePreviewSection.style.background="rgb(20,25,35)";true');
      const preview=await browser.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      fs.writeFileSync(path.join(outputDir,'end-line-preview'+(mobile?'-mobile':'-desktop')+(dark?'-dark':'-light')+'.png'),Buffer.from(preview.data,'base64'));
      if(dark&&!endLineMdn&&!endLineInternal)await browser.evaluate('window.__endLinePreviewSection.style.background=window.__endLinePreviewOldBackground;delete window.__endLinePreviewSection;delete window.__endLinePreviewOldBackground;true');
      endLineScreenY=await browser.evaluate('window.__shotEndLine.getScreenY()');
      if(endLineStale){
        await browser.evaluate('window.chrome.runtime.sendMessage=()=>{throw Error("Extension context invalidated.")};true');
        const staleX=(mobile?390:1920)-92,staleY=endLineScreenY+31;
        await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:staleX,y:staleY,button:'left',clickCount:1});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:staleX,y:staleY,button:'left',clickCount:1});
        assert(await browser.evaluate('!window.__shotEndLine&&!document.getElementById("__shot_end_line")'),'A synchronous invalidated-context error removes the stale disabled line');
        await browser.evaluate('window.chrome.runtime.sendMessage=async m=>{(window.__endLineMessages||=[]).push(m);return {armed:true,started:true}};true');
        await browser.evaluate(readSource('end-line.js'));
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pickX,y:pickY});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:pickX,y:pickY,button:'left',clickCount:1});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:pickX,y:pickY,button:'left',clickCount:1});
        assert.equal(await browser.evaluate('document.querySelectorAll("#__shot_end_line").length'),1,'A retry creates exactly one working line');
      }
      if(endLineButton){
        const buttonX=(mobile?390:1920)-92,buttonY=endLineScreenY+31;
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:buttonX,y:buttonY});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:buttonX,y:buttonY,button:'left',clickCount:1});
        await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:buttonX,y:buttonY,button:'left',clickCount:1});
        assert(await browser.evaluate('window.__endLineMessages.some(m=>m.action==="startCaptureToLine")'),'The nearby button requests a capture');
      }
    }
    // Normal, widget and editor starts all use the production controller.
    // Toolbar pixels are outside this capture-content diagnostic.
    context.getStopIconImageData=async()=>({});
    context.startControlledCapture(multi?null:1,mode,
      multi?{multi:true,sourceRequestTabId:editor?2:1,endLine:endLine}:endLine?{endLine:true}:undefined);
    await context.activeCaptureJob.done;
    const cancelMs=stopWaitAt?Date.now()-stopWaitAt:null;
    assert.equal(context.activeCaptureJob,null,'The job unlocks after restoration');
    if(startScrolled)assert.equal(await browser.evaluate('window.__startedPane?window.__startedPane.scrollTop:scrollY'),mode==='full'&&!stop&&!failure?0:640,'Full Page returns to the top; Area, Stop and errors restore the initial position');
    const restored=await browser.evaluate(`({control:!!window.__shotCaptureControl,
      stickyVisibility:(window.__testStickyElements||[]).every(rec=>!rec.el.isConnected||rec.el.style.visibility===rec.oldVis),
      styles:(window.__sidebarExpected||[]).every(rec=>rec.properties.every(prop=>rec.el.style.getPropertyValue(prop.name)===prop.value&&rec.el.style.getPropertyPriority(prop.name)===prop.priority)),
      adsStyles:(window.__adsExpected||[]).every(rec=>rec.properties.every(prop=>rec.el.style.getPropertyValue(prop.name)===prop.value&&rec.el.style.getPropertyPriority(prop.name)===prop.priority)),
      height:document.documentElement.scrollHeight,remaining:document.querySelectorAll('[data-screenshot-area-pane],[data-screenshot-scroll],[data-screenshot-area-scroll]').length})`);
    assert.equal(restored.control,false);assert.equal(restored.styles,true,'Original sidebar styles and priorities restored');
    assert.equal(restored.adsStyles,true,'Original advertisement positions and priorities restored');
    if(endLineInternal)assert(await browser.evaluate('window.__internalInitial.every(rec=>Math.abs(rec.el.scrollTop-rec.y)<1&&rec.el.getAttribute("style")===rec.style)&&scrollY===0'),'Every internal pane retains its original scroll and style after success, Stop or error');
    assert.equal(restored.stickyVisibility,true,'Original sticky visibility restored');
    if(modal){
      const state=await browser.evaluate(`(()=>{const w=document.getElementById('wizard');return {present:!!w,open:w.tagName==='DIALOG'?w.open:w.hasAttribute('popover')?w.matches(':popover-open'):true,style:w.getAttribute('style')===window.__modalOriginal,inert:document.querySelector('main').inert,overlay:!!document.getElementById('__screenshot_area_overlay'),noSelect:!!document.getElementById('__screenshot_noselect')};})()`);
      assert.deepEqual(state,{present:true,open:true,style:true,inert:true,overlay:false,noSelect:false},'The original modal stays open and unchanged; selection is fully removed');
      assert.equal(await browser.evaluate('document.getElementById("wizard-content").scrollTop'),0,'Modal scroll restored');
      assert(await browser.evaluate('document.body.getAttribute("style")===window.__modalBodyStyle'),'The original modal pointer lock is preserved');
    }
    if(site==='pricing')assert.deepEqual(await browser.evaluate('({open:window.__pricingDialog.isConnected,body:document.body.getAttribute("style")===window.__pricingBodyStyle,empty:[...window.__pricingDialog.querySelectorAll("input")].every(el=>!el.value),overlay:!!document.getElementById("__screenshot_area_overlay")})'),{open:true,body:true,empty:true,overlay:false},'The real login stays open, empty, unchanged and free of selection UI');
    if(endLine){
      const marker=await browser.evaluate('({present:!!window.__shotEndLine,host:!!document.getElementById("__shot_end_line"),display:document.getElementById("__shot_end_line")?.style.display})');
      if(stop||failure||compositionGap){
        assert.equal(marker.present,true,'Interrupted end-line capture retains the marker');
        assert.equal(marker.display,'block','Interrupted capture shows the marker again');
      }else assert.equal(marker.present,false,'Completed capture removes the marker');
      if(endLineMdn){
        const navRestored=await browser.evaluate('({pageY:scrollY,asideY:document.querySelector(".layout__left-sidebar")?.scrollTop,expectedAsideY:window.__endLineNavScroll})');
        assert(Math.abs(navRestored.pageY-1800)<=2,'The chosen page scroll is restored');
        assert(Math.abs(navRestored.asideY-navRestored.expectedAsideY)<=2,'The chosen independent sidebar scroll is restored');
      }
    }
    if(site!=='yahoo'&&!growth)assert.equal(restored.height,initial.height,'Original document height restored');assert.equal(restored.remaining,0);
    if(chat||independent||mobile||mode==='visible')assert.equal(preparation?.changed||0,0,'Independent/narrow/visible layout is not unfolded');
    else if(!live&&!baseline&&!release&&!ads&&!growth&&!modal)assert(preparation?.changed>0,'The local long document navigation is unfolded before selection/capture');
    const growthLimit=mode==='full'&&['continuous','stalled'].includes(growth);
    if(stop||failure||compositionGap||stopWait||growthLimit){
      if(chat)assert(await browser.evaluate('Math.abs((window.__chatInitial.documentScroll?scrollY:document.querySelector(".thread").scrollTop)-window.__chatInitial.y)<1'),'Chat scroll is restored after Stop/error');
      assert.equal(outputs.length,0,'Interrupted capture produces no file');
      if(multi)assert.deepEqual(session.multi.pieces,[previousPiece],'Interrupted Multi preserves old pieces');
      if(compositionGap){
        const expectedError=endLineInternal?'The scrolling content ended before the capture was complete':'The page moved during capture';
        assert(messages.some(m=>m.type==='error'&&m.message.includes(expectedError)),'The actual composition error reaches the UI');
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
    const label=(site|| (tailwind?'tailwind':live?'deepseek':modal?'modal-'+modal:growth?'growth-'+growth:endLineInternal?'internal':independent?'independent':release?'release':ads?'ads':'fixture'))+(endLine?'-end-line':'')+(cold?'-cold':'')+(multi?(editor?'-multi-editor':'-multi-widget'):'')+(mobile?'-mobile':'')+(dark?'-dark':'')+(baseline?'-baseline':'')+(refArg?'-ref-'+sourceRef:'')+(zoomArg?'-zoom'+Math.round(zoom*100):'')+(overshoot?'-overshoot'+overshoot:'')+(rightEdge?'-right-edge':'')+(fromContent?'-from-content':'')+(nativeEdge?'-native-edge':'')+(dragEdge?'-drag':'')+(outsideRight?'-outside':'');
    assert.equal(outputs.length,1,'Area returns one complete PNG');
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-after.png'),Buffer.from(outputs[0].split(',')[1],'base64'));
    if(chat){
      const checked=await browser.evaluate('('+checkChatArea.toString()+')('+JSON.stringify(outputs[0])+','+JSON.stringify(selection.area)+')');
      console.log('Chat Area pixels',JSON.stringify(checked));
      fs.writeFileSync(path.join(outputDir,'chat-area'+(chatDocument?'-document':'-internal')+(mobile?'-mobile':'')+(dark?'-dark':'')+(zoomArg?'-zoom'+Math.round(zoom*100):'')+(sourceRef?'-ref-'+sourceRef:'')+'.png'),Buffer.from(outputs[0].split(',')[1],'base64'));
      if(sourceRef){
        assert(!chatShort&&checked.barRows>Math.round(100*(zoom||1)),'Old capture repeats the composer');
        assert(Math.abs(checked.scroll-checked.initial)>1,'Old Area returns to the top');
        console.log('Old-code reproduction confirmed');return;
      }
      assert.equal(checked.wrong,0,'Selected message rows have no gaps or overlays');
      assert.equal(checked.barRows,chatShort?0:Math.round(100*(zoom||1)),'Composer appears once at the end, or not at all outside a short selection');
      assert(Math.abs(checked.scroll-checked.initial)<1,'Area returns to the position before selection');
      assert.equal(checked.style,true,'Composer style is restored');return;
    }
    if(endLineInternal){
      const checked=await browser.evaluate('('+checkInternalEndPixels.toString()+')('+JSON.stringify(outputs[0])+','+JSON.stringify(endViewSource)+','+endLineY+','+endLineScreenY+')');
      assert.equal(checked.height,checked.expectedHeight,'Output ends exactly at the internal end line');
      assert.equal(checked.mainWrong,0,'Every content row is present exactly once, including fractional zoom joins');
      assert.equal(checked.railsWrong,0,'Both independent sidebars exactly match their end-view pixels');
      assert.equal(checked.earlyRailWrong,0,'Independent sidebars are not repeated at the top or in intermediate bands');
      fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-diagnostic.json'),JSON.stringify({checked,frames,compositions,messages,restored},null,2));
      console.log('Internal end-line pixels',JSON.stringify(checked));return;
    }
    if(endLineMdn){
      const bottomPng=await browser.evaluate(`(async()=>{const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=no;im.src=${JSON.stringify(outputs[0])}});
        const c=document.createElement('canvas');c.width=im.width;c.height=Math.min(900,im.height);
        c.getContext('2d').drawImage(im,0,im.height-c.height,im.width,c.height,0,0,im.width,c.height);
        return c.toDataURL('image/png');})()`);
      fs.writeFileSync(path.join(outputDir,'end-line-mdn-bottom.png'),Buffer.from(bottomPng.split(',')[1],'base64'));
    }
    const pixels=await browser.evaluate('('+checkNavigationPixels.toString()+')('+JSON.stringify(outputs[0])+')');
    if(modal){
      // Check actual content rather than ideal boundary positions: the existing
      // internal-scroll composer allows pixel rounding at slice joins. This
      // modal test must catch a leftover veil, empty rows or clipped top layer.
      const content=await browser.evaluate(`(async()=>{const img=new Image();await new Promise((yes,no)=>{img.onload=yes;img.onerror=no;img.src=${JSON.stringify(outputs[0])}});const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const data=ctx.getImageData(c.width-20,0,1,c.height).data;let wrong=0;for(let y=0;y<c.height;y++){if(![[180,220,240],[240,220,180]].some(color=>color.every((v,k)=>data[y*4+k]===v)&&data[y*4+3]===255))wrong++;}return {wrong,width:img.width,height:img.height};})()`);
      assert.equal(content.wrong,0,'All modal image rows contain the original content, without selection veil or blank bands');
      assert.equal(content.width,Math.round(selection.area.w*initial.dpr));
      assert.equal(content.height,Math.round(selection.area.h_doc*initial.dpr));
    }
    console.log('Pixel comparison',JSON.stringify(pixels));
    fs.writeFileSync(path.join(outputDir,mode+'-'+label+'-diagnostic.json'),JSON.stringify({initial,preparation,adPreparation,selection,frames,compositions,measurements,messages,restored,pixels,outputs:outputs.length},null,2));
    if(!endLineMdn)assert.equal(pixels.seen,pixels.expected,'Every visible navigation item is present in the composed image');
    assert.equal(pixels.changed,0,'Composed navigation pixels match their captured source fragments');
    if(mode==='full'&&!independent&&!endLine){
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
      if(endLine){
        assert(Math.abs(checked.height-endLineY*(zoom||1))<=2,'The output stops at the placed line');
        assert.equal(checked.wrong,0,'Every row before the line matches page content');
        assert(checked.height<checked.expectedHeight,'The rest of the document is excluded');
        return;
      }
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
