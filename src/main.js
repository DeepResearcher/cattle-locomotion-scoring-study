import { createIcons, Activity, LockKeyhole, LayoutGrid, LogOut, ArrowRight, ArrowLeft, RotateCcw, CircleHelp, Check, CircleCheck, Film, X, Download, ExternalLink } from 'lucide';
import {translate, translateOption, translateError} from './i18n.js';
import './style.css';

const API=import.meta.env.VITE_API_URL || '';
const app=document.querySelector('#app');
const S={auth:JSON.parse(sessionStorage.getItem('lcs-session') || 'null'),language:localStorage.getItem('lcs-language')==='en'?'en':'de',study:null,index:0,ratings:new Map(),dirty:false,saving:false,watched:0,viewed:false,lastTime:0,loadNumber:0,status:null,loginError:'',loginErrorKey:'',videoState:'loading',mediaError:''};
const esc=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=(key,values)=>translate(S.language,key,values);
const tx=key=>`<span data-i18n="${key}">${esc(t(key))}</span>`;
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const iconLabel=key=>`data-i18n-title="${key}" title="${esc(t(key))}" aria-label="${esc(t(key))}"`;
const options=values=>values.map(value=>`<option value="${esc(value)}" data-i18n-option>${esc(translateOption(S.language,value))}</option>`).join('');
const activateIcons=()=>createIcons({icons:{Activity,LockKeyhole,LayoutGrid,LogOut,ArrowRight,ArrowLeft,RotateCcw,CircleHelp,Check,CircleCheck,Film,X,Download,ExternalLink},attrs:{'stroke-width':1.7}});

