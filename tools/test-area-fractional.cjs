'use strict';
// Actual production composer in a real browser canvas. Deterministic source
// rows supplement (not replace) the live, genuinely zoomed browser captures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {openBrowser} = require('./lib/browser-fixture.cjs');

async function exercise(compose, scale, origin, kind) {
  const frameH=911, frameW=96, viewH=Math.round(frameH/scale);
  const step=(frameH-1)/scale, height=7665.36328125;
  const firstPixel=Math.round(origin*scale), lastPixel=Math.round((origin+height)*scale);
  const scrolls=[];
  for(let i=0;i<Math.ceil(height/step);i++){
    const wanted=i===Math.ceil(height/step)-1?origin+height-step:origin+i*step;
    scrolls.push(Math.round(wanted*scale)/scale);
  }
  if(kind==='gap')scrolls.splice(3,1);
  if(kind==='end')scrolls.pop();
  const sources=scrolls.map(y=>{
    const c=document.createElement('canvas');c.width=frameW;c.height=frameH;
    const ctx=c.getContext('2d'),pixels=ctx.createImageData(frameW,frameH);
    const start=Math.round(y*scale);
    for(let row=0;row<frameH;row++)for(let x=0;x<frameW;x++){
      const p=(row*frameW+x)*4,docY=start+row;
      pixels.data[p]=docY&255;pixels.data[p+1]=(docY>>8)&255;
      pixels.data[p+2]=(x*17)&255;pixels.data[p+3]=255;
    }
    ctx.putImageData(pixels,0,0);return c.toDataURL('image/png');
  });
  const x=5.5,w=frameW/scale-6.5;
  if(kind==='decode')sources[0]='data:image/png;base64,invalid';
  const result=await compose(sources,x,w,height,viewH,kind==='fallback'?2:scale,0,0,
    scrolls.map(()=>0),scrolls,-1,step,null,null,true,origin);
  if(typeof result!=='string')return result;
  const img=new Image();await new Promise((yes,no)=>{img.onload=yes;img.onerror=no;img.src=result;});
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;
  const left=Math.round(x*scale),right=Math.min(frameW,Math.round((x+w)*scale));
  let differences=0;
  for(let row=0;row<c.height;row++)for(let col=0;col<c.width;col++){
    const i=(row*c.width+col)*4,docY=firstPixel+row;
    if(p[i] !== (docY&255)||p[i+1] !== ((docY>>8)&255)||p[i+2] !== (((left+col)*17)&255)||p[i+3]!==255)differences++;
  }
  return {width:c.width,height:c.height,expectedWidth:right-left,expectedHeight:lastPixel-firstPixel,differences};
}

(async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../full-page-screenshot-extension/sw.js'),'utf8');
  const start=source.indexOf('func: function(imgs, ax, aw, ah_doc');
  assert(start>=0);
  const end=source.indexOf('\n      // NB:',start);assert(end>start);
  const compose=source.slice(start+6,end).trim().replace(/,$/,'');
  const browser=await openBrowser();
  let passed=0;
  try{
    for(const scale of [0.9,1,1.100000023841858,1.25,1.5,1.75,2]){
      for(const origin of [0,1,5,5.5,159.7]){
        const r=await browser.evaluate('('+exercise.toString()+')('+compose+','+scale+','+origin+',"complete")');
        assert.equal(r.captureError,undefined,JSON.stringify({scale,origin,r}));
        assert.equal(r.width,r.expectedWidth);assert.equal(r.height,r.expectedHeight);
        assert.equal(r.differences,0,JSON.stringify({scale,origin,r}));passed++;
      }
    }
    for(const [kind,message] of [['gap','page moved'],['end','page ended'],['decode','Unable to compose']]){
      const r=await browser.evaluate('('+exercise.toString()+')('+compose+',1.1,5,'+JSON.stringify(kind)+')');
      assert(r.captureError?.includes(message),JSON.stringify({kind,r}));passed++;
    }
    // Capture backend at a different scale from DPR: use measured frame ratio.
    const fallback=await browser.evaluate('('+exercise.toString()+')('+compose+','+(911/828)+',5,"fallback")');
    assert.equal(fallback.differences,0);assert.equal(fallback.height,fallback.expectedHeight);passed++;
    console.log(passed+' fractional composition checks passed: exact source rows, bounds, genuine gaps/end, decode errors and scale fallback.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
