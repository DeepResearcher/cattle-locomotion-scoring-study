import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const STUDY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.serhan-narli.workers.dev';
const secrets=JSON.parse(await fs.readFile(path.join(STUDY,'private/server_credentials.local.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(STUDY,'private/rating_manifest.json'),'utf8'));
async function api(resource,{token=secrets.ADMIN_SECRET,data,method=data?'POST':'GET'}={}) {
  const response=await fetch(`${endpoint}/api${resource}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  const value=await response.json();
  assert.ok(response.ok,`API ${resource}: ${response.status}`);
  return value;
}
const invite=await api('/admin/invite',{data:{label:'PRIVATE MEDIA VERIFICATION ONLY',is_test:true}});
let lastVideo;
const checked=[];
try {
  const {token}=await api('/session',{data:{code:invite.code,consent:true,role:'Researcher',experience:'More than 5 years'}});
  const study=await api('/study',{token});
  assert.deepEqual(study.clips.map(c=>c.id).sort(),manifest.clips.map(c=>c.id).sort());
  for(const clip of manifest.clips) {
    const tickets=await api(`/ticket/${clip.id}`,{token,data:{}});
    for(const [kind,extension,mime] of [['video','mp4','video/mp4'],['poster','jpg','image/jpeg']]) {
      const filename=path.join(STUDY,'private/rating_web_media',`${clip.id}.${extension}`);
      const handle=await fs.open(filename,'r');
      let expected,size;
      try {
        size=(await handle.stat()).size;
        expected=Buffer.alloc(64);
        const {bytesRead}=await handle.read(expected,0,64,0);
        assert.equal(bytesRead,64);
      } finally {await handle.close();}
      const mediaUrl=`${endpoint}${tickets[kind]}`;
      const response=await fetch(mediaUrl,{headers:{Range:'bytes=0-63',Origin:'https://deepresearcher.github.io'}});
      assert.equal(response.status,206,`${clip.id}.${extension} range`);
      assert.equal(response.headers.get('content-range'),`bytes 0-63/${size}`);
      assert.equal(response.headers.get('content-type'),mime);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
      assert.equal(response.headers.get('access-control-allow-origin'),'https://deepresearcher.github.io');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
      const unsigned=await fetch(`${endpoint}/api/media/${clip.id}.${extension}`);
      assert.equal(unsigned.status,401);
      await unsigned.arrayBuffer();
      if(kind==='video') lastVideo=mediaUrl;
      checked.push({clip:clip.id,extension,size,range_bytes_verified:64,unsigned_status:401});
    }
    console.log(`Verified private clip ${checked.length/2}/${manifest.clips.length}`);
  }
  const deniedOrigin=await fetch(lastVideo,{headers:{Origin:'https://untrusted.example',Range:'bytes=0-63'}});
  assert.equal(deniedOrigin.status,403);
  await deniedOrigin.arrayBuffer();
} finally {
  await api('/admin/revoke',{data:{id:invite.id}});
}
const revoked=await fetch(lastVideo,{headers:{Range:'bytes=0-63'}});
assert.equal(revoked.status,401);
await revoked.arrayBuffer();
await fs.writeFile(path.join(STUDY,'reports/Production_Media_Verification.json'),JSON.stringify({
  passed:true,endpoint,account_id:'cb0df0b951dfb3d3182518ae9ad7618e',clips:manifest.clips.length,objects:checked.length,
  every_object_exists_with_expected_size_and_initial_bytes:true,range_streaming:true,
  unsigned_access_blocked:true,untrusted_origin_blocked:true,revocation_invalidates_media:true,
  checked_at:new Date().toISOString(),checked
},null,2));
console.log('All private media verified. Temporary test access revoked.');
