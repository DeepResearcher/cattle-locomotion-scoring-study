import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PRIVATE=path.join(ROOT,'private');
await fs.mkdir(PRIVATE,{recursive:true});
const command=process.argv[2];
const credentialsPath=path.join(PRIVATE,'server_credentials.local.json');
if(command==='init') {
  try {await fs.access(credentialsPath); console.log('Existing private credentials retained.');}
  catch {await fs.writeFile(credentialsPath,JSON.stringify({AUTH_SECRET:randomBytes(32).toString('hex'),ADMIN_SECRET:randomBytes(32).toString('hex')},null,2),{mode:0o600}); console.log('Private server credentials generated. No values printed.');}
  process.exit(0);
}
const credentials=JSON.parse(await fs.readFile(credentialsPath,'utf8'));
const endpoint=process.env.LCS_API_URL || 'http://127.0.0.1:8788';
async function call(resource,data) {
  const response=await fetch(`${endpoint}/api/admin/${resource}`,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${credentials.ADMIN_SECRET}`,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
  const value=await response.json();
  if(!response.ok) throw new Error(`${response.status}: ${value.error}`);
  return value;
}
if(command==='shared-code') {
  const local=/^http:\/\/(127\.0\.0\.1|localhost):/.test(endpoint);
  const file=path.join(PRIVATE,local?'Shared_Study_Access_Local.local.json':'Shared_Study_Access.local.json');
  let existing;
  try {existing=JSON.parse(await fs.readFile(file,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
  if(existing) {
    if(existing.endpoint!==endpoint)throw new Error('Existing shared code belongs to a different endpoint.');
    const {access}=await call('shared-access');
    if(!access.some(row=>row.id===existing.id && row.active && !row.is_test))throw new Error('The saved shared code is not active.');
    console.log(`Existing common study code retained privately: ${file}`);
  } else {
    const value=await call('shared-access',{is_test:false});
    await fs.writeFile(file,JSON.stringify({id:value.id,endpoint,website:local?'http://127.0.0.1:5178/':'https://deepresearcher.github.io/cattle-locomotion-scoring-study/',shared_access_code:value.code.match(/.{1,4}/g).join('-'),created_at:new Date().toISOString(),note:'Share this one study code only with authorised raters. Each browser keeps a separate participant identity. Use the same browser to resume. On a shared device, choose New participant for a different rater. Owner preview uses its existing separate test code.'},null,2),{mode:0o600});
    console.log(`Common study code saved privately: ${file}`);
  }
} else if(command==='seed') {
  const manifest=JSON.parse(await fs.readFile(path.join(PRIVATE,'rating_manifest.json'),'utf8'));
  console.log(await call('clips',{clips:manifest.clips}));
} else if(command==='invite') {
  const count=Number(process.argv[3] || 1);
  if(!Number.isInteger(count)||count<1||count>100) throw new Error('Count must be 1 to 100.');
  const isTest=process.argv.includes('--test');
  const scope=/^http:\/\/(127\.0\.0\.1|localhost):/.test(endpoint)?'':'production-';
  const file=path.join(PRIVATE,`invitations-${scope}${isTest?'preview':'participants'}.local.json`);
  let existing=[];try{existing=JSON.parse(await fs.readFile(file,'utf8'));}catch{}
  for(let i=0;i<count;i++) {
    const label=`${isTest?'Preview':'Participant'} ${String(existing.length+1).padStart(2,'0')}`;
    existing.push({...await call('invite',{label,is_test:isTest}),endpoint,created_at:new Date().toISOString()});
    await fs.writeFile(file,JSON.stringify(existing,null,2),{mode:0o600});
  }
  console.log(`Saved ${count} access codes privately: ${file}`);
} else if(command==='export') {
  const value=await call(process.argv.includes('--all-versions')?'export?version=all':'export');
  const dir=path.join(ROOT,'collected_ratings');await fs.mkdir(dir,{recursive:true});
  const stem=new Date().toISOString().replace(/[:.]/g,'-');
  await fs.writeFile(path.join(dir,`${stem}.json`),JSON.stringify(value,null,2));
  const rows=value.ratings.filter(r=>!r.is_test);
  const fields=['rater_id','label','clip_id','score','unscorable','reason','confidence','notes','watched_seconds','playback_rate','revision','updated_at','study_version','role','experience','consent_at'];
  const quote=x=>{
    const text=String(x??'');
    const safe=typeof x==='string' && /^[=+\-@\t\r]/.test(text)?"'"+text:text;
    return '"'+safe.replace(/"/g,'""')+'"';
  };
  await fs.writeFile(path.join(dir,`${stem}.csv`),'\ufeff'+[fields,...rows.map(r=>fields.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n'));
  console.log(`Exported ${rows.length} non-test ratings and full audit history: ${dir}`);
} else if(command==='revoke') {
  if(!process.argv[3]) throw new Error('Provide the participant ID from the private invitation file.');
  console.log(await call('revoke',{id:process.argv[3]}));
} else throw new Error('Commands: init, shared-code, seed, invite [count] [--test], export, revoke <participant-id>');
