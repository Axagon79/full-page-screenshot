'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openBrowser, wait } = require('./lib/browser-fixture.cjs');
(async () => {
  const browser = await openBrowser(1920, 900);
  try {
    const url=process.argv[2]||'https://api-docs.deepseek.com/guides/thinking_mode';
    const label=new URL(url).hostname.replace(/\W+/g,'-');
    await browser.cdp('Page.navigate', { url });
    for (let i = 0; i < 60; i++) {
      if (await browser.evaluate("!!document.querySelector('h1')")) break;
      await wait(250);
    }
    const result = await browser.evaluate(`(() => {
      const data = () => [...document.querySelectorAll('*')].filter(el => {
        const css = getComputedStyle(el);
        return css.position === 'sticky' || css.position === 'fixed' ||
          (/^(auto|scroll)$/.test(css.overflowY) && el.scrollHeight > el.clientHeight + 10) || el.matches('main,footer');
      }).map(el => { const css = getComputedStyle(el); return {tag:el.tagName, cls:el.className,
        position:css.position, top:css.top, height:css.height,maxHeight:css.maxHeight,overflow:css.overflowY,
        rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
        text:el.innerText?.slice(0,100)}; });
      return {url:location.href,title:document.title,height:document.documentElement.scrollHeight,elements:data()};
    })()`);
    console.log(JSON.stringify(result, null, 2));
    fs.mkdirSync(path.resolve('tools/artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve('tools/artifacts/'+label+'-layout.json'), JSON.stringify(result, null, 2));
    const shot = await browser.cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.resolve('tools/artifacts/'+label+'-before.png'), Buffer.from(shot.data, 'base64'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
