import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const STUDY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const OUT=path.join(STUDY,'reports/browser_qa');await fs.mkdir(OUT,{recursive:true});
const invites=JSON.parse(await fs.readFile(path.join(STUDY,'private/invitations-preview.local.json'),'utf8'));
const code=invites.at(-1).code;
const browser=await chromium.launch({headless:true,executablePath:'C:\\Users\\Serhan\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe'});
const errors=[];
try {
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:5178/',{waitUntil:'networkidle'});
    await page.locator('#access-code').fill(code);
    await page.selectOption('#role','Veterinarian');await page.selectOption('#experience','More than 5 years');await page.check('#consent');
    await page.locator('#login-submit').click();
    await page.waitForSelector('#video');
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
    await page.locator('#video').evaluate(video=>video.play());
    await page.waitForFunction(()=>document.querySelector('#viewed')?.textContent==='Viewed');
    const pixels=await page.locator('#video').evaluate(video=>{
      video.pause();const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;
      const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,128,72);const d=ctx.getImageData(0,0,128,72).data;
      let sum=0,sum2=0;for(let i=0;i<d.length;i+=4){const x=(d[i]+d[i+1]+d[i+2])/3;sum+=x;sum2+=x*x;}
      return {width:video.videoWidth,height:video.videoHeight,variance:sum2/(d.length/4)-(sum/(d.length/4))**2};
    });
    assert.equal(pixels.width,1920);assert.ok(pixels.variance>50,'Video must contain a decoded nonblank image.');
    await page.locator('input[name="score"][value="2"]').check();
    assert.ok(await page.locator('#save-next').isEnabled());
    await page.screenshot({path:path.join(OUT,`${name}-assessment.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow.');
    const overlap=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>{
      const r=b.getBoundingClientRect();return r.width && (b.scrollWidth>b.clientWidth+2 || b.scrollHeight>b.clientHeight+2);
    }).map(b=>b.id));assert.deepEqual(overlap,[]);
    if(name==='desktop') {
      const before=await page.locator('#clip-position').textContent();
      await page.route('**/api/ratings/*',route=>route.abort('internetdisconnected'));
      await page.locator('#save-next').click();
      await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Draft retained'));
      assert.equal(await page.locator('#clip-position').textContent(),before,'Failed save must not advance.');
      await page.unroute('**/api/ratings/*');
      await page.locator('#save-next').click();
      await page.waitForFunction(previous=>document.querySelector('#clip-position')?.textContent!==previous,before);
      await page.reload({waitUntil:'networkidle'});
      await page.waitForSelector('#video');
      assert.match(await page.locator('#progress-label').textContent(),/^\d+ of \d+ assessed$/);
      await page.locator('#clip-list').click();await page.waitForSelector('#recordings-dialog[open]');
      assert.ok(await page.locator('.clip-button.is-rated').count()>=1,'Confirmed save survives reload.');
      await page.locator('#recordings-dialog .close-dialog').click();
    }
    await fs.writeFile(path.join(OUT,`${name}-verification.json`),JSON.stringify({viewport:{width,height},decoded_video:pixels,no_horizontal_overflow:true,no_button_overflow:true},null,2));
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(OUT,'Browser_QA.json'),JSON.stringify({passed:true,desktop_and_mobile:true,actual_video_decoded:true,failed_save_does_not_advance:true,central_save_survives_reload:true,page_errors:errors},null,2));
  console.log('Desktop and mobile QA passed: real video playback, layout, offline failure and server persistence.');
} finally {await browser.close();}
