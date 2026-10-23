import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const STUDY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.serhan-narli.workers.dev';
const website=process.env.LCS_SITE_URL || 'https://deepresearcher.github.io/cattle-locomotion-scoring-study/';
const isLocal=website.startsWith('http://127.0.0.1:');
const version=process.env.LCS_VERIFY_VERSION || '1';
const clipCount=Number(process.env.LCS_VERIFY_CLIPS || 76);
const suffix=version==='1'?'':`_v${version}`;
const OUT=path.join(STUDY,(isLocal?'reports/local_language_qa':'reports/published_browser_qa')+suffix);
await fs.mkdir(OUT,{recursive:true});
const secrets=JSON.parse(await fs.readFile(path.join(STUDY,'private/server_credentials.local.json'),'utf8'));
async function admin(resource,data) {
  const response=await fetch(`${endpoint}/api/admin/${resource}`,{method:'POST',headers:{Authorization:`Bearer ${secrets.ADMIN_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(data)});
  assert.ok(response.ok,`Admin ${resource}: ${response.status}`);
  return response.json();
}
const invite=await admin('invite',{label:'PUBLISHED BROWSER TEST ONLY',is_test:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[],errors=[];
try {
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow-mobile',320,780]]) {
    const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(website,{waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),'de');
    assert.equal(await page.locator('h1').textContent(),'Studienzugang');
    await page.locator('#access-code').fill(invite.code);
    await page.selectOption('#role','Researcher');
    await page.selectOption('#experience','More than 5 years');
    await page.check('#consent');
    await page.selectOption('#language','en');
    assert.equal(await page.locator('h1').textContent(),'Study Access');
    assert.equal(await page.locator('#access-code').inputValue(),invite.code);
    assert.equal(await page.locator('#role').inputValue(),'Researcher');
    assert.ok(await page.locator('#consent').isChecked());
    await page.selectOption('#language','de');
    const loggedIn=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/session' && r.request().method()==='POST');
    await page.locator('#login-submit').click();
    assert.equal((await loggedIn).status(),200);
    await page.waitForSelector('#video');
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=2,null,{timeout:60000});
    assert.ok(await page.locator('#save-next').isDisabled());
    await page.locator('input[name="score"][value="2"]').check();
    assert.equal(await page.locator('#viewed').textContent(),'');
    assert.ok(await page.locator('#save-next').isEnabled(),'Selecting a score must not require 80% playback.');
    await page.selectOption('#confidence','Moderate');
    await page.locator('#notes').fill('AUTOMATED TEST ONLY. Not a clinical rating.');
    const playback=await page.locator('#video').evaluate(video=>{
      window.__verificationVideo=video;video.pause();video.currentTime=Math.min(0.3,video.duration/4);
      return {src:video.src,time:video.currentTime};
    });
    await page.selectOption('#language','en');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.ok(await page.locator('input[name="score"][value="2"]').isChecked());
    assert.equal(await page.locator('#confidence').inputValue(),'Moderate');
    assert.equal(await page.locator('#notes').inputValue(),'AUTOMATED TEST ONLY. Not a clinical rating.');
    assert.equal(await page.locator('#video').evaluate(video=>video===window.__verificationVideo),true);
    assert.equal(await page.locator('#video').evaluate(video=>video.src),playback.src);
    assert.ok(Math.abs(await page.locator('#video').evaluate(video=>video.currentTime)-playback.time)<0.05);
    await page.selectOption('#language','de');
    await page.locator('#guide-open').click();
    assert.equal(await page.locator('#guide-dialog h2').textContent(),'Bewertungsleitfaden');
    await page.locator('#guide-dialog .close-dialog').click();
    const pixels=await page.locator('#video').evaluate(async video=>{
      video.crossOrigin='anonymous';video.load();
      if(video.readyState<2) await new Promise((resolve,reject)=>{
        video.addEventListener('loadeddata',resolve,{once:true});
        video.addEventListener('error',()=>reject(new Error('Private video failed to decode.')),{once:true});
      });
      await video.play();
      await new Promise(resolve=>setTimeout(resolve,700));
      video.pause();
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;
      const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,128,72);
      const d=ctx.getImageData(0,0,128,72).data;
      let sum=0,sum2=0;
      for(let i=0;i<d.length;i+=4){const x=(d[i]+d[i+1]+d[i+2])/3;sum+=x;sum2+=x*x;}
      return {width:video.videoWidth,height:video.videoHeight,current_time:video.currentTime,variance:sum2/(d.length/4)-(sum/(d.length/4))**2};
    });
    assert.ok(pixels.width>0 && pixels.current_time>0.1 && pixels.variance>50);
    assert.ok(await page.locator('#save-next').isEnabled());
    await page.screenshot({path:path.join(OUT,`${name}-assessment.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const overflowing=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>{
      const r=b.getBoundingClientRect();return r.width && (b.scrollWidth>b.clientWidth+2 || b.scrollHeight>b.clientHeight+2);
    }).map(b=>b.id));
    assert.deepEqual(overflowing,[]);
    const before=await page.locator('#clip-position').textContent();
    if(name==='desktop') {
      await page.route('**/api/ratings/*',route=>route.abort('internetdisconnected'));
      await page.locator('#save-next').click();
      await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Entwurf'));
      assert.equal(await page.locator('#clip-position').textContent(),before);
      await page.unroute('**/api/ratings/*');
    }
    const saved=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/ratings/') && r.request().method()==='PUT');
    await page.locator('#save-next').click();
    const response=await saved;
    assert.equal(response.status(),200);
    const payload=response.request().postDataJSON();
    assert.equal(payload.score,2);assert.equal(payload.confidence,'Moderate');assert.equal(payload.reason,'');
    await page.waitForFunction(previous=>document.querySelector('#clip-position')?.textContent!==previous,before);
    await page.reload({waitUntil:'networkidle'});
    await page.waitForSelector('#video');
    assert.equal(await page.locator('html').getAttribute('lang'),'de');
    assert.match(await page.locator('#progress-label').textContent(),new RegExp(`^[1-9]\\d* (?:of ${clipCount} assessed|von ${clipCount} beurteilt)$`));
    await page.selectOption('#language','en');
    await page.reload({waitUntil:'networkidle'});
    await page.waitForSelector('#video');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.match(await page.locator('#progress-label').textContent(),new RegExp(`^[1-9]\\d* of ${clipCount} assessed$`));
    await page.locator('input[name="score"][value="unable"]').check();
    assert.ok(await page.locator('#save-next').isDisabled());
    await page.selectOption('#reason','Other');
    await page.selectOption('#language','de');
    assert.equal(await page.locator('#reason').inputValue(),'Other');
    assert.equal(await page.locator('#reason option:checked').textContent(),'Sonstiges');
    assert.ok(await page.locator('#save-next').isEnabled());
    results.push({viewport:{width,height},decoded_video:pixels,no_overflow:true,central_save_survives_reload:true,german_default:true,english_available:true,language_persists:true,selection_enables_save_without_playback_gate:true,language_preserves_inputs_and_video:true,canonical_rating_values_preserved:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(STUDY,(isLocal?'reports/Local_Language_Verification':'reports/Published_Interface_Verification')+suffix+'.json'),JSON.stringify({
    passed:true,website,endpoint,remote_private_video_playback:true,desktop_and_mobile:true,
    failed_save_retains_draft_and_does_not_advance:true,results,page_errors:errors,checked_at:new Date().toISOString()
  },null,2));
  console.log('Published desktop/mobile private video playback and central saving verified.');
} finally {
  await browser.close();
  await admin('revoke',{id:invite.id});
}
