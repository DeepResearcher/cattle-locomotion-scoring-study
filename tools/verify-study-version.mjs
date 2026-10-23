import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.serhan-narli.workers.dev';
const read=async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const secrets=await read('private/server_credentials.local.json');
const manifest=await read('private/version2_56_14/manifest.json');
const mapping=await read('private/version2_56_14/private_mapping.json');
const shared=await read('private/Shared_Study_Access.local.json');
assert.ok(process.env.LCS_BASELINE_EXPORT,'Provide the pre-migration export filename.');
const baseline=JSON.parse(await fs.readFile(process.env.LCS_BASELINE_EXPORT,'utf8'));
async function api(resource,{token=secrets.ADMIN_SECRET,data,method=data?'POST':'GET',status=200}={}) {
  const response=await fetch(`${endpoint}/api${resource}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(60000)});
  assert.equal(response.status,status,`API ${resource}`);
  return response.json();
}
const checkArchive=async()=>{
  const archive=await api('/admin/export?version=1');
  assert.equal(archive.clips.length,76);
  for(const row of baseline.ratings) {
    const found=archive.ratings.find(r=>r.clip_id===row.clip_id && r.rater_id===row.rater_id);
    assert.deepEqual(found,row,'An archived rating changed.');
  }
  for(const row of baseline.history)assert.deepEqual(archive.history.find(r=>r.id===row.id),row);
  return {ratings:baseline.ratings.length,history:baseline.history.length,research_ratings:baseline.ratings.filter(r=>!r.is_test).length};
};
const preserved=await checkArchive();
const access=await api('/admin/shared-access');
assert.ok(access.access.some(r=>r.id===shared.id && r.active && !r.is_test));
const active=await api('/admin/export');
assert.equal(active.active_version,2);assert.equal(active.clips.length,70);
assert.deepEqual(active.available_versions,[{version:2,clips:70},{version:1,clips:76}]);
const byId=new Map(mapping.clips.map(c=>[c.id,c]));
const checked=[],invites=[];
let lastVideo;
try {
  const orders=[];
  for(let i=0;i<2;i++) {
    const invite=await api('/admin/invite',{data:{label:'VERSION 2 VERIFICATION ONLY',is_test:true}});invites.push(invite);
    const auth=await api('/session',{data:{code:invite.code,consent:true,role:'Researcher',experience:'More than 5 years'}});
    invite.token=auth.token;
    const study=await api('/study',{token:auth.token});
    assert.equal(study.version,2);assert.equal(study.ratings.length,0);assert.equal(study.clips.length,70);
    const ids=study.clips.map(c=>c.id);assert.equal(new Set(ids).size,70);
    assert.deepEqual([...ids].sort(),manifest.clips.map(c=>c.id).sort());
    const seen=new Map();let pairCount=0;
    for(const [index,c] of study.clips.entries()) {
      assert.deepEqual(Object.keys(c).sort(),['duration','frames','height','id','width']);
      const group=byId.get(c.id).pair_group;
      if(seen.has(group)){assert.ok(index-seen.get(group)>=12);pairCount++;}else seen.set(group,index);
    }
    assert.equal(pairCount,14);assert.equal(seen.size,56);
    assert.deepEqual((await api('/study',{token:auth.token})).clips,study.clips);
    const again=await api('/session',{data:{code:invite.code}});
    assert.deepEqual((await api('/study',{token:again.token})).clips,study.clips);
    orders.push(ids);
    const expiredClip=baseline.clips[0].id;
    await api(`/ticket/${expiredClip}`,{token:auth.token,data:{},status:404});
  }
  assert.notDeepEqual(orders[0],orders[1]);
  const token=invites[0].token;
  for(const clip of manifest.clips) {
    const ticket=await api(`/ticket/${clip.id}`,{token,data:{}});
    for(const [kind,ext,hashKey] of [['video','mp4','sha256'],['poster','jpg','poster_sha256']]) {
      const url=`${endpoint}${ticket[kind]}`;
      const response=await fetch(url,{headers:{Origin:'https://deepresearcher.github.io'},signal:AbortSignal.timeout(120000)});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
      const hash=createHash('sha256');let size=0;
      for await (const chunk of response.body){hash.update(chunk);size+=chunk.length;}
      assert.equal(hash.digest('hex'),clip[hashKey]);
      assert.equal(size,Number(response.headers.get('content-length')));
      const range=await fetch(url,{headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(60000)});
      assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 0-63/${size}`);
      assert.equal((await range.arrayBuffer()).byteLength,64);
      checked.push({clip:clip.id,kind,size,sha256_verified:true,range_verified:true});
      if(kind==='video')lastVideo=url;
    }
    console.log(`Full private media verified: ${checked.length/2}/70`);
  }
  const id=orders[0][0];
  await api(`/ratings/${id}`,{token,method:'PUT',data:{score:null,unscorable:true,reason:'Other',confidence:'Not specified',notes:'AUTOMATED VERIFICATION ONLY',watched_seconds:0,playback_rate:1,expected_revision:0}});
  const resumed=await api('/study',{token});assert.equal(resumed.ratings.length,1);assert.equal(resumed.ratings[0].study_version,2);
  const exported=await api('/admin/export');
  assert.ok(exported.ratings.find(r=>r.rater_id===invites[0].id && r.clip_id===id && r.is_test===1));
  assert.deepEqual(JSON.parse(exported.orders.find(r=>r.rater_id===invites[0].id).clip_ids),orders[0]);
  const unsigned=await fetch(`${endpoint}/api/media/${id}.mp4`);assert.equal(unsigned.status,401);await unsigned.arrayBuffer();
  const disallowed=await fetch(lastVideo,{headers:{Origin:'https://untrusted.example'}});assert.equal(disallowed.status,403);await disallowed.arrayBuffer();
  await checkArchive();
} finally {
  for(const invite of invites)await api('/admin/revoke',{data:{id:invite.id}});
}
const revoked=await fetch(lastVideo,{headers:{Range:'bytes=0-63'}});assert.equal(revoked.status,401);await revoked.arrayBuffer();
await fs.writeFile(path.join(root,'reports/Version2_Production_Verification.json'),JSON.stringify({passed:true,checked_at:new Date().toISOString(),clips:70,cows:56,mirrors:14,minimum_pair_position_difference:12,orders_persisted:true,orders_differ_between_participants:true,shared_access_preserved:true,archive_preserved:preserved,central_test_save_verified:true,private_access_verified:true,checked},null,2));
console.log('Version 2, private media, stable separated order, central save and archived ratings verified.');
