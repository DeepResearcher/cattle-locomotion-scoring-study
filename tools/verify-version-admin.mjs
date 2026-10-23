import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const website=process.env.LCS_SITE_URL || 'https://deepresearcher.github.io/cattle-locomotion-scoring-study/';
const out=path.join(root,'reports/version2_admin_qa');await fs.mkdir(out,{recursive:true});
const secrets=JSON.parse(await fs.readFile(path.join(root,'private/server_credentials.local.json'),'utf8'));
const browser=await chromium.launch({headless:true,channel:'chrome'}),errors=[],results=[];
try {
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
    const context=await browser.newContext({viewport:{width,height},acceptDownloads:true}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${website}admin.html`,{waitUntil:'networkidle'});
    assert.equal(await page.locator('html').getAttribute('lang'),'de');
    await page.locator('#admin-key').fill(secrets.ADMIN_SECRET);await page.locator('#signin').click();
    await page.waitForFunction(()=>document.querySelector('#version-filter')?.value==='2');
    assert.match(await page.locator('#data-time').textContent(),/70/);
    assert.equal(await page.locator('#include-tests').isChecked(),false);
    await page.selectOption('#version-filter','1');
    await page.waitForFunction(()=>document.querySelector('#data-time')?.textContent.includes('76'));
    assert.equal(await page.locator('#version-filter').inputValue(),'1');
    const downloadEvent=page.waitForEvent('download');await page.locator('#json').click();const download=await downloadEvent;
    assert.ok(download.suggestedFilename().startsWith('lcs-ratings-v1-'));
    const exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));
    assert.equal(exported.selected_version,1);assert.equal(exported.clips.length,76);
    assert.ok(exported.ratings.every(r=>!r.is_test && r.study_version===1));
    await page.selectOption('#version-filter','2');
    await page.waitForFunction(()=>document.querySelector('#data-time')?.textContent.includes('70'));
    await page.selectOption('#language','en');
    assert.equal(await page.locator('#version-filter').inputValue(),'2');
    await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const wide=await page.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width && b.scrollWidth>b.clientWidth+2).map(b=>b.id));
    assert.deepEqual(wide,[]);
    const currentDownload=page.waitForEvent('download');await page.locator('#json').click();const current=await currentDownload;
    assert.ok(current.suggestedFilename().startsWith('lcs-ratings-v2-'));
    const value=JSON.parse(await fs.readFile(await current.path(),'utf8'));
    assert.equal(value.selected_version,2);assert.equal(value.clips.length,70);assert.ok(value.ratings.every(r=>!r.is_test));
    await page.locator('#logout').click();await page.waitForSelector('#admin-key');
    results.push({name,width,height,version_switch:true,versioned_downloads:true,no_overflow:true,tests_excluded:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(out,'Verification.json'),JSON.stringify({passed:true,website,results,errors,checked_at:new Date().toISOString()},null,2));
  console.log('Admin version selection and private exports verified on desktop and mobile.');
} finally {await browser.close();}
