'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {openBrowser}=require('./lib/browser-fixture.cjs');
(async()=>{
  const b=await openBrowser();
  try{
    const names=['full-mdn-after.png','area-mdn-multi-editor-after.png'];
    const sources=names.map(name=>'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'artifacts',name)).toString('base64'));
    const result=await b.evaluate(`(async(sources)=>{const images=await Promise.all(sources.map(src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;})));
      const crops=images.map((im,i)=>{const c=document.createElement('canvas');c.width=304;c.height=400;c.getContext('2d').drawImage(im,232-i,650-i,304,400,0,0,304,400);return c;});
      const a=crops[0].getContext('2d').getImageData(0,0,304,400).data,b=crops[1].getContext('2d').getImageData(0,0,304,400).data;
      let different=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])different++;
      return {different,crops:crops.map(c=>c.toDataURL())};})(${JSON.stringify(sources)})`);
    for(let i=0;i<2;i++)fs.writeFileSync(path.join(__dirname,'artifacts','mdn-seam-'+i+'.png'),Buffer.from(result.crops[i].split(',')[1],'base64'));
    console.log('Full vs Area sidebar pixels around the first seam:',result.different,'different channels');
  }finally{await b.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
