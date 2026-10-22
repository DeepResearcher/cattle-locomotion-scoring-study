import { createIcons, Activity, LockKeyhole, LayoutGrid, LogOut, ArrowRight, ArrowLeft, RotateCcw, CircleHelp, Check, CircleCheck, Film, X, Download, ExternalLink } from 'lucide';
import './style.css';

const API = import.meta.env.VITE_API_URL || '';
const app = document.querySelector('#app');
const S = {auth:JSON.parse(sessionStorage.getItem('lcs-session') || 'null'), study:null, index:0, ratings:new Map(), dirty:false, saving:false, watched:0, viewed:false, lastTime:0, loadNumber:0};
const esc = text => String(text).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const activateIcons = () => createIcons({icons:{Activity,LockKeyhole,LayoutGrid,LogOut,ArrowRight,ArrowLeft,RotateCcw,CircleHelp,Check,CircleCheck,Film,X,Download,ExternalLink}, attrs:{'stroke-width':1.7}});
async function api(path, options={}) {
  const response = await fetch(`${API}/api${path}`, {...options, headers:{'Content-Type':'application/json', ...(S.auth?{Authorization:`Bearer ${S.auth.token}`} : {}), ...options.headers}});
  let data;
  try {data=await response.json();} catch {throw new Error('The server did not return a valid response.');}
  if (!response.ok) {const error=new Error(data.error || 'Request failed.'); error.status=response.status; throw error;}
  return data;
}
function draftKey(id) {return `lcs-draft:${S.study?.id}:${S.auth?.rater_id}:${id}`;}
function setStatus(text, state='') {
  const el=document.querySelector('#save-status');
  if (el) {el.textContent=text; el.className=`save-status ${state}`;}
}
function header() {
  return `<header class="header"><div class="brand">${icon('activity')}<div><strong>Cattle Locomotion Scoring</strong><span>Independent video assessment</span></div></div><div class="header-actions">${S.auth?`<span class="rater">${esc(S.auth.label)}${S.auth.is_test?' <small>Preview</small>':''}</span><button class="icon-button" id="clip-list" title="Recordings" aria-label="Recordings">${icon('layout-grid')}</button><button class="icon-button" id="sign-out" title="Sign out" aria-label="Sign out">${icon('log-out')}</button>`:'<span class="restricted">'+icon('lock-keyhole')+'Restricted study</span>'}</div></header>`;
}
function login(message='') {
  S.auth=null; sessionStorage.removeItem('lcs-session');
  app.innerHTML=`${header()}<main class="login-layout"><section class="login-panel"><div class="login-heading">${icon('lock-keyhole')}<h1>Study Access</h1></div>
    <form id="login-form"><label for="access-code">Personal access code</label><input id="access-code" type="password" autocomplete="current-password" required spellcheck="false" autocapitalize="characters">
    <div class="profile-fields"><label for="role">Professional background</label><select id="role" required><option value="">Select background</option>${['Veterinarian','Researcher','Farmer / hoof care professional','Student','Other'].map(x=>`<option>${x}</option>`).join('')}</select>
    <label for="experience">Locomotion scoring experience</label><select id="experience" required><option value="">Select experience</option>${['Less than 1 year','1 to 5 years','More than 5 years'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <label class="consent"><input id="consent" type="checkbox" required><span>I agree that the researcher may use my ratings, professional background and scoring experience for this study. I will not share the recordings or my access code.</span></label>
    <p class="privacy-note">Participation is voluntary. Ratings are stored under a participant code, without your name or email. You may stop at any time and contact the researcher with your participant code to request removal before analysis.</p>
    <p class="error" id="login-error" role="alert">${esc(message)}</p><button class="primary wide" type="submit" id="login-submit">Enter study ${icon('arrow-right')}</button></form></section></main>`;
  activateIcons();
  document.querySelector('#login-form').onsubmit=async event=>{
    event.preventDefault(); const button=document.querySelector('#login-submit'); button.disabled=true;
    try {
      const result=await api('/session',{method:'POST',body:JSON.stringify({code:document.querySelector('#access-code').value,role:document.querySelector('#role').value,experience:document.querySelector('#experience').value,consent:document.querySelector('#consent').checked})});
      S.auth=result; sessionStorage.setItem('lcs-session',JSON.stringify(result)); await loadStudy();
    } catch(error) {document.querySelector('#login-error').textContent=error.message; button.disabled=false;}
  };
}
async function loadStudy() {
  S.study=await api('/study'); S.ratings=new Map(S.study.ratings.map(r=>[r.clip_id,r]));
  S.index=Math.max(0,S.study.clips.findIndex(c=>!S.ratings.has(c.id)));
  S.dirty=false; render();
}
function render() {
  const total=S.study.clips.length;
  app.innerHTML=`${header()}<main class="workspace"><div class="study-bar"><div><h1>Video Assessment</h1><span id="clip-position"></span></div><div class="progress-block"><span id="progress-label"></span><progress id="progress" max="${total}" value="${S.ratings.size}" aria-label="Assessment progress"></progress></div></div>
  ${total?`<div class="work-grid"><section class="video-section" aria-label="Recording"><div class="video-shell"><video id="video" controls playsinline muted preload="auto" controlsList="nodownload" disablePictureInPicture></video><div class="video-message" id="video-message" role="status">Loading recording...</div></div><div class="video-toolbar"><div class="toolbar-group"><button id="replay" class="icon-button" title="Replay" aria-label="Replay">${icon('rotate-ccw')}</button><label class="speed-label" for="speed">Speed</label><select id="speed" aria-label="Playback speed"><option value="1">1x</option><option value="0.5">0.5x</option></select><span id="viewed" class="view-status"></span></div><span class="duration" id="duration"></span></div><div class="video-error error" id="video-error" role="alert"></div></section>
  <section class="rating-section" aria-labelledby="rating-title"><div class="section-title"><h2 id="rating-title">Locomotion Score</h2><button id="guide-open" class="icon-button" title="Scoring reference" aria-label="Scoring reference">${icon('circle-help')}</button></div><form id="rating-form"><fieldset class="score-options"><legend class="sr-only">LCS</legend>${[[1,'Normal'],[2,'Mildly abnormal'],[3,'Moderately lame'],[4,'Lame'],[5,'Severely lame']].map(([n,label])=>`<label class="score-option"><input type="radio" name="score" value="${n}"><span class="score-number">${n}</span><span>${label}</span>${icon('check')}</label>`).join('')}<label class="unscorable"><input type="radio" name="score" value="unable">Unable to score</label></fieldset>
    <div id="reason-wrap" hidden><label for="reason">Reason</label><select id="reason"><option value="">Select reason</option>${['Too short','View unsuitable','Animal obscured','Video quality','Other'].map(x=>`<option>${x}</option>`).join('')}</select></div>
    <div class="optional-fields"><label for="confidence">Confidence <span>optional</span></label><select id="confidence"><option>Not specified</option><option>Low</option><option>Moderate</option><option>High</option></select><label for="notes">Notes <span>optional</span></label><textarea id="notes" rows="2" maxlength="1500"></textarea></div>
    <div class="save-row"><span id="save-status" class="save-status" role="status" aria-live="polite"></span><button id="save-next" type="submit" class="primary" disabled>Save &amp; next ${icon('arrow-right')}</button></div></form></section></div>
    <footer class="workspace-footer"><button id="previous" class="text-button">${icon('arrow-left')} Previous</button><div id="completion" class="completion" hidden>${icon('circle-check')}All recordings assessed</div><button id="next" class="text-button">Next ${icon('arrow-right')}</button></footer>`:`<section class="empty-state">${icon('film')}<h2>Recordings are being prepared</h2><p>The researcher has not opened this study yet.</p></section>`}</main>
    <dialog id="recordings-dialog"><div class="dialog-heading"><h2>Recordings</h2><button class="icon-button close-dialog" title="Close" aria-label="Close">${icon('x')}</button></div><div class="filter-row"><label for="clip-filter">Status</label><select id="clip-filter"><option value="all">All</option><option value="pending">Not assessed</option><option value="rated">Assessed</option><option value="unable">Unable to score</option></select></div><div id="recordings-grid" class="recordings-grid"></div><button id="download" class="text-button">${icon('download')} Download my ratings</button></dialog>
    <dialog id="guide-dialog"><div class="dialog-heading"><h2>Scoring Reference</h2><button class="icon-button close-dialog" title="Close" aria-label="Close">${icon('x')}</button></div><dl class="guide"><dt>1 | Normal</dt><dd>Level back and an even, unrestricted gait.</dd><dt>2 | Mildly abnormal</dt><dd>Some arching of the back while walking; gait may be slightly uneven.</dd><dt>3 | Moderately lame</dt><dd>Arched back and shorter steps, with a clear change in gait.</dd><dt>4 | Lame</dt><dd>Obvious favouring of one or more limbs and reduced weight bearing.</dd><dt>5 | Severely lame</dt><dd>Marked difficulty moving or bearing weight on an affected limb.</dd></dl><p>Standing posture may not be visible in these clips. Select "Unable to score" when the recording does not support a reliable assessment.</p><a href="https://www.vet.cornell.edu/animal-health-diagnostic-center/programs/nyschap/modules-documents/locomotion-scoring-management-tool" target="_blank" rel="noopener noreferrer">Five-point locomotion scoring reference ${icon('external-link')}</a></dialog>`;
  activateIcons();
  document.querySelector('#sign-out').onclick=async()=>{
    if (!leaveOkay()) return;
    try {await api('/session',{method:'DELETE'});} catch {}
    S.auth=null; login();
  };
  document.querySelector('#clip-list').onclick=()=>{drawList(); document.querySelector('#recordings-dialog').showModal();};
  document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelector('#clip-filter').onchange=drawList;
  document.querySelector('#download').onclick=download;
  if (!total) return;
  document.querySelector('#guide-open').onclick=()=>document.querySelector('#guide-dialog').showModal();
  document.querySelector('#previous').onclick=()=>navigate(S.index-1);
  document.querySelector('#next').onclick=()=>navigate(S.index+1);
  const video=document.querySelector('#video');
  document.querySelector('#replay').onclick=()=>{video.currentTime=0; video.play().catch(()=>{});};
  document.querySelector('#speed').onchange=e=>{video.playbackRate=Number(e.target.value);};
  video.onloadeddata=()=>{document.querySelector('#video-message').hidden=true;};
  video.onerror=()=>{document.querySelector('#video-message').hidden=false; document.querySelector('#video-message').textContent='Recording unavailable'; document.querySelector('#video-error').textContent='The video could not be loaded. Please try again later or contact the researcher.';};
  video.ontimeupdate=()=>{
    const delta=video.currentTime-S.lastTime;
    if (!video.paused && delta>0 && delta<1.5) S.watched+=delta;
    S.lastTime=video.currentTime;
    if (S.watched>=video.duration*0.8) markViewed();
  };
  video.onended=markViewed;
  document.querySelector('#rating-form').oninput=()=>{S.dirty=true; saveDraft(); updateForm();};
  document.querySelector('#rating-form').onsubmit=saveRating;
  loadClip();
}
function leaveOkay() {return !S.dirty || confirm('This recording has an unsaved rating. Leave it for now?');}
function navigate(index) {
  if (index<0 || index>=S.study.clips.length || !leaveOkay() || S.saving) return;
  S.index=index; loadClip();
}
function markViewed() {
  S.viewed=true; document.querySelector('#viewed').textContent='Viewed'; updateForm();
}
function formValue() {
  const selected=document.querySelector('input[name="score"]:checked')?.value;
  return {score:selected && selected!=='unable'?Number(selected):null,unscorable:selected==='unable',reason:document.querySelector('#reason').value,confidence:document.querySelector('#confidence').value,notes:document.querySelector('#notes').value,watched_seconds:S.watched,playback_rate:Number(document.querySelector('#speed').value)};
}
function saveDraft() {
  const clip=S.study.clips[S.index];
  localStorage.setItem(draftKey(clip.id),JSON.stringify(formValue()));
}
function updateForm() {
  const value=formValue();
  document.querySelector('#reason-wrap').hidden=!value.unscorable;
  document.querySelector('#save-next').disabled=S.saving || !(value.unscorable?value.reason:(value.score && S.viewed));
  if (S.dirty && !S.saving) setStatus('Not saved','pending');
}
async function loadClip() {
  const load=++S.loadNumber, clip=S.study.clips[S.index], form=document.querySelector('#rating-form'), video=document.querySelector('#video');
  S.dirty=false; S.viewed=false; S.watched=0; S.lastTime=0; form.reset();
  document.querySelector('#speed').value='1'; video.playbackRate=1; video.defaultPlaybackRate=1;
  video.pause(); video.removeAttribute('src'); video.removeAttribute('poster'); video.load();
  document.querySelector('#viewed').textContent='';
  document.querySelector('#video-error').textContent='';
  document.querySelector('#video-message').hidden=false; document.querySelector('#video-message').textContent='Loading recording...';
  document.querySelector('#duration').textContent=`${clip.duration.toFixed(1)} s`;
  document.querySelector('#clip-position').textContent=`Recording ${S.index+1} of ${S.study.clips.length}`;
  document.querySelector('#progress-label').textContent=`${S.ratings.size} of ${S.study.clips.length} assessed`;
  document.querySelector('#progress').value=S.ratings.size;
  document.querySelector('#previous').disabled=S.index===0;
  document.querySelector('#next').disabled=S.index===S.study.clips.length-1;
  document.querySelector('#completion').hidden=S.ratings.size!==S.study.clips.length;
  document.querySelector('#save-next').innerHTML=(S.index===S.study.clips.length-1?'Save rating':'Save &amp; next')+icon('arrow-right'); activateIcons();
  const saved=S.ratings.get(clip.id), draft=localStorage.getItem(draftKey(clip.id));
  let value=saved;
  if (draft) {try {value=JSON.parse(draft); S.dirty=true;} catch {}}
  if (value) {
    const choice=value.unscorable?'unable':String(value.score);
    const radio=document.querySelector(`input[name="score"][value="${choice}"]`); if (radio) radio.checked=true;
    document.querySelector('#reason').value=value.reason || '';
    document.querySelector('#confidence').value=value.confidence || 'Not specified';
    document.querySelector('#notes').value=value.notes || '';
    S.watched=value.watched_seconds || 0;
    S.viewed=!!saved;
  }
  updateForm();
  setStatus(S.dirty?'Unsaved draft':saved?'Saved':'',S.dirty?'pending':'saved');
  try {
    const media=await api(`/ticket/${clip.id}`,{method:'POST',body:'{}'});
    if (load!==S.loadNumber) return;
    video.poster=API+media.poster; video.src=API+media.video; video.load();
  } catch(error) {
    if (load!==S.loadNumber) return;
    document.querySelector('#video-message').textContent='Recording unavailable';
    document.querySelector('#video-error').textContent=error.message;
    if (error.status===401) login('Your session expired. Sign in with the same access code to continue.');
  }
}
async function saveRating(event) {
  event.preventDefault(); if (S.saving) return;
  const clip=S.study.clips[S.index], value=formValue();
  if (!value.unscorable && (!value.score || !S.viewed)) return;
  S.saving=true; updateForm(); setStatus('Saving...'); saveDraft();
  try {
    const result=await api(`/ratings/${clip.id}`,{method:'PUT',body:JSON.stringify({...value,expected_revision:S.ratings.get(clip.id)?.revision || 0})});
    S.ratings.set(clip.id,result); S.dirty=false; localStorage.removeItem(draftKey(clip.id));
    S.saving=false; setStatus('Saved','saved');
    if (S.index<S.study.clips.length-1) {S.index++; await loadClip();}
    else {document.querySelector('#progress').value=S.ratings.size; document.querySelector('#progress-label').textContent=`${S.ratings.size} of ${S.study.clips.length} assessed`;document.querySelector('#completion').hidden=S.ratings.size!==S.study.clips.length; updateForm();}
  } catch(error) {
    S.saving=false; S.dirty=true; updateForm();
    setStatus(`${error.message} Draft retained on this device.`,'error');
  }
}
function drawList() {
  const filter=document.querySelector('#clip-filter').value;
  const grid=document.querySelector('#recordings-grid'); grid.replaceChildren();
  S.study.clips.forEach((clip,index)=>{
    const rated=S.ratings.get(clip.id);
    if ((filter==='pending' && rated) || (filter==='rated' && !rated) || (filter==='unable' && !rated?.unscorable)) return;
    const button=document.createElement('button');
    button.className=`clip-button ${rated?'is-rated':''} ${index===S.index?'is-current':''}`;
    button.textContent=String(index+1).padStart(2,'0');
    button.title=`Recording ${index+1}: ${rated? (rated.unscorable?'Unable to score':'Assessed'):'Not assessed'}`;
    button.onclick=()=>{if (leaveOkay()){document.querySelector('#recordings-dialog').close();S.dirty=false;S.index=index;loadClip();}};
    grid.append(button);
  });
}
function download() {
  const payload={study_id:S.study.id,participant:S.auth.label,exported_at:new Date().toISOString(),ratings:[...S.ratings.values()]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='my-locomotion-ratings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.addEventListener('beforeunload',event=>{if(S.dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('offline',()=>setStatus('Offline. Unsaved ratings remain on this device.','error'));
window.addEventListener('online',()=>{if(S.dirty)setStatus('Connection restored. Please save your rating.','pending');});
if (S.auth) loadStudy().catch(error=>login(error.message)); else login();
