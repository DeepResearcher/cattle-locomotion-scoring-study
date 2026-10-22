import {Miniflare} from 'miniflare';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PRIVATE=path.join(SITE,'../private');
const secrets=JSON.parse(await fs.readFile(path.join(PRIVATE,'server_credentials.local.json'),'utf8'));
const mf=new Miniflare({
  scriptPath:path.join(SITE,'worker/index.js'),modules:true,compatibilityDate:'2026-07-01',
  host:'127.0.0.1',port:8788,
  d1Databases:{DB:'local-lcs'},d1Persist:path.join(PRIVATE,'local-d1'),
  r2Buckets:['MEDIA'],r2Persist:path.join(PRIVATE,'local-r2'),
  bindings:{...secrets,ALLOWED_ORIGINS:'http://127.0.0.1:5178,http://localhost:5178',STUDY_ID:'cattle-lcs-20261022',STUDY_OPEN:'true'}
});
const db=await mf.getD1Database('DB');
const sql=await fs.readFile(path.join(SITE,'worker/schema.sql'),'utf8');
for (const statement of sql.split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(statement).run();
const bucket=await mf.getR2Bucket('MEDIA');
const mediaDir=path.join(PRIVATE,'web_media');
async function refreshLocalMedia() {
  try {
    const markers=(await fs.readdir(PRIVATE)).filter(f=>/^clip-[a-f0-9]{12}_verification\.json$/.test(f));
    for(const file of markers) {
      const c=JSON.parse(await fs.readFile(path.join(PRIVATE,file),'utf8')).public_clip;
      for(const suffix of ['mp4','jpg']) {
        const key=`${c.id}.${suffix}`;
        if(!await bucket.head(key)) await bucket.put(key,await fs.readFile(path.join(mediaDir,key)));
      }
      await db.prepare('INSERT OR IGNORE INTO clips VALUES(?,?,?,?,?,?,?,?,?)').bind(c.id,'cattle-lcs-20261022',1,c.duration,c.frames,c.width,c.height,`${c.id}.mp4`,`${c.id}.jpg`).run();
    }
    console.log(`Local preview has ${markers.length} verified recordings. Nothing uploaded.`);
  } catch(error) {if(error.code!=='ENOENT') console.error('Local refresh failed:',error.message);}
}
await refreshLocalMedia();
const refresh=setInterval(refreshLocalMedia,30000);
console.log(`Local API: ${await mf.ready}`);
process.on('SIGINT',async()=>{clearInterval(refresh);await mf.dispose();process.exit(0);});
process.on('SIGTERM',async()=>{clearInterval(refresh);await mf.dispose();process.exit(0);});
