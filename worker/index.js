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
  const row = await env.DB.prepare('SELECT s.rater_id,s.expires,r.label,r.is_test FROM sessions s JOIN raters r ON r.id=s.rater_id WHERE s.token_hash=? AND r.active=1 AND s.expires>?')
    .bind(hash, Math.floor(Date.now()/1000)).first();
  if (!row) fail(401, 'Please sign in again.');
  return {...row, tokenHash: hash};
}
async function clips(env) {
  return (await env.DB.prepare('SELECT * FROM clips WHERE study_id=?').bind(env.STUDY_ID).all()).results;
}
async function admin(request, env) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!env.ADMIN_SECRET || !constantEqual(await sha(token), await sha(env.ADMIN_SECRET))) fail(401, 'Unauthorized.');
}
async function route(request, env) {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api/, '');
  if (path === '/health' && request.method === 'GET') return json({ok:true, open:env.STUDY_OPEN === 'true'});
  if (path.startsWith('/admin/')) {
    await admin(request, env);
    if (path === '/admin/clips' && request.method === 'POST') {
      const data = await body(request);
      if (!Array.isArray(data.clips) || !data.clips.length || data.clips.length>250) fail(400, 'Invalid manifest.');
      const existing = await clips(env);
      if (existing.length) fail(409, 'A study manifest is already registered. It is immutable.');
      const statements = data.clips.map(c => {
        if (!/^clip-[a-f0-9]{12}$/.test(c.id) || !Number.isFinite(c.duration) || c.duration<=0 || !Number.isInteger(c.frames) || c.frames<1 || !Number.isInteger(c.width) || !Number.isInteger(c.height)) fail(400,'Invalid clip.');
        return env.DB.prepare('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?,?)').bind(c.id, env.STUDY_ID, 1, c.duration, c.frames, c.width, c.height, `${c.id}.mp4`, `${c.id}.jpg`);
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
      const ratings = (await env.DB.prepare('SELECT t.*,r.label,r.role,r.experience,r.is_test,r.consent_at FROM ratings t JOIN raters r ON r.id=t.rater_id ORDER BY t.rater_id,t.clip_id').all()).results;
      const history = (await env.DB.prepare('SELECT h.* FROM rating_history h ORDER BY h.id').all()).results;
      const raters = (await env.DB.prepare('SELECT id,label,active,is_test,role,experience,consent_at FROM raters').all()).results;
      return json({study_id:env.STUDY_ID,exported_at:new Date().toISOString(),ratings,history,raters});
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
    const rater = await env.DB.prepare('SELECT * FROM raters WHERE code_hash=? AND active=1').bind(await mac(env.AUTH_SECRET,code)).first();
    if (!rater) fail(401, 'Access code not recognised.');
    if (env.STUDY_OPEN !== 'true' && !rater.is_test) fail(503,'The study is not open yet. Please contact the researcher.');
    if (!rater.consent_at) {
      if (data.consent!==true || !['Veterinarian','Researcher','Farmer / hoof care professional','Student','Other'].includes(data.role) || !['Less than 1 year','1 to 5 years','More than 5 years'].includes(data.experience)) fail(400,'Please complete consent and experience details.');
      await env.DB.prepare('UPDATE raters SET role=?,experience=?,consent_version=?,consent_at=? WHERE id=?')
        .bind(data.role,data.experience,CONSENT,new Date().toISOString(),rater.id).run();
    }
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
      env.DB.prepare('DELETE FROM login_limits WHERE expires<?').bind(now),
      env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await sha(token),rater.id,now+86400)
    ]);
    return json({token,rater_id:rater.id,label:rater.label,is_test:!!rater.is_test});
  }
  if (path.startsWith('/media/')) {
    if (!['GET','HEAD'].includes(request.method)) fail(405,'Method not allowed.');
    const id = path.slice(7), ticket = url.searchParams.get('ticket') || '';
    const [expires,hash,signature] = ticket.split('.');
    if (!/^clip-[a-f0-9]{12}\.(mp4|jpg)$/.test(id) || !/^\d{10}$/.test(expires || '') || Number(expires)<Date.now()/1000 || Number(expires)>Date.now()/1000+1900 || !/^[a-f0-9]{64}$/.test(hash || '') || !constantEqual(signature, await mac(env.AUTH_SECRET,`${id}:${expires}:${hash}`))) fail(401,'Media access expired.');
    await session(request,env,hash);
    const clip = await env.DB.prepare('SELECT id FROM clips WHERE id=? AND study_id=?').bind(id.split('.')[0],env.STUDY_ID).first();
    if (!clip) fail(404,'Not found.');
    if (!env.MEDIA) fail(503,'Video storage is not configured.');
    const range = request.headers.get('range');
    if (range && !/^bytes=\d*-\d*$/.test(range)) fail(416,'Invalid range.');
    let object;
    try { object = await env.MEDIA.get(id, range ? {range:request.headers} : undefined); }
    catch { fail(416,'Invalid range.'); }
    if (!object) fail(404,'Video unavailable. Please contact the researcher.');
    const headers = new Headers({'Content-Type':id.endsWith('.mp4')?'video/mp4':'image/jpeg','Accept-Ranges':'bytes','Cache-Control':'private, no-store','Content-Length':String(object.range?.length ?? object.size)});
    if (object.range) headers.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
    return new Response(request.method==='HEAD'?null:object.body,{status:object.range?206:200,headers});
  }
  const current = await session(request, env);
  if (env.STUDY_OPEN !== 'true' && !current.is_test) fail(503,'The study is paused.');
  if (path === '/session' && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(current.tokenHash).run();
    return json({ok:true});
  }
  if (path === '/study' && request.method === 'GET') {
    const rows = await clips(env);
    const ordered = [];
    for (const c of rows) ordered.push({id:c.id,duration:c.duration,frames:c.frames,width:c.width,height:c.height,sort:await mac(env.AUTH_SECRET,`${current.rater_id}:${c.id}`)});
    ordered.sort((a,b)=>a.sort.localeCompare(b.sort));
    const ratings = (await env.DB.prepare('SELECT * FROM ratings WHERE rater_id=?').bind(current.rater_id).all()).results;
    return json({id:env.STUDY_ID,version:1,consent_version:CONSENT,clips:ordered.map(({sort,...c})=>c),ratings});
  }
  if (path.startsWith('/ticket/') && request.method === 'POST') {
    const id = path.slice(8);
    const c = await env.DB.prepare('SELECT id FROM clips WHERE id=? AND study_id=?').bind(id,env.STUDY_ID).first();
    if (!c) fail(404,'Not found.');
    const expires = Math.floor(Date.now()/1000)+1800;
    const signed = async suffix => `${expires}.${current.tokenHash}.${await mac(env.AUTH_SECRET,`${id}.${suffix}:${expires}:${current.tokenHash}`)}`;
    return json({video:`/api/media/${id}.mp4?ticket=${await signed('mp4')}`,poster:`/api/media/${id}.jpg?ticket=${await signed('jpg')}`});
  }
  if (path.startsWith('/ratings/') && request.method === 'PUT') {
    const id = path.slice(9), data = await body(request);
    const clip = await env.DB.prepare('SELECT * FROM clips WHERE id=? AND study_id=?').bind(id,env.STUDY_ID).first();
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
        .bind(current.rater_id,id,payload.score,unscorable?1:0,payload.reason,data.confidence,notes,data.watched_seconds,data.playback_rate,revision,at,1,data.expected_revision),
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
