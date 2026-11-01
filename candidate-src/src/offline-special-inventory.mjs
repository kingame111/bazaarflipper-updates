import { MINION_DATA } from './minion-data.mjs';
const used=p=>[...p.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function put(pool,cap,id,qty){
 const old=pool.get(id)||0,free=Math.max(0,cap-used(pool))*64+(old%64?64-old%64:0);
 const accepted=Math.min(free,qty);if(accepted>0)pool.set(id,old+accepted);
 return accepted;
}
function compact(pool,steps){
 for(const {from,to,ratio} of steps){
  const n=pool.get(from)||0,made=Math.floor(n/ratio);if(!made)continue;
  const left=n-made*ratio;if(left)pool.set(from,left);else pool.delete(from);
  pool.set(to,(pool.get(to)||0)+made);
 }
}
function rng(seed){let s=seed>>>0;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
function recipe(drop,steps,meta){
 let id=drop.item,npc=Number(drop.npc||0),next=Object.entries(drop.enchanted||{})[0],seen=new Set([id]);
 meta.set(id,{npc,rawItem:drop.item});
 while(next&&seen.size<9){
  const [to,v]=next,ratio=Number(v);
  if(!Number.isInteger(ratio)||ratio<1||seen.has(to))break;
  steps.push({from:id,to,ratio});npc*=ratio;
  meta.set(to,{npc,rawItem:drop.item});id=to;seen.add(to);
  const continuation=MINION_DATA.compactionNext?.[to];
  next=continuation?[continuation.item,continuation.ratio]:null;
 }
}
export function simulateSpecialOffline(minion,tier,opts){
 const base=minion?.tiers?.[tier],fuel=opts.fuel,ups=opts.upgrades||[];
 const known=new Set(['SUPER_COMPACTOR_3000','DIAMOND_SPREADING','MINION_EXPANDER',
 'FLYCATCHER_UPGRADE','CORRUPT_SOIL','SOULFLOW_ENGINE','LESSER_SOULFLOW_ENGINE',
 'BERBERIS_FUEL_INJECTOR','ENCHANTED_EGG','FLINT_SHOVEL']);
 if(!base||!fuel||fuel.duration>0||Number(fuel.drops||1)!==1||ups.some(u=>!known.has(u.id)))return null;
 const hasSpecial=ups.some(u=>u.extraDrops?.length||u.cooldownDrop||u.dropTransforms?.length||u.outputMultiplier);
 if(!hasSpecial)return null;
 const drops=fuel.forceDrops||minion.drops;
 if(!drops?.length)return null;
 const days=Number(opts.days),interval=Number(opts.secondsPerAction)*(minion.harvestOnly?1:2);
 if(!(days>0)||!(interval>0))return null;
 const events=Math.floor(days*86400/interval+1e-8);
 if(events>100000)return null;
 const internalSlots=base.storage/64,externalSlots=opts.largeStorage===false?0:15;
 if(!Number.isInteger(internalSlots)||internalSlots<1)return null;
 const transformed=d=>{
  const t=ups.flatMap(u=>u.dropTransforms||[]).find(x=>x.from===d.item);
  return t?{...d,item:t.to,npc:t.npc,enchanted:t.enchanted}:d;
 };
 const meta=new Map(),steps=[];
 for(const d of drops)recipe(transformed(d),steps,meta);
