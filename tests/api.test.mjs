import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import fs from 'node:fs/promises';
import {createHmac} from 'node:crypto';

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
    const full=await mf.dispatchFetch('https://api.example.org'+media.video);
    assert.equal(full.status,200);assert.equal(full.headers.get('content-range'),null);
    assert.deepEqual([...new Uint8Array(await full.arrayBuffer())],[1,2,3,4,5]);
    const head=await mf.dispatchFetch('https://api.example.org'+media.video,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'5');assert.equal((await head.arrayBuffer()).byteLength,0);
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

async function sharedHarness(open=true,version=1) {
  const mf=new Miniflare({scriptPath:new URL('../worker/index.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),modules:true,compatibilityDate:'2026-07-01',d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{AUTH_SECRET:'test-shared-auth-secret',ADMIN_SECRET:'test-shared-admin-secret',ALLOWED_ORIGINS:'https://example.org',STUDY_ID:'shared-test',STUDY_VERSION:String(version),STUDY_OPEN:String(open)}});
  const db=await mf.getD1Database('DB');
  const schema=await fs.readFile(new URL('../worker/schema.sql',import.meta.url),'utf8');
  for(const sql of schema.split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
  const call=async(resource,{data,token,method=data?'POST':'GET'}={})=>{
    const response=await mf.dispatchFetch(`https://api.example.org/api${resource}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  };
  return {mf,db,call,admin:'test-shared-admin-secret'};
}

test('Administrator results sessions are short-lived and read-only; participant access cannot read results',async()=>{
  const {mf,db,call,admin}=await sharedHarness();
  try {
    assert.equal((await call('/admin/session',{method:'POST'})).status,401);
    const access=(await call('/admin/shared-access',{token:admin,data:{}})).data;
    assert.equal((await call('/admin/session',{method:'POST',token:access.code})).status,401);
    const participant=(await call('/session',{data:{code:access.code,participant_key:'a'.repeat(64),consent:true,role:'Veterinarian',experience:'More than 5 years'}})).data;
    assert.equal((await call('/admin/export',{token:participant.token})).status,401);
    const session=await call('/admin/session',{token:admin,method:'POST'});
    assert.equal(session.status,200);
    const {token,expires}=session.data;
    assert.ok(token.startsWith('readonly.'));assert.ok(expires<=Date.now()/1000+3600);
    const exported=await call('/admin/export',{token});
    assert.equal(exported.status,200);assert.deepEqual(exported.data.clips,[]);
    assert.ok(!JSON.stringify(exported.data).includes('code_hash'));
    assert.equal((await call('/admin/invite',{token,data:{label:'Must not be created'}})).status,401);
    assert.equal((await call('/admin/session',{token,method:'POST'})).status,401);
    assert.equal((await call('/study',{token})).status,401);
    assert.equal((await call('/admin/export',{token:token.slice(0,-1)+(token.endsWith('a')?'b':'a')})).status,401);
    const expired=`readonly.${Math.floor(Date.now()/1000)-10}.${'a'.repeat(32)}`;
    const signed=`${expired}.${createHmac('sha256',admin).update(`shared-test:${expired}`).digest('hex')}`;
    assert.equal((await call('/admin/export',{token:signed})).status,401);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM raters').first()).n,1);
    for(let i=0;i<21;i++) await call('/admin/session',{token:'invalid',method:'POST'});
    assert.equal((await call('/admin/session',{token:admin,method:'POST'})).status,429);
  } finally {await mf.dispose();}
});

test('One common code isolates browser participants and preserves individual preview access',async()=>{
  const {mf,db,call,admin}=await sharedHarness();
  try {
    const clip={id:'clip-112233aabbcc',duration:3,frames:90,width:1920,height:1080};
    await call('/admin/clips',{token:admin,data:{clips:[clip]}});
    assert.equal((await call('/admin/shared-access',{data:{}})).status,401);
    const access=(await call('/admin/shared-access',{token:admin,data:{}})).data;
    const profile={code:access.code,role:'Veterinarian',experience:'More than 5 years',consent:true};
    assert.equal((await call('/session',{data:profile})).status,400);
    assert.equal((await call('/session',{data:{...profile,participant_key:'bad'}})).status,400);
    assert.equal((await call('/session',{data:{...profile,participant_key:'a'.repeat(64),consent:false}})).status,400);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM raters').first()).n,0);
    const a=(await call('/session',{data:{...profile,participant_key:'a'.repeat(64),is_test:true}})).data;
    const b=(await call('/session',{data:{...profile,participant_key:'b'.repeat(64)}})).data;
    assert.notEqual(a.rater_id,b.rater_id);assert.equal(a.access_mode,'shared');assert.equal(a.is_test,false);
    const rating={score:2,unscorable:false,reason:'',confidence:'Moderate',notes:'unit test',watched_seconds:0,playback_rate:1,expected_revision:0};
    assert.equal((await call(`/ratings/${clip.id}`,{method:'PUT',token:a.token,data:rating})).status,200);
    assert.equal((await call(`/ratings/${clip.id}`,{method:'PUT',token:b.token,data:{...rating,score:4}})).status,200);
    const resumed=(await call('/session',{data:{code:access.code,participant_key:'a'.repeat(64)}})).data;
    assert.equal(resumed.rater_id,a.rater_id);
    assert.equal((await call('/study',{token:resumed.token})).data.ratings[0].score,2);
    assert.equal((await call('/study',{token:b.token})).data.ratings[0].score,4);
    const parallel=await Promise.all([1,2].map(()=>call('/session',{data:{...profile,participant_key:'c'.repeat(64)}})));
    assert.equal(parallel[0].data.rater_id,parallel[1].data.rater_id);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM raters').first()).n,3);
    const preview=(await call('/admin/invite',{token:admin,data:{label:'Owner preview',is_test:true}})).data;
    const owner=(await call('/session',{data:{...profile,code:preview.code}})).data;
    assert.equal(owner.is_test,true);assert.equal(owner.access_mode,'individual');
    await call('/admin/revoke',{token:admin,data:{id:a.rater_id}});
    assert.equal((await call('/session',{data:{...profile,participant_key:'a'.repeat(64)}})).status,401);
    await call('/admin/revoke-shared-access',{token:admin,data:{id:access.id}});
    assert.equal((await call('/study',{token:b.token})).status,401);
    assert.equal((await call('/session',{data:{...profile,participant_key:'d'.repeat(64)}})).status,401);
    assert.equal((await call('/study',{token:owner.token})).status,200);
  } finally {await mf.dispose();}
});

test('Shared access respects the study gate and an administrator-controlled test flag',async()=>{
  const {mf,db,call,admin}=await sharedHarness(false);
  try {
    const real=(await call('/admin/shared-access',{token:admin,data:{}})).data;
    const profile={code:real.code,participant_key:'e'.repeat(64),role:'Researcher',experience:'1 to 5 years',consent:true};
    assert.equal((await call('/session',{data:profile})).status,503);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM raters').first()).n,0);
    const preview=(await call('/admin/shared-access',{token:admin,data:{is_test:true}})).data;
    const login=await call('/session',{data:{...profile,code:preview.code}});
    assert.equal(login.status,200);assert.equal(login.data.is_test,true);
  } finally {await mf.dispose();}
});

test('Version 2 isolates historical ratings, persists blinded orders and retains archived exports',async()=>{
  const {mf,db,call,admin}=await sharedHarness(true,2);
  try {
    const ids=Array.from({length:70},(_,i)=>`clip-${(i+1).toString(16).padStart(12,'0')}`);
    for(const [i,id] of ids.entries()) {
      await db.prepare('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'shared-test',2,3,90,1920,1080,id+'.mp4',id+'.jpg').run();
      await db.prepare('INSERT INTO clip_pairs VALUES(?,?)').bind(id,`private-pair-${i>=56?i-56:i}`).run();
    }
    const old='clip-ffffffffffff';
    await db.prepare('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?,?)').bind(old,'shared-test',1,3,90,1920,1080,old+'.mp4',old+'.jpg').run();
    const access=(await call('/admin/shared-access',{token:admin,data:{}})).data;
    const profile={code:access.code,participant_key:'a'.repeat(64),role:'Researcher',experience:'1 to 5 years',consent:true};
    const login=(await call('/session',{data:profile})).data;
    await db.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(login.rater_id,old,3,0,'','Moderate','historic',2,1,1,'2026-10-22',1).run();
    await db.prepare('INSERT INTO rating_history(rater_id,clip_id,payload,saved_at) VALUES(?,?,?,?)').bind(login.rater_id,old,'{}','2026-10-22').run();
    const study=(await call('/study',{token:login.token})).data;
    assert.equal(study.version,2);assert.equal(study.clips.length,70);assert.equal(study.ratings.length,0);
    assert.equal(JSON.stringify(study).includes('pair_group'),false);
    assert.equal(JSON.stringify(study).includes('private-pair'),false);
    const positions=new Map(study.clips.map((c,i)=>[c.id,i]));
    for(let i=0;i<14;i++)assert.ok(Math.abs(positions.get(ids[i])-positions.get(ids[i+56]))>=12);
    const resumed=(await call('/session',{data:profile})).data;
    assert.deepEqual((await call('/study',{token:resumed.token})).data.clips,study.clips);
    const stored=await db.prepare('SELECT clip_ids FROM study_orders WHERE rater_id=?').bind(login.rater_id).first();
    assert.deepEqual(JSON.parse(stored.clip_ids),study.clips.map(c=>c.id));
    const other=(await call('/session',{data:{...profile,participant_key:'b'.repeat(64)}})).data;
    assert.notDeepEqual((await call('/study',{token:other.token})).data.clips,study.clips);
    assert.equal((await call(`/ticket/${old}`,{token:login.token,data:{}})).status,404);
    const rating={score:2,unscorable:false,confidence:'Moderate',notes:'',reason:'',watched_seconds:0,playback_rate:1,expected_revision:0};
    assert.equal((await call(`/ratings/${old}`,{token:login.token,data:rating,method:'PUT'})).status,404);
    assert.equal((await call(`/ratings/${ids[0]}`,{token:login.token,data:rating,method:'PUT'})).status,200);
    assert.equal((await call('/study',{token:login.token})).data.ratings[0].study_version,2);
    const current=(await call('/admin/export',{token:admin})).data;
    assert.equal(current.clips.length,70);assert.equal(current.ratings.length,1);assert.equal(current.history.length,1);assert.equal(current.orders.length,2);
    const archived=(await call('/admin/export?version=1',{token:admin})).data;
    assert.equal(archived.clips.length,1);assert.equal(archived.ratings[0].notes,'historic');assert.equal(archived.history.length,1);
    assert.equal((await call('/admin/export?version=all',{token:admin})).data.ratings.length,2);
    assert.equal((await call('/admin/export?version=oops',{token:admin})).status,400);
  } finally {await mf.dispose();}
});
