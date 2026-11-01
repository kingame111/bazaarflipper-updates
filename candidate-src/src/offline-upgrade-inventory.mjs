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
