'use strict';
// Compare saved before/after diagnostics; rerun their fixtures first.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {openBrowser}=require('./lib/browser-fixture.cjs');
async function compare(old,now,mobile) {
  async function load(src){const im=new Image();await new Promise((yes,no)=>{im.onload=yes;im.onerror=no;im.src=src;});const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);return {w:c.width,h:c.height,p:c.getContext('2d').getImageData(0,0,c.width,c.height).data};}
  const a=await load(old),b=await load(now),x=mobile?20:339,first=mobile?900:911,masked=new Set();
  for(let y=first;y<a.h;y++){const p=(y*a.w+x)*4;if([250,250,250].every((v,i)=>a.p[p+i]===v))for(let d=-1;d<=1;d++)masked.add(y+d);}
  let otherChanges=0,changedInBands=0;
  for(let y=0;y<a.h;y++)for(let x=0;x<a.w;x++){const p=(y*a.w+x)*4;if([0,1,2,3].some(i=>a.p[p+i]!==b.p[p+i])){if(masked.has(y))changedInBands++;else otherChanges++;}}
  return {sameSize:a.w===b.w&&a.h===b.h,otherChanges,changedInBands,maskedRows:masked.size};
}
(async()=>{
  const b=await openBrowser();
  try {
    for(const name of ['claude-full-zoom110','claude-full-mobile-dark']){
      const read=suffix=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'artifacts',name+suffix+'.png')).toString('base64');
      const result=await b.evaluate('('+compare.toString()+')(...'+JSON.stringify([read('-ref'),read(''),name.includes('mobile')])+')');
      console.log(name,result);
      assert(result.sameSize&&result.otherChanges===0&&result.changedInBands>0,'Only formerly repeated header bands change');
    }
  } finally {await b.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
