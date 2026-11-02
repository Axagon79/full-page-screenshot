'use strict';
// Approved, isolated real-DOM checks of the shared production discovery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {openBrowser} = require('./lib/browser-fixture.cjs');

(async()=>{
  const browser=await openBrowser(1100,800);
  try {
    await browser.evaluate(`(()=>{
      document.head.innerHTML='<style>*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}.shell{position:relative;height:100%}.scroll{height:100%;overflow:auto}.content{height:3200px;position:relative}.bar{position:absolute;top:0;left:0;width:100%;height:45px;z-index:11}.child{visibility:visible}.hidden{opacity:0}.background{height:100%;z-index:auto}.bottom{top:auto;bottom:0}.narrow{width:80px}.auto{z-index:auto}</style>';
      document.body.innerHTML='<div class="shell"><div class="scroll"><div class="content"><div class="bar moving" id="in-content">Ordinary absolute content</div></div></div><div class="bar" id="toolbar"><span class="child">Fake toolbar</span></div><div class="bar hidden" id="hidden">Hidden overlay</div><div class="bar background" id="background">Decoration</div><div class="bar bottom" id="bottom">Footer</div><div class="bar narrow" id="narrow">Small item</div><div class="bar auto" id="auto">Non-layered decoration</div></div>';
      document.querySelector('.scroll').scrollTop=640;
      window.__shotCaptureControl={};
      window.__original=[...document.querySelectorAll('*')].map(el=>({el,style:el.getAttribute('style')||''}));return true;
    })()`);
    const chrome={scripting:{executeScript:async spec=>[{result:await browser.evaluate('('+spec.func.toString()+')(...'+JSON.stringify(spec.args||[])+')')}]}};
    const context=vm.createContext({chrome,console,checkCaptureCancelled(){}});
    const source=fs.readFileSync(path.join(__dirname,'../full-page-screenshot-extension/capture-control.js'),'utf8');
    const start=source.indexOf('async function prepareCaptureTopOverlays('),end=source.indexOf('\n// Document navigation',start);
    assert(start>=0&&end>start,'Use the actual shared production function');
    vm.runInContext(source.slice(start,end),context);
    await context.prepareCaptureTopOverlays(1,'.scroll');
    const result=await browser.evaluate(`({found:window.__shotCaptureControl.topOverlays.map(el=>el.id||el.className),scroll:document.querySelector('.scroll').scrollTop,styles:window.__original.every(rec=>(rec.el.getAttribute('style')||'')===rec.style)})`);
    assert.deepEqual(result,{found:['toolbar','child'],scroll:640,styles:true},'Only the anchored top toolbar and its child qualify; content, backgrounds and hidden panels remain untouched');
    // Different class names and tags must not alter the rule.
    await browser.evaluate(`(()=>{document.querySelector('.scroll').id='other-scroll';for(const el of document.querySelectorAll('*')){const css=getComputedStyle(el);el.style.cssText+=';position:'+css.position+';overflow-y:'+css.overflowY+';height:'+css.height+';width:'+css.width+';top:'+css.top+';bottom:'+css.bottom+';left:'+css.left+';z-index:'+css.zIndex+';opacity:'+css.opacity;el.className='unrelated';}return true;})()`);
    await context.prepareCaptureTopOverlays(1,'#other-scroll');
    assert.deepEqual(await browser.evaluate('window.__shotCaptureControl.topOverlays.map(el=>el.id||el.tagName)'),['toolbar','SPAN'],'Discovery has no dependency on site classes or hostnames');
    console.log('Top overlay discovery: positive, explicit child, six exclusions, restoration and unrelated class names passed');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
