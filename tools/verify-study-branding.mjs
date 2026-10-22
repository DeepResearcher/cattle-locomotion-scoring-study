import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base=process.env.LCS_SITE_URL || 'http://127.0.0.1:5178/';
const live=base.startsWith('https://');
const browser=await chromium.launch({headless:true,executablePath:'C:\\Users\\Serhan\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe'});
const results=[];
try {
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    for(const file of ['', 'admin.html']) {
      const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(new URL(file,base).href,{waitUntil:'networkidle'});
      assert.doesNotMatch(await page.locator('body').innerText(),/\bND\b|narl[i\u0131][\s_-]*digital/iu);
      const links=await page.locator('link[rel="icon"],link[rel="apple-touch-icon"]').evaluateAll(nodes=>nodes.map(n=>n.href));
      assert.equal(links.length,3);
      for(const href of links) {
        assert.ok(href.startsWith(base));
        const response=await context.request.get(href);assert.equal(response.status(),200);
        assert.ok(response.headers()['content-type'].startsWith('image/'));
      }
      const icon=await page.evaluate(async()=>{
        const img=new Image();img.src=document.querySelector('link[type="image/png"]').href;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
        const values=ctx.getImageData(0,0,32,32).data;
        let colored=0;for(let i=0;i<values.length;i+=4) if(values[i]<100 && values[i+1]>70 && values[i+2]>50) colored++;
        return {width:img.naturalWidth,height:img.naturalHeight,colored};
      });
      assert.equal(icon.width,32);assert.equal(icon.height,32);assert.ok(icon.colored>30);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.deepEqual(errors,[]);
      const out=new URL(`../../reports/branding_${live?'production':'local'}_${name}_${file?'admin':'study'}.png`,import.meta.url);
      await page.screenshot({path:out.pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
      results.push({page:file || 'index.html',viewport:name,neutral_icons_loaded:3,no_company_branding:true,icon_pixels:icon.colored});
      await context.close();
    }
  }
} finally {await browser.close();}
const report={verified_at:new Date().toISOString(),website:base,passed:true,results};
await fs.writeFile(new URL(`../../reports/Neutral_Branding_${live?'Production':'Local'}_Verification.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
