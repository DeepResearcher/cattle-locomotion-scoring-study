export const ratingFields=[
  'rater_id','label','clip_id','score','unscorable','reason','confidence','notes',
  'watched_seconds','playback_rate','revision','updated_at','study_version',
  'role','experience','consent_at','is_test'
];

export function selectResults(data,{includeTests=false,raterId=''}={}) {
  const raters=data.raters.filter(r=>(includeTests || !Number(r.is_test)) && (!raterId || r.id===raterId));
  const byId=new Map(raters.map(r=>[r.id,r]));
  return {
    study_id:data.study_id,exported_at:data.exported_at,
    selected_version:data.selected_version,active_version:data.active_version,
    includes_test_data:includeTests,participant_filter:raterId || null,
    clips:data.clips || [],raters,
    ratings:data.ratings.filter(r=>byId.has(r.rater_id)).map(r=>({...r,is_test:Number(byId.get(r.rater_id).is_test)})),
    history:data.history.filter(r=>byId.has(r.rater_id)),
    orders:(data.orders || []).filter(r=>byId.has(r.rater_id))
  };
}

export function resultsSummary(data) {
  const byRater=new Map();
  for (const r of data.ratings) {
    if (!byRater.has(r.rater_id)) byRater.set(r.rater_id,[]);
    byRater.get(r.rater_id).push(r);
  }
  const participants=data.raters.filter(r=>r.consent_at || byRater.has(r.id)).map(r=>{
    const rows=byRater.get(r.id) || [];
    return {...r,assessed:rows.length,unscorable:rows.filter(x=>Number(x.unscorable)).length,
      latest:rows.map(x=>x.updated_at).sort().at(-1) || '',
      complete:data.clips.length>0 && rows.length===data.clips.length};
  });
  return {participants,ratings:data.ratings.length,unscorable:data.ratings.filter(r=>Number(r.unscorable)).length,
    completed:participants.filter(r=>r.complete).length,totalClips:data.clips.length};
}

export function ratingsCsv(rows) {
  const quote=value=>{
    const text=String(value ?? '');
    const safe=typeof value==='string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)?`'${text}`:text;
    return `"${safe.replace(/"/g,'""')}"`;
  };
  return '\ufeff'+[ratingFields,...rows.map(row=>ratingFields.map(key=>row[key]))]
    .map(row=>row.map(quote).join(',')).join('\r\n');
}