async function api(path,options={}){
  const response=await fetch(`${API}/api${path}`,{...options,headers:{'Content-Type':'application/json',...(S.auth?{Authorization:`Bearer ${S.auth.token}`} : {}),...options.headers}});
  let data;
  try{data=await response.json();}catch{throw new Error('The server did not return a valid response.');}
  if(!response.ok){const error=new Error(data.error || 'Request failed.');error.status=response.status;throw error;}
  return data;
}
function draftKey(id){return `lcs-draft:${S.study?.id}:${S.auth?.rater_id}:${id}`;}
function setStatus(key,state='',values={}){S.status={key,state,values};drawStatus();}
function drawStatus(){
  const el=document.querySelector('#save-status');if(!el || !S.status)return;
  const {key,state,values}=S.status;
  el.textContent=key?t(key,{...values,...(values.error?{error:translateError(S.language,values.error)}:{})}):'';
  el.className=`save-status ${state}`;
}
function dynamicLabels(){
  if(!S.study || !document.querySelector('#clip-position'))return;
  const total=S.study.clips.length;
  document.querySelector('#clip-position').textContent=t('recordingPosition',{number:S.index+1,total});
  document.querySelector('#progress-label').textContent=t('progress',{done:S.ratings.size,total});
  const label=document.querySelector('#save-next-label');if(label)label.textContent=t(S.index===total-1?'saveRating':'saveNext');
  const viewed=document.querySelector('#viewed');if(viewed)viewed.textContent=S.viewed?t('viewed'):'';
  const message=document.querySelector('#video-message');if(message)message.textContent=t(S.videoState==='unavailable'?'unavailable':'loading');
  if(S.mediaError)document.querySelector('#video-error').textContent=translateError(S.language,S.mediaError);
  drawStatus();
}
function applyLanguage(){
  document.documentElement.lang=S.language;document.title=t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n);});
  document.querySelectorAll('[data-i18n-option]').forEach(el=>{el.textContent=translateOption(S.language,el.value);});
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{const label=t(el.dataset.i18nTitle);el.title=label;el.setAttribute('aria-label',label);});
  document.querySelectorAll('[data-i18n-aria]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.i18nAria)));
  const select=document.querySelector('#language');if(select)select.value=S.language;
  const error=document.querySelector('#login-error');if(error)error.textContent=S.loginErrorKey?t(S.loginErrorKey):translateError(S.language,S.loginError);
  dynamicLabels();if(document.querySelector('#recordings-dialog[open]'))drawList();
}
function bindLanguage(){
  document.querySelector('#language').onchange=event=>{
    S.language=event.target.value==='en'?'en':'de';localStorage.setItem('lcs-language',S.language);
    // Relabel in place to preserve drafts and video playback.
    applyLanguage();
  };
  applyLanguage();
}
function header(){
  return `<header class="header"><div class="brand">${icon('activity')}<div><strong>${tx('brand')}</strong><span>${tx('subtitle')}</span></div></div><div class="header-actions"><label class="language-control"><span class="sr-only" data-i18n="language">${t('language')}</span><select id="language" data-i18n-aria="language" aria-label="${t('language')}"><option value="de"${S.language==='de'?' selected':''}>Deutsch</option><option value="en"${S.language==='en'?' selected':''}>English</option></select></label>${S.auth?`<span class="rater">${esc(S.auth.label)}${S.auth.is_test?` <small>${tx('preview')}</small>`:''}</span><button class="icon-button" id="clip-list" ${iconLabel('recordings')}>${icon('layout-grid')}</button><button class="icon-button" id="sign-out" ${iconLabel('signOut')}>${icon('log-out')}</button>`:`<span class="restricted">${icon('lock-keyhole')}${tx('restricted')}</span>`}</div></header>`;
}
function login(message='',key=''){
  S.auth=null;S.loginError=message;S.loginErrorKey=key;sessionStorage.removeItem('lcs-session');
  app.innerHTML=`${header()}<main class="login-layout"><section class="login-panel"><div class="login-heading">${icon('lock-keyhole')}<h1>${tx('studyAccess')}</h1></div>
    <form id="login-form"><label for="access-code">${tx('accessCode')}</label><input id="access-code" type="password" autocomplete="current-password" required spellcheck="false" autocapitalize="characters">
    <div class="profile-fields"><label for="role">${tx('background')}</label><select id="role" required><option value="" data-i18n="selectBackground">${t('selectBackground')}</option>${options(['Veterinarian','Researcher','Farmer / hoof care professional','Student','Other'])}</select>
    <label for="experience">${tx('experience')}</label><select id="experience" required><option value="" data-i18n="selectExperience">${t('selectExperience')}</option>${options(['Less than 1 year','1 to 5 years','More than 5 years'])}</select></div>
    <label class="consent"><input id="consent" type="checkbox" required>${tx('consent')}</label>
    <p class="privacy-note" data-i18n="privacy">${t('privacy')}</p>
    <p class="error" id="login-error" role="alert"></p><button class="primary wide" type="submit" id="login-submit">${tx('enterStudy')} ${icon('arrow-right')}</button></form></section></main>`;
  activateIcons();bindLanguage();
  document.querySelector('#login-form').onsubmit=async event=>{
    event.preventDefault();const button=document.querySelector('#login-submit');button.disabled=true;
    try{
      const result=await api('/session',{method:'POST',body:JSON.stringify({code:document.querySelector('#access-code').value,role:document.querySelector('#role').value,experience:document.querySelector('#experience').value,consent:document.querySelector('#consent').checked})});
      S.auth=result;sessionStorage.setItem('lcs-session',JSON.stringify(result));await loadStudy();
    }catch(error){S.loginError=error.message;S.loginErrorKey='';document.querySelector('#login-error').textContent=translateError(S.language,error.message);button.disabled=false;}
  };
}
async function loadStudy(){
  S.study=await api('/study');S.ratings=new Map(S.study.ratings.map(r=>[r.clip_id,r]));
  S.index=Math.max(0,S.study.clips.findIndex(c=>!S.ratings.has(c.id)));S.dirty=false;render();
}
function render(){
  const total=S.study.clips.length;
  app.innerHTML=`${header()}<main class="workspace"><div class="study-bar"><div><h1>${tx('assessment')}</h1><span id="clip-position"></span></div><div class="progress-block"><span id="progress-label"></span><progress id="progress" max="${total}" value="${S.ratings.size}" data-i18n-aria="assessmentProgress" aria-label="${t('assessmentProgress')}"></progress></div></div>
  ${total?`<div class="work-grid"><section class="video-section" data-i18n-aria="recording" aria-label="${t('recording')}"><div class="video-shell"><video id="video" controls playsinline muted preload="auto" controlsList="nodownload" disablePictureInPicture></video><div class="video-message" id="video-message" role="status">${t('loading')}</div></div><div class="video-toolbar"><div class="toolbar-group"><button id="replay" class="icon-button" ${iconLabel('replay')}>${icon('rotate-ccw')}</button><label class="speed-label" for="speed">${tx('speed')}</label><select id="speed" data-i18n-aria="playbackSpeed" aria-label="${t('playbackSpeed')}"><option value="1">1x</option><option value="0.5">0.5x</option></select><span id="viewed" class="view-status"></span></div><span class="duration" id="duration"></span></div><div class="video-error error" id="video-error" role="alert"></div></section>
  <section class="rating-section" aria-labelledby="rating-title"><div class="section-title"><h2 id="rating-title">${tx('locomotionScore')}</h2><button id="guide-open" class="icon-button" ${iconLabel('scoringReference')}>${icon('circle-help')}</button></div><form id="rating-form"><fieldset class="score-options"><legend class="sr-only">LCS</legend>${[1,2,3,4,5].map(n=>`<label class="score-option"><input type="radio" name="score" value="${n}"><span class="score-number">${n}</span>${tx(`score${n}`)}${icon('check')}</label>`).join('')}<label class="unscorable"><input type="radio" name="score" value="unable">${tx('unable')}</label></fieldset>
    <div id="reason-wrap" hidden><label for="reason">${tx('reason')}</label><select id="reason"><option value="" data-i18n="selectReason">${t('selectReason')}</option>${options(['Too short','View unsuitable','Animal obscured','Video quality','Other'])}</select></div>
    <div class="optional-fields"><label for="confidence">${tx('confidence')} <span data-i18n="optional">${t('optional')}</span></label><select id="confidence">${options(['Not specified','Low','Moderate','High'])}</select><label for="notes">${tx('notes')} <span data-i18n="optional">${t('optional')}</span></label><textarea id="notes" rows="2" maxlength="1500"></textarea></div>
    <div class="save-row"><span id="save-status" class="save-status" role="status" aria-live="polite"></span><button id="save-next" type="submit" class="primary" disabled><span id="save-next-label">${t('saveNext')}</span>${icon('arrow-right')}</button></div></form></section></div>
    <footer class="workspace-footer"><button id="previous" class="text-button">${icon('arrow-left')} ${tx('previous')}</button><div id="completion" class="completion" hidden>${icon('circle-check')}${tx('allAssessed')}</div><button id="next" class="text-button">${tx('next')} ${icon('arrow-right')}</button></footer>`:`<section class="empty-state">${icon('film')}<h2>${tx('preparing')}</h2><p>${tx('notOpened')}</p></section>`}</main>
    <dialog id="recordings-dialog"><div class="dialog-heading"><h2>${tx('recordings')}</h2><button class="icon-button close-dialog" ${iconLabel('close')}>${icon('x')}</button></div><div class="filter-row"><label for="clip-filter">${tx('status')}</label><select id="clip-filter"><option value="all" data-i18n="all">${t('all')}</option><option value="pending" data-i18n="notAssessed">${t('notAssessed')}</option><option value="rated" data-i18n="assessed">${t('assessed')}</option><option value="unable" data-i18n="unable">${t('unable')}</option></select></div><div id="recordings-grid" class="recordings-grid"></div><button id="download" class="text-button">${icon('download')} ${tx('downloadRatings')}</button></dialog>
    <dialog id="guide-dialog"><div class="dialog-heading"><h2>${tx('scoringReference')}</h2><button class="icon-button close-dialog" ${iconLabel('close')}>${icon('x')}</button></div><dl class="guide">${[1,2,3,4,5].map(n=>`<dt>${n} | ${tx(`score${n}`)}</dt><dd>${tx(`guide${n}`)}</dd>`).join('')}</dl><p>${tx('guideNote')}</p><a href="https://www.vet.cornell.edu/animal-health-diagnostic-center/programs/nyschap/modules-documents/locomotion-scoring-management-tool" target="_blank" rel="noopener noreferrer">${tx('referenceLink')} ${icon('external-link')}</a></dialog>`;
  activateIcons();bindLanguage();
  document.querySelector('#sign-out').onclick=async()=>{if(!leaveOkay())return;try{await api('/session',{method:'DELETE'});}catch{}S.auth=null;login();};
  document.querySelector('#clip-list').onclick=()=>{drawList();document.querySelector('#recordings-dialog').showModal();};
  document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.querySelector('#clip-filter').onchange=drawList;document.querySelector('#download').onclick=download;
  if(!total)return;
  document.querySelector('#guide-open').onclick=()=>document.querySelector('#guide-dialog').showModal();
  document.querySelector('#previous').onclick=()=>navigate(S.index-1);document.querySelector('#next').onclick=()=>navigate(S.index+1);
  const video=document.querySelector('#video');
  document.querySelector('#replay').onclick=()=>{video.currentTime=0;video.play().catch(()=>{});};
  document.querySelector('#speed').onchange=e=>{video.playbackRate=Number(e.target.value);};
  video.onloadeddata=()=>{S.videoState='loaded';document.querySelector('#video-message').hidden=true;};
  video.onerror=()=>{
    S.videoState='unavailable';S.mediaError='';document.querySelector('#video-message').hidden=false;document.querySelector('#video-message').textContent=t('unavailable');
    const message=document.querySelector('#video-error');message.innerHTML=tx('videoLoadError')+' ';
    const retry=document.createElement('button');retry.type='button';retry.className='icon-button';retry.dataset.i18nTitle='reloadRecording';retry.title=t('reloadRecording');retry.setAttribute('aria-label',t('reloadRecording'));retry.innerHTML=icon('rotate-ccw');
    retry.onclick=()=>{if(S.dirty)saveDraft();loadClip();};message.append(retry);activateIcons();
  };
  video.ontimeupdate=()=>{
    const delta=video.currentTime-S.lastTime;if(!video.paused && !video.seeking && delta>0 && delta<1.5)S.watched+=delta;S.lastTime=video.currentTime;
    if(!S.viewed && S.watched>=video.duration*0.8)markViewed();
  };
  video.onended=markViewed;
  document.querySelector('#rating-form').oninput=()=>{S.dirty=true;saveDraft();updateForm();setStatus('notSaved','pending');};
  document.querySelector('#rating-form').onsubmit=saveRating;loadClip();
}
function leaveOkay(){return !S.dirty || confirm(t('unsavedLeave'));}
function navigate(index){if(index<0 || index>=S.study.clips.length || !leaveOkay() || S.saving)return;S.index=index;loadClip();}
function markViewed(){S.viewed=true;document.querySelector('#viewed').textContent=t('viewed');}
function formValue(){
  const selected=document.querySelector('input[name="score"]:checked')?.value;
  return {score:selected && selected!=='unable'?Number(selected):null,unscorable:selected==='unable',reason:document.querySelector('#reason').value,confidence:document.querySelector('#confidence').value,notes:document.querySelector('#notes').value,watched_seconds:S.watched,playback_rate:Number(document.querySelector('#speed').value)};
}
function saveDraft(){const clip=S.study.clips[S.index];localStorage.setItem(draftKey(clip.id),JSON.stringify(formValue()));}
function updateForm(){const value=formValue();document.querySelector('#reason-wrap').hidden=!value.unscorable;document.querySelector('#save-next').disabled=S.saving || !(value.unscorable?value.reason:value.score);}
async function loadClip(){
  const load=++S.loadNumber,clip=S.study.clips[S.index],form=document.querySelector('#rating-form'),video=document.querySelector('#video');
  S.dirty=false;S.viewed=false;S.watched=0;S.lastTime=0;S.videoState='loading';S.mediaError='';form.reset();
  document.querySelector('#speed').value='1';video.playbackRate=1;video.defaultPlaybackRate=1;video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.load();
  document.querySelector('#viewed').textContent='';document.querySelector('#video-error').textContent='';document.querySelector('#video-message').hidden=false;document.querySelector('#video-message').textContent=t('loading');
  document.querySelector('#duration').textContent=`${clip.duration.toFixed(1)} s`;document.querySelector('#progress').value=S.ratings.size;
  document.querySelector('#previous').disabled=S.index===0;document.querySelector('#next').disabled=S.index===S.study.clips.length-1;document.querySelector('#completion').hidden=S.ratings.size!==S.study.clips.length;
  const saved=S.ratings.get(clip.id),draft=localStorage.getItem(draftKey(clip.id));let value=saved;
  if(draft){try{value=JSON.parse(draft);S.dirty=true;}catch{}}
  if(value){
    const choice=value.unscorable?'unable':String(value.score),radio=document.querySelector(`input[name="score"][value="${choice}"]`);if(radio)radio.checked=true;
    document.querySelector('#reason').value=value.reason || '';document.querySelector('#confidence').value=value.confidence || 'Not specified';document.querySelector('#notes').value=value.notes || '';S.watched=value.watched_seconds || 0;S.viewed=!!saved;
  }
  updateForm();setStatus(S.dirty?'unsavedDraft':saved?'saved':'',S.dirty?'pending':'saved');dynamicLabels();
  try{const media=await api(`/ticket/${clip.id}`,{method:'POST',body:'{}'});if(load!==S.loadNumber)return;video.poster=API+media.poster;video.src=API+media.video;video.load();}
  catch(error){if(load!==S.loadNumber)return;S.videoState='unavailable';S.mediaError=error.message;document.querySelector('#video-message').textContent=t('unavailable');document.querySelector('#video-error').textContent=translateError(S.language,error.message);if(error.status===401)login('','sessionExpired');}
}
async function saveRating(event){
  event.preventDefault();if(S.saving)return;
  const clip=S.study.clips[S.index],value=formValue();if(value.unscorable?!value.reason:!value.score)return;
  S.saving=true;updateForm();setStatus('saving');saveDraft();
  try{
    const result=await api(`/ratings/${clip.id}`,{method:'PUT',body:JSON.stringify({...value,expected_revision:S.ratings.get(clip.id)?.revision || 0})});
    S.ratings.set(clip.id,result);S.dirty=false;localStorage.removeItem(draftKey(clip.id));S.saving=false;setStatus('saved','saved');
    if(S.index<S.study.clips.length-1){S.index++;await loadClip();}
    else{document.querySelector('#progress').value=S.ratings.size;document.querySelector('#completion').hidden=S.ratings.size!==S.study.clips.length;updateForm();dynamicLabels();}
  }catch(error){S.saving=false;S.dirty=true;updateForm();setStatus('saveFailed','error',{error:error.message});}
}
function drawList(){
  const filter=document.querySelector('#clip-filter').value,grid=document.querySelector('#recordings-grid');grid.replaceChildren();
  S.study.clips.forEach((clip,index)=>{
    const rated=S.ratings.get(clip.id);if((filter==='pending' && rated)||(filter==='rated' && !rated)||(filter==='unable' && !rated?.unscorable))return;
    const button=document.createElement('button');button.className=`clip-button ${rated?'is-rated':''} ${index===S.index?'is-current':''}`;button.textContent=String(index+1).padStart(2,'0');button.title=t('clipStatus',{number:index+1,status:t(rated?(rated.unscorable?'unable':'assessed'):'notAssessed')});
    button.onclick=()=>{if(leaveOkay()){document.querySelector('#recordings-dialog').close();S.dirty=false;S.index=index;loadClip();}};grid.append(button);
  });
}
function download(){
  const payload={study_id:S.study.id,participant:S.auth.label,exported_at:new Date().toISOString(),ratings:[...S.ratings.values()]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='my-locomotion-ratings.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.addEventListener('beforeunload',event=>{if(S.dirty){event.preventDefault();event.returnValue='';}});
window.addEventListener('offline',()=>setStatus('offline','error'));
window.addEventListener('online',()=>{if(S.dirty)setStatus('online','pending');});
if(S.auth)loadStudy().catch(error=>login(error.message));else login();
