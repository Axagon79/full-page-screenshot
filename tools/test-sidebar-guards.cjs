'use strict';
// Approved real-DOM checks of the narrow sidebar preparation and its undo.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { openBrowser } = require('./lib/browser-fixture.cjs');

function setup(kind) {
  document.body.removeAttribute('style');
  document.head.innerHTML = '<style>*{box-sizing:border-box}body{margin:0}header{height:60px}.layout{display:flex}aside{width:260px;flex-shrink:0}.sidebar{position:sticky;top:0;height:840px;max-height:840px;overflow:auto}.sidebar a{display:block;height:44px}main{height:3000px;flex:1}footer{height:220px}</style>';
  document.body.innerHTML = '<header>Header</header><div class="layout"><aside><nav class="sidebar">' +
    Array.from({length:30},(_,i)=>'<a href="#'+i+'">Item '+i+'</a>').join('') + '</nav></aside><main>Article</main></div><footer>Footer</footer>';
  const side = document.querySelector('.sidebar'), aside=side.parentElement;
  if(kind==='wrapped') {
    const wrapper=document.createElement('div');wrapper.className='sidebar';
    side.replaceWith(wrapper);wrapper.appendChild(side);side.className='';side.style.cssText='height:100%;overflow-y:auto';
  }
  if(kind==='fixed')side.style.position='fixed';
  if(kind==='fixed-ancestor')aside.style.position='fixed';
  if(kind==='scroll-ancestor')aside.style.cssText='height:850px;overflow:auto';
  if(kind==='scroll-ancestor')aside.appendChild(Object.assign(document.createElement('div'),{textContent:'Extra content'})).style.height='300px';
  if(kind==='feed')document.querySelector('main').setAttribute('role','feed');
  if(kind==='modal'){const d=document.createElement('dialog');d.setAttribute('open','');d.textContent='Dialog';document.body.appendChild(d);}
  if(kind==='body-locked')document.body.style.overflow='hidden';
  if(kind==='non-nav'){side.outerHTML=side.outerHTML.replaceAll('<nav','<div').replaceAll('</nav','</div');}
  if(kind==='wide')aside.style.width='1200px';
  if(kind==='short')side.style.height='200px';
  if(kind==='hidden')side.style.visibility='hidden';
  if(kind==='short-page'){document.querySelector('main').style.height='900px';document.querySelector('footer').style.height='0';}
  if(kind==='priorities')side.style.cssText='height:840px!important;max-height:840px!important;overflow-x:hidden!important;overflow-y:scroll!important;top:0!important';
  if(kind==='scrolled'){side.scrollTop=250;window.scrollTo(0,2200);}else window.scrollTo(0,0);
  window.__shotCaptureControl={id:'guard',cancelled:kind==='cancelled'};
  const props=['height','max-height','block-size','max-block-size','overflow-x','overflow-y','position','top','bottom','inset-block-start','inset-block-end','align-self'];
  window.__before=[...document.querySelectorAll('*')].map(el=>({el,style:el.hasAttribute('style'),props:props.map(name=>({name,value:el.style.getPropertyValue(name),priority:el.style.getPropertyPriority(name)}))}));
  window.__scrollBefore={x:window.scrollX,y:window.scrollY,nav:document.querySelector('nav')?.scrollTop||0,height:document.documentElement.scrollHeight};
  return window.__scrollBefore;
}

(async()=>{
  const browser=await openBrowser(1920,900);
  try {
    const source=fs.readFileSync(path.join(__dirname,'../full-page-screenshot-extension/capture-control.js'),'utf8');
    const start=source.indexOf('async function prepareCaptureSidebars(job)');
    const end=source.indexOf('// Updates never change visibility',start);
    const prepare=vm.runInNewContext(source.slice(start,end)+';prepareCaptureSidebars',{
      captureHasToolbarStop:job=>job.mode==='full'||job.mode==='area',
      chrome:{scripting:{executeScript:async spec=>[{result:await browser.evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args)+')')}]}}
    });
    let passed=0;
    for(const mode of ['full','area'])for(const kind of ['normal','wrapped','priorities','scrolled','fixed','fixed-ancestor','scroll-ancestor','feed','modal','body-locked','non-nav','wide','short','hidden','short-page','cancelled']){
      const before=await browser.evaluate('('+setup.toString()+')('+JSON.stringify(kind)+')');
      const job={hasPageControl:true,mode,id:'guard',tabId:1};
      await prepare(job);
      const prepared=await browser.evaluate(`({changed:window.__shotCaptureControl.sidebars?.changes.length||0,y:scrollY,
        clips:[...document.querySelectorAll('nav')].some(el=>el.scrollHeight>el.clientHeight+2&&/auto|scroll/.test(getComputedStyle(el).overflowY))})`);
      const unfolds=['normal','wrapped','priorities','scrolled'].includes(kind);
      assert.equal(prepared.changed>0,unfolds,mode+' '+kind+' scope');
      assert.equal(prepared.y,before.y,mode+' '+kind+' preserves page scroll during discovery');
      if(unfolds){assert.equal(prepared.clips,false,kind+' exposes the entire menu');await prepare(job);
        assert.equal(await browser.evaluate('window.__shotCaptureControl.sidebars.changes.length'),prepared.changed,'Preparation is idempotent');}
      const restored=await browser.evaluate(`(()=>{window.__shotCaptureControl.sidebars?.restore();return {
        exact:window.__before.every(rec=>(rec.style||!rec.el.getAttribute('style'))&&rec.props.every(p=>rec.el.style.getPropertyValue(p.name)===p.value&&rec.el.style.getPropertyPriority(p.name)===p.priority)),
        differences:window.__before.filter(rec=>rec.el.hasAttribute('style')!==rec.style||rec.props.some(p=>rec.el.style.getPropertyValue(p.name)!==p.value||rec.el.style.getPropertyPriority(p.name)!==p.priority)).map(rec=>({tag:rec.el.tagName,cls:rec.el.className,hadStyle:rec.style,style:rec.el.getAttribute('style'),props:rec.props})),
        scroll:{x:scrollX,y:scrollY,nav:document.querySelector('nav')?.scrollTop||0,height:document.documentElement.scrollHeight}};})()`);
      assert(restored.exact,kind+' restores inline values, priorities and empty attributes: '+JSON.stringify(restored.differences));
      assert.deepEqual(restored.scroll,before,kind+' restores layout and sidebar scroll');
      passed++;console.log('PASS',mode,kind);
    }
    await browser.evaluate('('+setup.toString()+')("normal")');
    await prepare({hasPageControl:true,mode:'visible',id:'guard',tabId:1});
    assert.equal(await browser.evaluate('!!window.__shotCaptureControl.sidebars'),false,'Visible mode is untouched');passed++;
    console.log(passed+' sidebar guard checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
