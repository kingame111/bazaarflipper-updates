import { MINION_DATA } from './minion-data.mjs';
// Chronological offline inventory for production-affecting upgrades.
const used = p => [...p.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function place(p,cap,id,qty){
  const previous=p.get(id)||0;
  const partial=previous%64?64-previous%64:0;
  const accepted=Math.min(qty,Math.max(0,cap-used(p))*64+partial);
  if(accepted>0)p.set(id,previous+accepted);
  return accepted;
}
function compact(p,recipes){
  for(const {from,to,ratio} of recipes){
    const q=p.get(from)||0,made=Math.floor(q/ratio);
    if(!made)continue;
    const left=q-made*ratio;
    if(left)p.set(from,left);else p.delete(from);
    p.set(to,(p.get(to)||0)+made);
  }
}
function makeRandom(seed){
  let s=seed>>>0;
  return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};
}
function stagesFor(drop,steps,metadata,owner){
  let from=drop.item,npc=Number(drop.npc||0),next=Object.entries(drop.enchanted||{})[0];
  const seen=new Set([from]);
  metadata.set(from,{npc,rawItem:drop.item,source:owner});
  while(next&&seen.size<9){
    const [to,n]=next,ratio=Number(n);
    if(!Number.isInteger(ratio)||ratio<1||seen.has(to))break;
    steps.push({from,to,ratio});
    npc*=ratio;metadata.set(to,{npc,rawItem:drop.item,source:owner});
    from=to;seen.add(to);
    const more=MINION_DATA.compactionNext?.[to];
    next=more?[more.item,more.ratio]:null;
  }
}
