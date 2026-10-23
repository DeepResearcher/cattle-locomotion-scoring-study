import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectResults,resultsSummary,ratingsCsv,ratingFields} from '../src/admin-data.js';
import {adminMessages} from '../src/admin-i18n.js';

const fixture={study_id:'test',exported_at:'2026-10-22T12:00:00Z',selected_version:2,active_version:2,
  media_releases:[{version:2,revision:'privacy-test',applied_at:'2026-10-23T12:00:00Z'}],
  clips:[{id:'one'},{id:'two'}],
  raters:[{id:'real',label:'Real',is_test:0,consent_at:'2026-10-22',active:1},{id:'preview',label:'Preview',is_test:1,consent_at:'2026-10-22',active:0},{id:'unused',is_test:0}],
  ratings:[{rater_id:'real',clip_id:'one',score:2,unscorable:0,updated_at:'2026-10-22T12:00:00Z'},
    {rater_id:'real',clip_id:'two',score:null,unscorable:1,updated_at:'2026-10-22T12:01:00Z'},
    {rater_id:'preview',clip_id:'one',score:5,unscorable:0,updated_at:'2026-10-22T12:02:00Z'}],
  history:[{rater_id:'real',id:1},{rater_id:'preview',id:2}],
  orders:[{rater_id:'real',version:2,clip_ids:'["one","two"]'},{rater_id:'preview',version:2,clip_ids:'["two","one"]'}]
};

test('Research exports exclude test ratings, participants AND history; filters retain denominators',()=>{
  const before=JSON.stringify(fixture),selected=selectResults(fixture),s=resultsSummary(selected);
  assert.equal(selected.ratings.length,2);assert.equal(selected.history.length,1);
  assert.equal(selected.selected_version,2);assert.equal(selected.active_version,2);
  assert.deepEqual(selected.orders,[fixture.orders[0]]);
  assert.deepEqual(selected.media_releases,fixture.media_releases);
  assert.equal(selected.raters.some(r=>r.id==='preview'),false);
  assert.equal(selected.includes_test_data,false);
  assert.equal(s.participants.length,1);assert.equal(s.completed,1);assert.equal(s.unscorable,1);
  assert.equal(s.totalClips,2);assert.equal(s.participants[0].latest,'2026-10-22T12:01:00Z');
  const preview=selectResults(fixture,{includeTests:true,raterId:'preview'});
  assert.equal(preview.ratings.length,1);assert.equal(preview.history[0].id,2);
  assert.equal(preview.ratings[0].is_test,1);assert.equal(preview.clips.length,2);
  assert.deepEqual(preview.orders,[fixture.orders[1]]);
  assert.equal(selectResults(fixture,{raterId:'preview'}).ratings.length,0);
  assert.equal(JSON.stringify(fixture),before);
});

test('CSV is Excel-compatible, quotes multiline notes, neutralises formulas and preserves canonical values',()=>{
  const csv=ratingsCsv([{label:'=HYPERLINK("bad")',notes:'line 1, "quoted"\nline 2',score:3,unscorable:0,confidence:'Moderate'},
    {label:' +SUM(1)',notes:'@formula',score:null,unscorable:1}]);
  assert.ok(csv.startsWith('\ufeff"rater_id"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\' +SUM(1)"'));
  assert.ok(csv.includes('"line 1, ""quoted""\nline 2"'));
  assert.ok(csv.includes('"Moderate"'));assert.ok(csv.includes('"\'@formula"'));
  assert.equal(ratingsCsv([]).split('\r\n').length,1);
  assert.equal(ratingFields.includes('is_test'),true);
});

test('Admin translations have identical keys',()=>{
  assert.deepEqual(Object.keys(adminMessages.de).sort(),Object.keys(adminMessages.en).sort());
});
