import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Both study pages use explicit project-local neutral icons, without company branding',async()=>{
  const root=new URL('../',import.meta.url);
  for(const file of ['index.html','admin.html']) {
    const html=await fs.readFile(new URL(file,root),'utf8');
    assert.ok(html.includes('rel="icon" type="image/svg+xml" href="./study-icon.svg"'));
    assert.ok(html.includes('rel="icon" type="image/png" sizes="32x32" href="./study-icon-32.png"'));
    assert.ok(html.includes('rel="apple-touch-icon" sizes="180x180" href="./study-icon-180.png"'));
  }
  const files=['index.html','admin.html','src/main.js','src/admin.js','src/i18n.js','src/admin-i18n.js','public/study-icon.svg'];
  for(const file of files) {
    const text=await fs.readFile(new URL(file,root),'utf8');
    assert.doesNotMatch(text,/\bND\b|narl[i\u0131][\s_-]*digital/iu,`${file} must not contain company branding`);
  }
  for(const [file,size] of [['study-icon-32.png',32],['study-icon-180.png',180]]) {
    const png=await fs.readFile(new URL(`public/${file}`,root));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
});
