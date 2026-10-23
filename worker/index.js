import {separatedOrder} from './order.mjs';
const enc = new TextEncoder();
const CONSENT = '2026-10-22-v1';
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
async function mac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i=0; i<a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
const json = (value, status=200) => Response.json(value, {status});
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON required.');
  if (Number(request.headers.get('content-length') || 0) > 100000) fail(413, 'Request too large.');
  const text = await request.text();
  if (text.length > 100000) fail(413, 'Request too large.');
  try { return JSON.parse(text); } catch { fail(400, 'Invalid JSON.'); }
}
async function session(request, env, tokenHash) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!tokenHash && !/^[a-f0-9]{64}$/.test(token || '')) fail(401, 'Please sign in again.');
  const hash = tokenHash || await sha(token);
  const row = await env.DB.prepare('SELECT s.rater_id,s.expires,r.label,r.is_test FROM sessions s JOIN raters r ON r.id=s.rater_id LEFT JOIN shared_participants p ON p.rater_id=r.id LEFT JOIN shared_access a ON a.id=p.access_id WHERE s.token_hash=? AND r.active=1 AND s.expires>? AND (p.access_id IS NULL OR a.active=1)')
    .bind(hash, Math.floor(Date.now()/1000)).first();
  if (!row) fail(401, 'Please sign in again.');
  return {...row, tokenHash: hash};
}
const activeVersion=env=>Number(env.STUDY_VERSION || 1);
async function clips(env,version=activeVersion(env)) {
  return (await env.DB.prepare('SELECT c.*,p.pair_group FROM clips c LEFT JOIN clip_pairs p ON p.clip_id=c.id WHERE c.study_id=? AND (? IS NULL OR c.version=?)')
    .bind(env.STUDY_ID,version,version).all()).results;
}
async function admin(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!env.ADMIN_SECRET || !constantEqual(await sha(token), await sha(env.ADMIN_SECRET))) fail(401, 'Unauthorized.');
}
async function readAdmin(request, env) {
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'') || '';
  if (!token.startsWith('readonly.')) return admin(request,env);
  const match=/^readonly\.(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  const now=Math.floor(Date.now()/1000);
  if (!match || !env.ADMIN_SECRET || Number(match[1])<=now || Number(match[1])>now+3600) fail(401,'Unauthorized.');
  const value=token.slice(0,token.lastIndexOf('.'));
  if (!constantEqual(match[3],await mac(env.ADMIN_SECRET,`${env.STUDY_ID}:${value}`))) fail(401,'Unauthorized.');
}
function consentDetails(data) {
  if (data.consent!==true || !['Veterinarian','Researcher','Farmer / hoof care professional','Student','Other'].includes(data.role) || !['Less than 1 year','1 to 5 years','More than 5 years'].includes(data.experience)) fail(400,'Please complete consent and experience details.');
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '');
  if (path === '/health' && request.method === 'GET') return json({ok:true, open:env.STUDY_OPEN === 'true'});
  if (path.startsWith('/admin/')) {
    if (path==='/admin/session' && request.method==='POST') {
      const now=Math.floor(Date.now()/1000),ip=request.headers.get('cf-connecting-ip') || 'local';
      const key=await mac(env.AUTH_SECRET,`admin-login:${ip}:${Math.floor(now/600)}`);
      await env.DB.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,now+600).run();
      const limit=await env.DB.prepare('SELECT attempts FROM login_limits WHERE key=?').bind(key).first();
      if (limit.attempts>20) fail(429,'Too many attempts. Please wait 10 minutes.');
      await admin(request,env);
      const expires=now+3600,value=`readonly.${expires}.${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
      return json({token:`${value}.${await mac(env.ADMIN_SECRET,`${env.STUDY_ID}:${value}`)}`,expires});
    }
    if (path==='/admin/export' && request.method==='GET') await readAdmin(request,env);
    else await admin(request, env);
    if (path === '/admin/shared-access' && request.method === 'GET') {
      const access=(await env.DB.prepare('SELECT id,active,is_test,created_at FROM shared_access WHERE study_id=?').bind(env.STUDY_ID).all()).results;
      return json({access});
    }
    if (path === '/admin/shared-access' && request.method === 'POST') {
      const data=await body(request),id=crypto.randomUUID();
      const code=hex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();
      await env.DB.prepare('INSERT INTO shared_access (id,study_id,code_hash,is_test,created_at) VALUES(?,?,?,?,?)')
        .bind(id,env.STUDY_ID,await mac(env.AUTH_SECRET,code),data.is_test===true?1:0,new Date().toISOString()).run();
      return json({id,code,is_test:data.is_test===true});
    }
    if (path === '/admin/revoke-shared-access' && request.method === 'POST') {
      const data=await body(request);
      await env.DB.prepare('UPDATE shared_access SET active=0 WHERE id=? AND study_id=?').bind(String(data.id),env.STUDY_ID).run();
      return json({ok:true});
    }
    if (path === '/admin/clips' && request.method === 'POST') {
      const data = await body(request);
      if (!Array.isArray(data.clips) || !data.clips.length || data.clips.length>250) fail(400, 'Invalid manifest.');
      const existing = await clips(env);
      if (existing.length) fail(409, 'A study manifest is already registered. It is immutable.');
      const statements = data.clips.map(c => {
        if (!/^clip-[a-f0-9]{12}$/.test(c.id) || !Number.isFinite(c.duration) || c.duration<=0 || !Number.isInteger(c.frames) || c.frames<1 || !Number.isInteger(c.width) || !Number.isInteger(c.height)) fail(400,'Invalid clip.');
        return env.DB.prepare('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?,?)').bind(c.id, env.STUDY_ID, activeVersion(env), c.duration, c.frames, c.width, c.height, `${c.id}.mp4`, `${c.id}.jpg`);
      });
      // Bind order explicitly so the manifest never contains original source names.
      await env.DB.batch(statements);
      return json({registered: data.clips.length});
    }
    if (path === '/admin/invite' && request.method === 'POST') {
      const data = await body(request);
      if (typeof data.label!=='string' || data.label.length>80) fail(400,'Invalid label.');
      const code = hex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase();
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO raters (id,code_hash,label,is_test,created_at) VALUES(?,?,?,?,?)')
        .bind(id, await mac(env.AUTH_SECRET, code), data.label, data.is_test===true?1:0, new Date().toISOString()).run();
      return json({id,label:data.label,code});
    }
    if (path === '/admin/revoke' && request.method === 'POST') {
      const data = await body(request);
      await env.DB.prepare('UPDATE raters SET active=0 WHERE id=?').bind(String(data.id)).run();
      return json({ok:true});
    }
    if (path === '/admin/export' && request.method === 'GET') {
      const requested=url.searchParams.get('version');
      if(requested && requested!=='all' && !/^[1-9]\d*$/.test(requested))fail(400,'Invalid study version.');
      const version=requested==='all'?null:requested?Number(requested):activeVersion(env);
      const ratings = (await env.DB.prepare('SELECT t.*,r.label,r.role,r.experience,r.is_test,r.consent_at FROM ratings t JOIN raters r ON r.id=t.rater_id JOIN clips c ON c.id=t.clip_id WHERE c.study_id=? AND (? IS NULL OR c.version=?) ORDER BY t.rater_id,t.clip_id').bind(env.STUDY_ID,version,version).all()).results;
      const history = (await env.DB.prepare('SELECT h.* FROM rating_history h JOIN clips c ON c.id=h.clip_id WHERE c.study_id=? AND (? IS NULL OR c.version=?) ORDER BY h.id').bind(env.STUDY_ID,version,version).all()).results;
      const raters = (await env.DB.prepare('SELECT id,label,active,is_test,role,experience,consent_at FROM raters').all()).results;
      const manifest=(await clips(env,version)).map(({id,version,duration})=>({id,version,duration}));
      const versions=(await env.DB.prepare('SELECT version,COUNT(*) AS clips FROM clips WHERE study_id=? GROUP BY version ORDER BY version DESC').bind(env.STUDY_ID).all()).results;
      const orders=(await env.DB.prepare('SELECT * FROM study_orders WHERE study_id=? AND (? IS NULL OR version=?)').bind(env.STUDY_ID,version,version).all()).results;
      return json({study_id:env.STUDY_ID,active_version:activeVersion(env),selected_version:version,available_versions:versions,exported_at:new Date().toISOString(),clips:manifest,ratings,history,raters,orders});
    }
    fail(404, 'Not found.');
  }
  if (path === '/session' && request.method === 'POST') {
    const data = await body(request);
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    const now = Math.floor(Date.now()/1000), slot = Math.floor(now/600);
    const key = await mac(env.AUTH_SECRET, `login:${ip}:${slot}`);
    await env.DB.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,now+600).run();
    const limit = await env.DB.prepare('SELECT attempts FROM login_limits WHERE key=?').bind(key).first();
    if (limit.attempts>20) fail(429, 'Too many attempts. Please wait 10 minutes.');
    const code = String(data.code || '').replace(/[\s-]/g,'').toUpperCase();
    if (!/^[A-F0-9]{24}$/.test(code)) fail(401, 'Access code not recognised.');
    const codeHash=await mac(env.AUTH_SECRET,code);
    const access=await env.DB.prepare('SELECT * FROM shared_access WHERE code_hash=? AND study_id=? AND active=1').bind(codeHash,env.STUDY_ID).first();
    let rater;
    if (access) {
      if (!/^[a-f0-9]{64}$/.test(data.participant_key || '')) fail(400,'Browser participant identity is missing. Please reload the page.');
      if (env.STUDY_OPEN !== 'true' && !access.is_test) fail(503,'The study is not open yet. Please contact the researcher.');
      const participantHash=await mac(env.AUTH_SECRET,`shared-participant:${access.id}:${data.participant_key}`);
      rater=await env.DB.prepare('SELECT * FROM raters WHERE code_hash=?').bind(participantHash).first();
      if (!rater) {
        consentDetails(data);
        const id=crypto.randomUUID();
        // A shared door code never identifies a rater; a separate browser key does.
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO raters (id,code_hash,label,is_test,created_at) VALUES(?,?,?,?,?)').bind(id,participantHash,`Participant ${id.slice(0,8).toUpperCase()}`,access.is_test,new Date().toISOString()),
          env.DB.prepare('INSERT OR IGNORE INTO shared_participants (rater_id,access_id) SELECT id,? FROM raters WHERE code_hash=?').bind(access.id,participantHash)
        ]);
        rater=await env.DB.prepare('SELECT * FROM raters WHERE code_hash=?').bind(participantHash).first();
      }
    } else {
      rater=await env.DB.prepare('SELECT * FROM raters WHERE code_hash=?').bind(codeHash).first();
      if (rater) {
        const shared=await env.DB.prepare('SELECT rater_id FROM shared_participants WHERE rater_id=?').bind(rater.id).first();
        if (shared) fail(401,'Access code not recognised.');
      }
    }
    if (!rater || !rater.active) fail(401, 'Access code not recognised.');
    if (env.STUDY_OPEN !== 'true' && !rater.is_test) fail(503,'The study is not open yet. Please contact the researcher.');
    if (!rater.consent_at) {
      consentDetails(data);
      await env.DB.prepare('UPDATE raters SET role=?,experience=?,consent_version=?,consent_at=? WHERE id=?')
        .bind(data.role,data.experience,CONSENT,new Date().toISOString(),rater.id).run();
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
      env.DB.prepare('DELETE FROM login_limits WHERE expires<?').bind(now),
      env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha(token),rater.id,now+86400)
    ]);
    return json({token,rater_id:rater.id,label:rater.label,is_test:!!rater.is_test,access_mode:access?'shared':'individual'});
  }
  if (path.startsWith('/media/')) {
    if (!['GET','HEAD'].includes(request.method)) fail(405,'Method not allowed.');
    const id = path.slice(7), ticket = url.searchParams.get('ticket') || '';
    const [expires,hash,signature] = ticket.split('.');
    if (!/^clip-[a-f0-9]{12}\.(mp4|jpg)$/.test(id) || !/^\d{10}$/.test(expires || '') || Number(expires)<Date.now()/1000 || Number(expires)>Date.now()/1000+1900 || !/^[a-f0-9]{64}$/.test(hash || '') || !constantEqual(signature, await mac(env.AUTH_SECRET,`${id}:${expires}:${hash}`))) fail(401,'Media access expired.');
    await session(request,env,hash);
    const clip = await env.DB.prepare('SELECT id FROM clips WHERE id=? AND study_id=? AND version=?').bind(id.split('.')[0],env.STUDY_ID,activeVersion(env)).first();
    if (!clip) fail(404,'Not found.');
    if (!env.MEDIA) fail(503,'Video storage is not configured.');
    const range = request.headers.get('range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) fail(416,'Invalid range.');
    let object;
    try { object = await env.MEDIA.get(id, range ? {range:request.headers} : undefined); }
    catch { fail(416,'Invalid range.'); }
    if (!object) fail(404,'Video unavailable. Please contact the researcher.');
    const partial=Boolean(range && object.range);
    const headers = new Headers({'Content-Type':id.endsWith('.mp4')?'video/mp4':'image/jpeg','Accept-Ranges':'bytes','Cache-Control':'private, no-store','Content-Length':String(partial?object.range.length:object.size)});
    if (partial) headers.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
    return new Response(request.method==='HEAD'?null:object.body,{status:partial?206:200,headers});
  }
  const current = await session(request, env);
  if (env.STUDY_OPEN !== 'true' && !current.is_test) fail(503,'The study is paused.');
  if (path === '/session' && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(current.tokenHash).run();
    return json({ok:true});
  }
  if (path === '/study' && request.method === 'GET') {
    const rows = await clips(env);
    let ordered;
    if(activeVersion(env)>=2) {
      const saved=await env.DB.prepare('SELECT clip_ids FROM study_orders WHERE rater_id=? AND study_id=? AND version=?').bind(current.rater_id,env.STUDY_ID,activeVersion(env)).first();
      if(saved) {
        const byId=new Map(rows.map(c=>[c.id,c])),ids=JSON.parse(saved.clip_ids);
        if(ids.length!==rows.length || new Set(ids).size!==rows.length || ids.some(id=>!byId.has(id)))fail(503,'Study order is unavailable. Please contact the researcher.');
        ordered=ids.map(id=>byId.get(id));
      } else {
        ordered=separatedOrder(rows,await mac(env.AUTH_SECRET,`${current.rater_id}:${env.STUDY_ID}:${activeVersion(env)}:order-v1`));
        await env.DB.prepare('INSERT OR IGNORE INTO study_orders VALUES(?,?,?,?,?)').bind(current.rater_id,env.STUDY_ID,activeVersion(env),JSON.stringify(ordered.map(c=>c.id)),new Date().toISOString()).run();
      }
    } else {
      ordered=[];
      for(const c of rows)ordered.push({...c,sort:await mac(env.AUTH_SECRET,`${current.rater_id}:${c.id}`)});
      ordered.sort((a,b)=>a.sort.localeCompare(b.sort));
    }
    const ratings = (await env.DB.prepare('SELECT t.* FROM ratings t JOIN clips c ON c.id=t.clip_id WHERE t.rater_id=? AND c.study_id=? AND c.version=?').bind(current.rater_id,env.STUDY_ID,activeVersion(env)).all()).results;
    return json({id:env.STUDY_ID,version:activeVersion(env),consent_version:CONSENT,clips:ordered.map(({id,duration,frames,width,height})=>({id,duration,frames,width,height})),ratings});
  }
  if (path.startsWith('/ticket/') && request.method === 'POST') {
    const id = path.slice(8);
    const c = await env.DB.prepare('SELECT id FROM clips WHERE id=? AND study_id=? AND version=?').bind(id,env.STUDY_ID,activeVersion(env)).first();
    if (!c) fail(404,'Not found.');
    const expires = Math.floor(Date.now()/1000)+1800;
    const signed = async suffix => `${expires}.${current.tokenHash}.${await mac(env.AUTH_SECRET,`${id}.${suffix}:${expires}:${current.tokenHash}`)}`;
    return json({video:`/api/media/${id}.mp4?ticket=${await signed('mp4')}`,poster:`/api/media/${id}.jpg?ticket=${await signed('jpg')}`});
  }
  if (path.startsWith('/ratings/') && request.method === 'PUT') {
    const id = path.slice(9), data = await body(request);
    const clip = await env.DB.prepare('SELECT * FROM clips WHERE id=? AND study_id=? AND version=?').bind(id,env.STUDY_ID,activeVersion(env)).first();
    if (!clip) fail(404,'Not found.');
    const unscorable = data.unscorable===true;
    const reason = String(data.reason || '').trim(), notes=String(data.notes || '').trim();
    if (!unscorable && (!Number.isInteger(data.score) || data.score<1 || data.score>5)) fail(400,'Choose an LCS.');
    if (unscorable && !['Too short','View unsuitable','Animal obscured','Video quality','Other'].includes(reason)) fail(400,'Choose a reason.');
    if (notes.length>1500 || !['Not specified','Low','Moderate','High'].includes(data.confidence)) fail(400,'Invalid rating.');
    if (!Number.isFinite(data.watched_seconds) || data.watched_seconds<0 || data.watched_seconds>86400 || ![0.5,1].includes(data.playback_rate)) fail(400,'Invalid playback information.');
    if (!Number.isInteger(data.expected_revision) || data.expected_revision<0) fail(400,'Invalid revision.');
    const previous = await env.DB.prepare('SELECT revision FROM ratings WHERE rater_id=? AND clip_id=?').bind(current.rater_id,id).first();
    if ((previous?.revision || 0)!==data.expected_revision) fail(409,'A newer rating exists. Reload before editing.');
    const at=new Date().toISOString(), revision=data.expected_revision+1;
    const payload={score:unscorable?null:data.score,unscorable,reason:unscorable?reason:'',confidence:data.confidence,notes,watched_seconds:data.watched_seconds,playback_rate:data.playback_rate,revision,updated_at:at};
    const result=await env.DB.batch([
      env.DB.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(rater_id,clip_id) DO UPDATE SET score=excluded.score,unscorable=excluded.unscorable,reason=excluded.reason,confidence=excluded.confidence,notes=excluded.notes,watched_seconds=excluded.watched_seconds,playback_rate=excluded.playback_rate,revision=excluded.revision,updated_at=excluded.updated_at WHERE ratings.revision=?')
        .bind(current.rater_id,id,payload.score,unscorable?1:0,payload.reason,data.confidence,notes,data.watched_seconds,data.playback_rate,revision,at,clip.version,data.expected_revision),
      env.DB.prepare('INSERT INTO rating_history(rater_id,clip_id,payload,saved_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM ratings WHERE rater_id=? AND clip_id=? AND updated_at=?)').bind(current.rater_id,id,JSON.stringify(payload),at,current.rater_id,id,at)
    ]);
    if (!result[0].meta.changes) fail(409,'A newer rating exists. Reload before editing.');
    return json({...payload,clip_id:id});
  }
  fail(404,'Not found.');
}
export default {
  async fetch(request, env) {
    const origin=request.headers.get('origin'), allowed=(env.ALLOWED_ORIGINS || '').split(',');
    let response;
    try {
      if (origin && !allowed.includes(origin)) fail(403,'Origin not permitted.');
      response=request.method==='OPTIONS'?new Response(null,{status:204}):await route(request,env);
    } catch(error) {
      const status=error.status || 500;
      if (status===500) console.error('Request failed', error.name);
      response=json({error:status===500?'Server error. Your rating has not been confirmed.':error.message},status);
    }
    const headers=new Headers(response.headers);
    headers.set('Cache-Control','private, no-store');
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','no-referrer');
    headers.set('Vary','Origin');
    if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Access-Control-Allow-Methods','GET,HEAD,POST,PUT,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers','Authorization,Content-Type,Range');
    headers.set('Access-Control-Expose-Headers','Content-Range,Accept-Ranges,Content-Length');
    return new Response(response.body,{status:response.status,headers});
  }
};
