import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import fs from 'node:fs/promises';

test('access control, blinded manifest, independent ratings, revisions and private media',async()=>{
  const mf=new Miniflare({scriptPath:new URL('../worker/index.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),modules:true,compatibilityDate:'2026-07-01',
    d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{AUTH_SECRET:'test-only-strong-auth-secret-32bytes',ADMIN_SECRET:'test-only-administrator-password',ALLOWED_ORIGINS:'https://example.org',STUDY_ID:'test',STUDY_OPEN:'true'}});
  try{
    const db=await mf.getD1Database('DB');
    const schema=await fs.readFile(new URL('../worker/schema.sql',import.meta.url),'utf8');
    for(const statement of schema.split(';').map(x=>x.trim()).filter(Boolean)) await db.prepare(statement).run();
    const call=async(path,{method='GET',data,token,origin}={})=>{
      const response=await mf.dispatchFetch(`https://api.example.org/api${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(origin?{Origin:origin}: {})},body:data?JSON.stringify(data):undefined});
      return {status:response.status,headers:response.headers,body:await response.text()};
    };
    const admin='test-only-administrator-password';
    assert.equal((await call('/study')).status,401);
    assert.equal((await call('/study',{origin:'https://evil.example'})).status,403);
    assert.equal((await call('/admin/export')).status,401);
    const clips=[{id:'clip-012345abcdef',duration:2,frames:60,width:1920,height:1080},{id:'clip-fedcba543210',duration:3,frames:90,width:1920,height:1080}];
    assert.equal((await call('/admin/clips',{method:'POST',token:admin,data:{clips}})).status,200);
    assert.equal((await call('/admin/clips',{method:'POST',token:admin,data:{clips}})).status,409);
    const a=JSON.parse((await call('/admin/invite',{method:'POST',token:admin,data:{label:'A'}})).body);
    const b=JSON.parse((await call('/admin/invite',{method:'POST',token:admin,data:{label:'B'}})).body);
    assert.equal((await call('/session',{method:'POST',data:{code:a.code}})).status,400);
    const signin=async code=>JSON.parse((await call('/session',{method:'POST',data:{code,role:'Veterinarian',experience:'More than 5 years',consent:true}})).body).token;
    const ta=await signin(a.code),tb=await signin(b.code);
    assert.ok(ta && tb && ta!==tb);
    const s=JSON.parse((await call('/study',{token:ta})).body);
    assert.equal(s.clips.length,2); assert.equal(s.ratings.length,0);
    assert.ok(!JSON.stringify(s).includes('source_video'));
    const rating={score:3,unscorable:false,reason:'',confidence:'Moderate',notes:'test',watched_seconds:2,playback_rate:1,expected_revision:0};
    assert.equal((await call(`/ratings/${clips[0].id}`,{method:'PUT',token:ta,data:{...rating,score:6}})).status,400);
    assert.equal((await call(`/ratings/${clips[0].id}`,{method:'PUT',token:ta,data:rating})).status,200);
    assert.equal((await call(`/ratings/${clips[0].id}`,{method:'PUT',token:ta,data:rating})).status,409);
    assert.equal(JSON.parse((await call('/study',{token:tb})).body).ratings.length,0);
    assert.equal(JSON.parse((await call('/study',{token:ta})).body).ratings[0].score,3);
    assert.equal((await call(`/ratings/${clips[0].id}`,{method:'PUT',token:ta,data:{...rating,score:4,expected_revision:1}})).status,200);
    assert.equal((await call(`/ratings/${clips[1].id}`,{method:'PUT',token:ta,data:{...rating,score:null,unscorable:true,reason:'Too short'}})).status,200);
    const bucket=await mf.getR2Bucket('MEDIA');await bucket.put(`${clips[0].id}.mp4`,new Uint8Array([1,2,3,4,5]));
    assert.equal((await call(`/media/${clips[0].id}.mp4`)).status,401);
    const media=JSON.parse((await call(`/ticket/${clips[0].id}`,{method:'POST',token:ta,data:{}})).body);
    const range=await mf.dispatchFetch('https://api.example.org'+media.video,{headers:{Range:'bytes=1-3'}});
    assert.equal(range.status,206); assert.equal(range.headers.get('content-range'),'bytes 1-3/5'); assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[2,3,4]);
    const exported=JSON.parse((await call('/admin/export',{token:admin})).body);
    assert.equal(exported.ratings.length,2); assert.equal(exported.history.length,3);
    assert.ok(!JSON.stringify(exported).includes('code_hash'));
    await call('/admin/revoke',{method:'POST',token:admin,data:{id:a.id}});
    assert.equal((await call('/study',{token:ta})).status,401);
    assert.equal((await mf.dispatchFetch('https://api.example.org'+media.video)).status,401);
    assert.equal((await call('/session',{method:'POST',data:{code:a.code}})).status,401);
    console.log('Private media, isolation, authentication, validation, history and revocation verified.');
  } finally {await mf.dispose();}
});
