// Reproducible presentation order, not a generator for security tokens.
export function separatedOrder(rows, seed, minimumGap=12) {
  let state=Number.parseInt(seed.slice(0,8),16) || 1;
  const random=()=>{
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return (state>>>0)/4294967296;
  };
  const base=[...rows].sort((a,b)=>a.id.localeCompare(b.id));
  for(let attempt=0;attempt<20000;attempt++) {
    const ordered=[...base];
    for(let i=ordered.length-1;i>0;i--) {
      const j=Math.floor(random()*(i+1));
      [ordered[i],ordered[j]]=[ordered[j],ordered[i]];
    }
    const positions=new Map();let valid=true;
    for(let i=0;i<ordered.length;i++) {
      const group=ordered[i].pair_group;
      if(!group)continue;
      if(positions.has(group) && i-positions.get(group)<minimumGap) {valid=false;break;}
      positions.set(group,i);
    }
    if(valid)return ordered;
  }
  throw new Error('Unable to construct separated presentation order');
}
