import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const STUDY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(STUDY,'private');
const endpoint=process.env.LCS_API_URL || 'https://paper3-lcs-rating-api.serhan-narli.workers.dev';
assert.equal(new URL(endpoint).origin,'https://paper3-lcs-rating-api.serhan-narli.workers.dev');
const secrets=JSON.parse(await fs.readFile(path.join(PRIVATE,'server_credentials.local.json'),'utf8'));
const response=await fetch(`${endpoint}/api/admin/invite`,{method:'POST',headers:{Authorization:`Bearer ${secrets.ADMIN_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({label:'Owner preview',is_test:true})});
assert.ok(response.ok,`Owner access: ${response.status}`);
const invite={...await response.json(),endpoint,is_test:true,created_at:new Date().toISOString()};
const invitationsFile=path.join(PRIVATE,'invitations-production-preview.local.json');
let invitations=[];
try {invitations=JSON.parse(await fs.readFile(invitationsFile,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
invitations.push(invite);
await fs.writeFile(invitationsFile,JSON.stringify(invitations,null,2),{mode:0o600});
const ownerFile=path.join(PRIVATE,'Owner_Preview_Access.local.json');
let owner={};
try {owner=JSON.parse(await fs.readFile(ownerFile,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
if(owner.production_access_code) {
  owner.previous_production_access=[...(owner.previous_production_access || []),{
    code:owner.production_access_code,url:owner.published_url,endpoint:owner.production_endpoint || 'https://paper3-lcs-rating-api.aaaf-ev.workers.dev'
  }];
}
Object.assign(owner,{
  published_url:'https://deepresearcher.github.io/cattle-locomotion-scoring-study/',
  production_endpoint:endpoint,production_account:'serhan.narli@gmail.com',
  production_access_code:invite.code,production_rater_id:invite.id,
  production_note:'Private remote videos enabled. Owner preview ratings are test data and excluded from research CSV exports.',
  updated_at:new Date().toISOString()
});
await fs.writeFile(ownerFile,JSON.stringify(owner,null,2),{mode:0o600});
console.log(`Owner preview access saved privately: ${ownerFile}`);
