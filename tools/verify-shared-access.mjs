import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.serhan-narli.workers.dev';
const website=process.env.LCS_SITE_URL || 'https://deepresearcher.github.io/cattle-locomotion-scoring-study/';
const secrets=JSON.parse(await fs.readFile(path.join(ROOT,'private/server_credentials.local.json'),'utf8'));
async function request(resource,{token=secrets.ADMIN_SECRET,data,method=data?'POST':'GET'}={}) {
  const response=await fetch(endpoint+'/api'+resource,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  assert.ok(response.ok,`${resource}: ${response.status}`);return response.json();
}
const access=await request('/admin/shared-access',{data:{is_test:true}});
const browser=await chromium.launch({headless:true,executablePath:'C:\\Users\\Serhan\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe'});
const contexts=[],identities=[],errors=[];
const OUT=path.join(ROOT,'reports/shared_access_qa');await fs.mkdir(OUT,{recursive:true});
async function login(page) {
  await page.locator('#access-code').fill(access.code);
  await page.selectOption('#role','Researcher');await page.selectOption('#experience','More than 5 years');await page.check('#consent');
  const done=page.waitForResponse(r=>r.url()===endpoint+'/api/session' && r.request().method()==='POST');
  await page.locator('#login-submit').click();
  const response=await done;assert.equal(response.status(),200);
  assert.match(response.request().postDataJSON().participant_key,/^[a-f0-9]{64}$/);
  const session=await response.json();assert.equal(session.is_test,true);assert.equal(session.access_mode,'shared');
  await page.waitForSelector('#video');return session;
}
try {
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height}});contexts.push(context);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(website,{waitUntil:'networkidle'});
    const session=await login(page);identities.push(session.rater_id);
    assert.equal((await request('/study',{token:session.token})).ratings.length,0);
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=2,null,{timeout:60000});
    await page.locator('#video').evaluate(async video=>{await video.play();await new Promise(resolve=>setTimeout(resolve,400));video.pause();});
    assert.ok(await page.locator('#video').evaluate(video=>video.videoWidth>0 && video.currentTime>0));
    assert.ok(await page.locator('#new-participant').isVisible());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:true});
    if(name==='desktop') {
      await page.locator('input[name="score"][value="2"]').check();
      await page.locator('#notes').fill('AUTOMATED SHARED-ACCESS TEST ONLY. Exclude from research.');
      const position=await page.locator('#clip-position').textContent();
      await page.locator('#save-next').click();
      await page.waitForFunction(previous=>document.querySelector('#clip-position')?.textContent!==previous,position);
      assert.equal((await request('/study',{token:session.token})).ratings.length,1);
      await page.locator('#sign-out').click();await page.waitForSelector('#access-code');
      const resumed=await login(page);assert.equal(resumed.rater_id,session.rater_id);
      assert.equal((await request('/study',{token:resumed.token})).ratings.length,1);
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#new-participant').click();await page.waitForSelector('#access-code');
      const next=await login(page);assert.notEqual(next.rater_id,session.rater_id);
      assert.equal((await request('/study',{token:next.token})).ratings.length,0);
    }
  }
  assert.notEqual(identities[0],identities[1]);assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(ROOT,'reports/Shared_Access_Verification.json'),JSON.stringify({passed:true,website,endpoint,same_code_separate_browser_participants:true,same_browser_resumes_existing_ratings:true,new_participant_does_not_overwrite_old_ratings:true,desktop_and_mobile_playback:true,all_verification_participants_are_test_data:true,page_errors:errors,checked_at:new Date().toISOString()},null,2));
  console.log('Common-code browser separation, resume, new participant and playback verified.');
} finally {
  await browser.close();await request('/admin/revoke-shared-access',{data:{id:access.id}});
}
