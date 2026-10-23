import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {separatedOrder} from '../worker/order.mjs';

test('70 presentations keep all 14 pairs separated, reproducible and participant-specific',()=>{
  const base=Array.from({length:56},(_,i)=>({id:`original-${i}`,pair_group:`group-${i}`}));
  const rows=[...base,...base.slice(0,14).map(c=>({...c,id:c.id.replace('original','repeat')}))];
  const untouched=JSON.stringify(rows),orders=new Set();
  for(let i=0;i<1000;i++) {
    const seed=createHash('sha256').update(`rater-${i}`).digest('hex');
    const ordered=separatedOrder(rows,seed);
    assert.equal(ordered.length,70);assert.equal(new Set(ordered.map(c=>c.id)).size,70);
    const positions=new Map(ordered.map((c,j)=>[c.id,j]));
    for(let j=0;j<14;j++)assert.ok(Math.abs(positions.get(`original-${j}`)-positions.get(`repeat-${j}`))>=12);
    assert.deepEqual(separatedOrder(rows,seed),ordered);
    orders.add(ordered.map(c=>c.id).join(','));
  }
  assert.equal(orders.size,1000);
  assert.equal(JSON.stringify(rows),untouched);
});
