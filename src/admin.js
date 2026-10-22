import {createIcons,Activity,LockKeyhole,LogOut,RefreshCw,Download} from 'lucide';
import {adminMessages} from './admin-i18n.js';
import {translateOption} from './i18n.js';
import {selectResults,resultsSummary,ratingsCsv} from './admin-data.js';
import './style.css';
import './admin.css';

const API=import.meta.env.VITE_API_URL || '';
const app=document.querySelector('#admin-app');
const S={language:localStorage.getItem('lcs-language')==='en'?'en':'de',token:null,data:null,includeTests:false,raterId:'',busy:false,error:'',generation:0,timer:null};
const t=key=>adminMessages[S.language][key];
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name}" aria-hidden="true"></i>`;
const date=value=>value?new Date(value).toLocaleString(S.language==='de'?'de-DE':'en-GB'):'-';
const icons=()=>createIcons({icons:{Activity,LockKeyhole,LogOut,RefreshCw,Download},attrs:{'stroke-width':1.7}});
const selected=()=>selectResults(S.data,{includeTests:S.includeTests,raterId:S.raterId});

async function request(path,token,method='GET') {
  const response=await fetch(`${API}/api/admin/${path}`,{method,cache:'no-store',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  const data=await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}

function render() {
  document.documentElement.lang=S.language;document.title=`${t('title')} | ${t('administration')}`;
  app.innerHTML=`<header class="header"><div class="brand">${icon('activity')}<div><strong>${t('title')}</strong><span>${t('subtitle')}</span></div></div><div class="header-actions"><label class="language-control"><span class="sr-only">${t('language')}</span><select id="language" aria-label="${t('language')}"><option value="de">Deutsch</option><option value="en">English</option></select></label>${S.token?`<button id="logout" class="icon-button" title="${t('signout')}" aria-label="${t('signout')}">${icon('log-out')}</button>`:`<a class="admin-header-link" href="./">${t('back')}</a>`}</div></header>`;
  if (!S.token) {
    app.insertAdjacentHTML('beforeend',`<main class="login-layout admin-login"><section class="login-panel"><div class="login-heading">${icon('lock-keyhole')}<h1>${t('loginTitle')}</h1></div><form id="admin-login"><label for="admin-key">${t('password')}</label><input id="admin-key" type="password" autocomplete="current-password" required maxlength="200" spellcheck="false"><p id="login-error" class="error" role="alert">${S.error?t(S.error):''}</p><button type="submit" id="signin" class="primary wide">${S.busy?t('loading'):t('signin')}</button></form></section></main>`);
    document.querySelector('#admin-login').onsubmit=signin;
  } else {
    app.insertAdjacentHTML('beforeend',`<main class="admin-content"><div class="admin-heading"><div><h1>${t('administration')}</h1><p class="admin-meta" id="data-time"></p></div><div class="admin-actions"><button id="refresh" class="icon-button" title="${t('refresh')}" aria-label="${t('refresh')}">${icon('refresh-cw')}</button><button id="csv">${icon('download')}${t('csv')}</button><button id="json">${icon('download')}${t('json')}</button></div></div><p id="admin-status" class="admin-status error" role="status"></p><dl id="summary" class="admin-summary"></dl><div class="admin-filters"><div><label for="participant-filter">${t('participant')}</label><select id="participant-filter"></select></div><label class="admin-checkbox"><input id="include-tests" type="checkbox">${t('includeTests')}</label></div><p id="test-warning" class="admin-notice" hidden>${t('testWarning')}</p><p id="coverage" class="admin-muted"></p><section class="admin-section"><h2>${t('participants')}</h2><div id="participants"></div></section><section class="admin-section"><h2>${t('ratings')}</h2><div id="ratings"></div></section></main>`);
    document.querySelector('#logout').onclick=()=>logout();
    document.querySelector('#refresh').onclick=refresh;
    document.querySelector('#csv').onclick=()=>download('csv');
    document.querySelector('#json').onclick=()=>download('json');
    document.querySelector('#include-tests').checked=S.includeTests;
    document.querySelector('#include-tests').onchange=e=>{S.includeTests=e.target.checked;S.raterId='';drawData();};
    document.querySelector('#participant-filter').onchange=e=>{S.raterId=e.target.value;drawData();};
    drawData();
  }
  const language=document.querySelector('#language');language.value=S.language;
  language.onchange=e=>{
    const password=document.querySelector('#admin-key')?.value;
    S.language=e.target.value;localStorage.setItem('lcs-language',S.language);render();
    if (password!==undefined) document.querySelector('#admin-key').value=password;
  };
  icons();
}

function drawData() {
  if (!S.token) return;
  document.querySelector('#refresh').disabled=S.busy;
  document.querySelector('#csv').disabled=!S.data || S.busy;
  document.querySelector('#json').disabled=!S.data || S.busy;
  document.querySelector('#admin-status').textContent=S.error?t(S.error):S.busy?t('loading'):'';
  if (!S.data) return;
  const options=selectResults(S.data,{includeTests:S.includeTests}).raters.filter(r=>r.consent_at || S.data.ratings.some(x=>x.rater_id===r.id));
  document.querySelector('#participant-filter').innerHTML=`<option value="">${t('all')}</option>`+options.map(r=>`<option value="${esc(r.id)}">${esc(r.label)}${Number(r.is_test)?` (${t('test')})`:''}</option>`).join('');
  document.querySelector('#participant-filter').value=S.raterId;
  const data=selected(),s=resultsSummary(data);
  document.querySelector('#data-time').textContent=`${t('updated')}: ${date(data.exported_at)} | ${s.totalClips} ${t('clips')}`;
  document.querySelector('#summary').innerHTML=[['participants',s.participants.length],['ratings',s.ratings],['completed',s.completed],['unscorable',s.unscorable]].map(([key,value])=>`<div><dt>${t(key)}</dt><dd>${value}</dd></div>`).join('');
  document.querySelector('#test-warning').hidden=!S.includeTests;
  const perClip=new Map(data.clips.map(c=>[c.id,0]));
  for (const r of data.ratings) if (perClip.has(r.clip_id)) perClip.set(r.clip_id,perClip.get(r.clip_id)+1);
  const counts=[...perClip.values()];
  document.querySelector('#coverage').textContent=`${t('coverage')}: ${t('min')} ${counts.length?Math.min(...counts):0}, ${t('max')} ${counts.length?Math.max(...counts):0}`;
  const table=(headers,rows)=>`<div class="table-scroll" tabindex="0"><table class="admin-table"><thead><tr>${headers.map(k=>`<th scope="col">${t(k)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  document.querySelector('#participants').innerHTML=s.participants.length?table(['participant','role','progress','unscorable','last','status'],s.participants.map(r=>`<tr><td>${esc(r.label)}${Number(r.is_test)?` <b>(${t('test')})</b>`:''}<small>${esc(r.id)}</small></td><td>${esc(r.role?translateOption(S.language,r.role):t('empty'))}<small>${esc(r.experience?translateOption(S.language,r.experience):'')}</small></td><td class="nowrap">${r.assessed} / ${s.totalClips}<progress value="${r.assessed}" max="${s.totalClips || 1}"></progress></td><td>${r.unscorable}</td><td class="nowrap">${esc(date(r.latest))}</td><td>${t(r.active?'active':'inactive')}</td></tr>`)):`<p class="admin-muted">${t('noParticipants')}</p>`;
  const rows=[...data.ratings].sort((a,b)=>b.updated_at.localeCompare(a.updated_at) || a.rater_id.localeCompare(b.rater_id) || a.clip_id.localeCompare(b.clip_id));
  document.querySelector('#ratings').innerHTML=rows.length?table(['participant','recording','score','confidence','reason','notes','last'],rows.map(r=>`<tr><td>${esc(r.label)}${Number(r.is_test)?` (${t('test')})`:''}</td><td class="nowrap">${esc(r.clip_id)}</td><td>${Number(r.unscorable)?t('unscorable'):esc(r.score)}</td><td>${esc(translateOption(S.language,r.confidence))}</td><td>${esc(r.reason?translateOption(S.language,r.reason):'-')}</td><td class="note-cell">${esc(r.notes)}</td><td class="nowrap">${esc(date(r.updated_at))}</td></tr>`)):`<p class="admin-muted">${t('noData')}</p>`;
}

async function signin(event) {
  event.preventDefault();if (S.busy) return;
  const input=document.querySelector('#admin-key'),password=input.value;input.value='';
  S.busy=true;S.error='';const generation=++S.generation;render();
  try {
    const auth=await request('session',password,'POST');
    if (generation!==S.generation) return;
    S.token=auth.token;S.timer=setTimeout(()=>logout('expired'),Math.max(0,auth.expires*1000-Date.now()));
    S.busy=false;render();await refresh();
  } catch (error) {
    if (generation!==S.generation) return;
    S.error=error.status===429?'limited':'invalid';S.busy=false;render();
  }
}

async function refresh() {
  if (S.busy || !S.token) return;
  S.busy=true;S.error='';drawData();const generation=S.generation;
  try {
    const data=await request('export',S.token);
    if (generation!==S.generation) return;
    S.data=data;
  } catch (error) {
    if (generation!==S.generation) return;
    if (error.status===401) return logout('expired');
    S.error='failed';
  } finally {
    if (generation===S.generation) {S.busy=false;drawData();}
  }
}

function logout(message='') {
  ++S.generation;clearTimeout(S.timer);
  S.token=null;S.data=null;S.raterId='';S.includeTests=false;S.busy=false;S.error=message;render();
}

function download(format) {
  if (!S.data || !S.token || S.busy) return;
  const data=selected(),content=format==='csv'?ratingsCsv(data.ratings):JSON.stringify(data,null,2);
  const url=URL.createObjectURL(new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'}));
  const link=document.createElement('a');link.href=url;
  link.download=`lcs-ratings-${data.exported_at.replace(/[:.]/g,'-')}${S.includeTests?'-including-tests':''}${S.raterId?'-participant':''}.${format}`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

window.addEventListener('pagehide',()=>logout());
render();
