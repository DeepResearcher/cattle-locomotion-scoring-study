import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const live=process.argv.includes('--production');
const website=process.env.LCS_SITE_URL || (live?'https://deepresearcher.github.io/cattle-locomotion-scoring-study/admin.html':'http://127.0.0.1:5178/admin.html');
const OUT=path.join(ROOT,'reports',live?'admin_production_qa':'admin_local_qa');
await fs.mkdir(OUT,{recursive:true});
const secret=live?JSON.parse(await fs.readFile(path.join(ROOT,'private/server_credentials.local.json'),'utf8')).ADMIN_SECRET:'fixture-admin-key-only';
const fixture={study_id:'fixture',exported_at:'2026-10-22T13:00:00.000Z',clips:[{id:'clip-012345abcdef'},{id:'clip-fedcba543210'}],
  raters:[{id:'real-a',label:'Participant A',is_test:0,active:1,role:'Veterinarian',experience:'More than 5 years',consent_at:'2026-10-22T12:00:00Z'},
    {id:'real-b',label:'Participant B',is_test:0,active:1,role:'Researcher',experience:'1 to 5 years',consent_at:'2026-10-22T12:00:00Z'},
    {id:'preview',label:'TEST ONLY',is_test:1,active:0,role:'Researcher',experience:'1 to 5 years',consent_at:'2026-10-22T12:00:00Z'}],
  ratings:[{rater_id:'real-a',label:'Participant A',clip_id:'clip-012345abcdef',score:2,unscorable:0,confidence:'Moderate',notes:'=not-a-formula',updated_at:'2026-10-22T12:05:00Z'},
    {rater_id:'real-a',label:'Participant A',clip_id:'clip-fedcba543210',score:null,unscorable:1,reason:'View unsuitable',confidence:'High',notes:'<b>plain text only</b>',updated_at:'2026-10-22T12:06:00Z'},
    {rater_id:'preview',label:'TEST ONLY',clip_id:'clip-fedcba543210',score:5,unscorable:0,confidence:'High',notes:'Excluded test',updated_at:'2026-10-22T12:07:00Z'}],
  history:[{rater_id:'real-a',id:1},{rater_id:'preview',id:2}]};
const browser=await chromium.launch({headless:true,executablePath:'C:\\Users\\Serhan\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe'});
const results=[],errors=[];
async function download(page,button) {
  const pending=page.waitForEvent('download');await page.locator(button).click();
  const value=await pending,stream=await value.createReadStream();
  const chunks=[];for await (const chunk of stream) chunks.push(chunk);
  return {name:value.suggestedFilename(),text:Buffer.concat(chunks).toString('utf8')};
}
try {
  for (const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow-mobile',320,780]]) {
    const context=await browser.newContext({viewport:{width,height},acceptDownloads:true}),page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    let failRefresh=false;
    if (!live) await page.route('**/api/admin/**',async route=>{
      const request=route.request(),resource=new URL(request.url()).pathname;
      if (resource.endsWith('/session')) return route.fulfill({status:request.headers().authorization===`Bearer ${secret}`?200:401,json:request.headers().authorization===`Bearer ${secret}`?{token:'fixture-readonly-token',expires:Math.floor(Date.now()/1000)+3600}:{error:'Unauthorized.'}});
      return route.fulfill({status:failRefresh?503:200,json:failRefresh?{error:'Unavailable'}:fixture});
    });
    await page.goto(website,{waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),'de');
    assert.equal(await page.locator('#ratings').count(),0);
    await page.locator('#admin-key').fill('wrong-not-a-participant-code');
    await page.locator('#signin').click();await page.locator('#login-error').filter({hasText:'Anmeldung fehlgeschlagen'}).waitFor();
    await page.locator('#admin-key').fill(secret);
    await page.locator('#signin').click();await page.locator('#csv:enabled').waitFor();
    assert.equal(await page.locator('#include-tests').isChecked(),false);
    assert.equal(await page.locator('#admin-key').count(),0);
    if (!live) {
      assert.deepEqual(await page.locator('#summary dd').allTextContents(),['2','2','1','1']);
      assert.equal(await page.locator('#ratings tbody tr').count(),2);
      assert.equal(await page.locator('#ratings td b').count(),0);
    }
    const csv=await download(page,'#csv'),json=JSON.parse((await download(page,'#json')).text);
    assert.equal(json.includes_test_data,false);
    const realIds=new Set(json.raters.map(r=>r.id));
    assert.ok(json.raters.every(r=>!Number(r.is_test)));
    assert.ok(json.ratings.every(r=>!Number(r.is_test) && realIds.has(r.rater_id)));
    assert.ok(json.history.every(r=>realIds.has(r.rater_id)));
    assert.ok(csv.text.startsWith('\ufeff"rater_id"'));
    const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
    assert.ok(!storage.includes(secret));assert.ok(!storage.includes('readonly.'));
    await page.screenshot({path:path.join(OUT,`${name}.png`),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page must not overflow horizontally.');
    await page.selectOption('#language','en');
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    if (!live) {
      await page.check('#include-tests');assert.equal(await page.locator('#ratings tbody tr').count(),3);
      const withTests=await download(page,'#json');assert.ok(withTests.name.includes('including-tests'));
      assert.equal(JSON.parse(withTests.text).history.length,2);
      await page.selectOption('#participant-filter','real-a');
      assert.equal(await page.locator('#participants tbody tr').count(),1);
      assert.equal(JSON.parse((await download(page,'#json')).text).ratings.length,2);
      assert.ok(csv.text.includes('"\'=not-a-formula"'));
      failRefresh=true;await page.locator('#refresh').click();
      await page.locator('#admin-status').filter({hasText:'Could not refresh'}).waitFor();
      assert.equal(await page.locator('#ratings tbody tr').count(),2);
    }
    await page.locator('#logout').click();assert.equal(await page.locator('#ratings').count(),0);
    assert.equal(await page.locator('#admin-key').inputValue(),'');
    await page.reload();assert.equal(await page.locator('#ratings').count(),0);
    results.push({viewport:name,width,height,ratings_exported:json.ratings.length,participants_exported:json.raters.filter(r=>r.consent_at).length,clips:json.clips.length,test_data_excluded:true,csv_download:true,json_download:true,logout_verified:true,no_page_overflow:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
const report={verified_at:new Date().toISOString(),website,mode:live?'production-read-only':'mocked-ui-fixtures',passed:true,results,errors};
await fs.writeFile(path.join(ROOT,'reports',live?'Admin_Production_Verification.json':'Admin_Local_Verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
