'use strict';
// Real DOM scope/undo checks; no live ads or user profile needed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const {openBrowser}=require('./lib/browser-fixture.cjs');

function setup(kind){
  document.documentElement.removeAttribute('style');document.body.removeAttribute('style');
  document.head.innerHTML='<style>*{box-sizing:border-box}body{margin:0}main{display:flex;height:4500px}article{flex:1}aside{width:300px}#parent{margin-top:1400px;height:2000px}#ad{position:sticky;top:128px;width:300px;height:532px}</style>';
  document.body.innerHTML='<main><article>Page content</article><aside><div id="parent"><div id="ad"><div data-ad-unit="test">Advertisement</div></div></div></aside></main>';
  const ad=document.getElementById('ad'),parent=ad.parentElement,marker=ad.firstElementChild;
  if(kind==='priorities')ad.style.cssText='position:sticky!important;top:128px!important;inset-block-start:128px!important;bottom:auto!important;height:532px!important';
  if(kind==='ad-slot'){marker.removeAttribute('data-ad-unit');marker.setAttribute('data-ad-slot','test');}
  if(kind==='label'){marker.removeAttribute('data-ad-unit');marker.setAttribute('aria-label','Advertisement');}
  if(kind==='empty-slot')marker.textContent='';
  if(kind==='no-marker')marker.removeAttribute('data-ad-unit');
  if(kind==='fixed')ad.style.position='fixed';
  if(kind==='static')ad.style.position='static';
  if(kind==='fixed-ancestor')parent.style.position='fixed';
  if(kind==='independent')parent.style.cssText='height:300px;overflow:auto;margin-top:0';
  if(kind==='feed')parent.setAttribute('role','feed');
  if(kind==='inside-dialog'){parent.setAttribute('role','dialog');parent.setAttribute('aria-modal','true');}
  if(kind==='header')parent.setAttribute('role','banner');
  if(kind==='nav')ad.appendChild(document.createElement('nav'));
  if(kind==='editor')ad.appendChild(document.createElement('textarea'));
  if(kind==='body-locked')document.body.style.overflow='hidden';
  if(kind==='html-locked')document.documentElement.style.overflow='hidden';
  if(kind==='wide')ad.style.width='1200px';
  if(kind==='tall')ad.style.height='1100px';
  if(kind==='hidden')ad.style.visibility='hidden';
  if(kind==='zero')ad.style.height='0';
  if(kind==='bottom')ad.style.cssText='top:auto;bottom:0';
  if(kind==='offscreen')parent.style.transform='translateX(2200px)';
  if(kind==='short-page'){parent.style.cssText='margin-top:0;height:600px';document.querySelector('main').style.height='600px';}
  if(kind==='modal'||kind==='dock'){
    const d=document.createElement('div');d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');
    d.style.cssText=kind==='modal'?'position:fixed;inset:0;background:#ccc':'position:sticky;top:0;width:300px;height:500px';
    d.textContent='Unrelated dialog / dock';document.body.appendChild(d);
  }
  scrollTo(0,kind==='scrolled'?1800:0);
  window.__shotCaptureControl={id:'ads',cancelled:kind==='cancelled'};
  window.__adsBefore=[...document.querySelectorAll('*')].map(el=>({el,style:el.getAttribute('style')}));
  window.__adsLayout={x:scrollX,y:scrollY,height:document.documentElement.scrollHeight,width:ad.getBoundingClientRect().width,adHeight:ad.getBoundingClientRect().height};
  return window.__adsLayout;
}

(async()=>{
  const browser=await openBrowser(1920,900);
  try{
    const source=fs.readFileSync(path.join(__dirname,'../full-page-screenshot-extension/capture-control.js'),'utf8');
    const start=source.indexOf('async function prepareCaptureAds(job)'),end=source.indexOf('// Updates never change visibility',start);
    assert(start>=0&&end>start);
    const prepare=vm.runInNewContext(source.slice(start,end)+';prepareCaptureAds',{
      captureHasToolbarStop:job=>['full','area'].includes(job.mode),
      chrome:{scripting:{executeScript:async spec=>[{result:await browser.evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args)+')')}]}}
    });
    const accepted=['normal','priorities','scrolled','ad-slot','label','empty-slot','dock'];
    const excluded=['no-marker','fixed','static','fixed-ancestor','independent','feed','inside-dialog','header','nav','editor','body-locked','html-locked','wide','tall','hidden','zero','bottom','offscreen','short-page','modal','cancelled'];
    let passed=0;
    for(const mode of ['area','full'])for(const kind of [...accepted,...excluded]){
      const before=await browser.evaluate('('+setup.toString()+')('+JSON.stringify(kind)+')');
      const job={mode,id:'ads',tabId:1,hasPageControl:true};await prepare(job);
      const result=await browser.evaluate('({changed:window.__shotCaptureControl.adStickies?.changes.length||0,x:scrollX,y:scrollY,width:document.getElementById("ad").getBoundingClientRect().width,height:document.getElementById("ad").getBoundingClientRect().height})');
      assert.equal(result.changed,accepted.includes(kind)?1:0,mode+' '+kind);
      assert.equal(result.x,before.x);assert.equal(result.y,before.y);assert.equal(result.width,before.width);assert.equal(result.height,before.adHeight);
      await prepare(job);
      assert.equal(await browser.evaluate('window.__shotCaptureControl.adStickies?.changes.length||0'),result.changed,'Idempotent preparation');
      const restored=await browser.evaluate(`(()=>{window.__shotCaptureControl.adStickies?.restore();return {styles:window.__adsBefore.every(rec=>{
        const old=document.createElement('div');if(rec.style)old.setAttribute('style',rec.style);
        return [...new Set([...old.style,...rec.el.style])].every(name=>old.style.getPropertyValue(name)===rec.el.style.getPropertyValue(name)&&old.style.getPropertyPriority(name)===rec.el.style.getPropertyPriority(name))&&(rec.style!==null||!rec.el.getAttribute('style'));
      }),x:scrollX,y:scrollY,height:document.documentElement.scrollHeight};})()`);
      assert(restored.styles,mode+' '+kind+' original styles');assert.equal(restored.height,before.height);assert.equal(restored.y,before.y);passed++;
    }
    for(const job of [{mode:'visible',id:'ads',hasPageControl:true},{mode:'area',id:'different',hasPageControl:true},{mode:'area',id:'ads',hasPageControl:false}]){
      await browser.evaluate('('+setup.toString()+')("normal")');await prepare({...job,tabId:1});
      assert.equal(await browser.evaluate('!!window.__shotCaptureControl.adStickies'),false);passed++;
    }
    console.log(passed+' advertisement scope, dimensions, idempotence and restore checks passed.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
