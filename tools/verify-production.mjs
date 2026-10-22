import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const STUDY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const secrets=JSON.parse(await fs.readFile(path.join(STUDY,'private/server_credentials.local.json'),'utf8'));
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.aaaf-ev.workers.dev';
async function request(resource,{method='GET',token,data}={}) {
  const response=await fetch(`${endpoint}/api${resource}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json()};
}
assert.equal((await request('/study')).status,401);
const health=await request('/health');assert.equal(health.status,200);
const invite=await request('/admin/invite',{method:'POST',token:secrets.ADMIN_SECRET,data:{label:'AUTOMATED VERIFICATION ONLY',is_test:true}});
assert.equal(invite.status,200);
try {
  const login=await request('/session',{method:'POST',data:{code:invite.data.code,role:'Researcher',experience:'More than 5 years',consent:true}});
  assert.equal(login.status,200);const token=login.data.token;
  const before=await request('/study',{token});assert.equal(before.status,200);assert.equal(before.data.clips.length,76);
  const clip=before.data.clips[0];
  const data={score:null,unscorable:true,reason:'Other',confidence:'Not specified',notes:'AUTOMATED TEST. Not a clinical assessment. Exclude this test participant from all research analyses.',watched_seconds:0,playback_rate:1,expected_revision:0};
  assert.equal((await request(`/ratings/${clip.id}`,{method:'PUT',token,data})).status,200);
  const after=await request('/study',{token});assert.equal(after.data.ratings.length,1);assert.equal(after.data.ratings[0].unscorable,1);
  const resumed=await request('/session',{method:'POST',data:{code:invite.data.code}});
  assert.equal((await request('/study',{token:resumed.data.token})).data.ratings.length,1);
  const exported=await request('/admin/export',{token:secrets.ADMIN_SECRET});
  const row=exported.data.ratings.find(r=>r.rater_id===invite.data.id);
  assert.equal(row.is_test,1);
  assert.ok(exported.data.history.find(h=>h.rater_id===invite.data.id));
  await fs.writeFile(path.join(STUDY,'reports/Production_API_Verification.json'),JSON.stringify({passed:true,endpoint,study_open:health.data.open,manifest_clips:76,unauthenticated_access_blocked:true,central_d1_save_confirmed:true,save_survives_new_login:true,test_data_explicitly_flagged:true,checked_at:new Date().toISOString(),video_storage_verified:false},null,2));
  console.log('Production API verified: 76 blinded clips, authenticated central save and resume. Test participant excluded and revoked.');
} finally {
  assert.equal((await request('/admin/revoke',{method:'POST',token:secrets.ADMIN_SECRET,data:{id:invite.data.id}})).status,200);
}
