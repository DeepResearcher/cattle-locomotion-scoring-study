import {Activity} from 'lucide';
import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';

// Use the same neutral Lucide activity symbol as the study header.
const paths=Activity.map(([tag,attrs])=>`<${tag} ${Object.entries(attrs).map(([key,value])=>`${key}="${value}"`).join(' ')}/>`).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#ffffff"/><g transform="translate(4 4)" fill="none" stroke="#17756b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
const out=new URL('../public/',import.meta.url);
await fs.mkdir(out,{recursive:true});
await fs.writeFile(new URL('study-icon.svg',out),svg+'\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || 'C:\\Users\\Serhan\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe'});
try {
  for(const size of [32,180]) {
    const page=await browser.newPage({viewport:{width:size,height:size},deviceScaleFactor:1});
    await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ','<svg width="'+size+'" height="'+size+'" ')}</body></html>`);
    await fs.writeFile(new URL(`study-icon-${size}.png`,out),await page.locator('svg').screenshot());
    await page.close();
  }
} finally {await browser.close();}
console.log('Neutral study icons generated: SVG, 32px PNG and 180px touch icon.');
