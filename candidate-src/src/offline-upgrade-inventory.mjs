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
export function simulateUpgradeOffline(minion,tier,opts){
  const base=minion?.tiers?.[tier],fuel=opts.fuel,ups=opts.upgrades||[];
  const drops=fuel?.forceDrops||minion?.drops;
  const special=ups.some(u=>u.extraDrops?.length||u.cooldownDrop||u.dropTransforms?.length||u.outputMultiplier);
  if(!base||!special||!fuel||fuel.duration>0||Number(fuel.drops||1)!==1||!drops?.length)return null;
  const days=Number(opts.days),interval=Number(opts.secondsPerAction)*(minion.harvestOnly?1:2);
  if(!(days>0)||!(interval>0))return null;
  const events=Math.floor(days*86400/interval+1e-8);
  if(events>100000)return null;
  const innerSlots=Number(base.storage)/64,extSlots=opts.largeStorage===false?0:15;
  if(!Number.isInteger(innerSlots)||innerSlots<1)return null;
  const transform=d=>{
    const t=ups.flatMap(u=>u.dropTransforms||[]).find(x=>x.from===d.item);
    return t?{...d,item:t.to,npc:t.npc,enchanted:t.enchanted}:d;
  };
  const meta=new Map(),steps=[];
  for(const d of drops)stagesFor(transform(d),steps,meta,'MINION');
  for(const up of ups){
    for(const d of up.extraDrops||[])stagesFor(transform(d),steps,meta,up.id);
    if(up.cooldownDrop)stagesFor(transform(up.cooldownDrop),steps,meta,up.id);
  }
  const stochastic=drops.some(d=>d.chance!==1||!Number.isInteger(d.amount))
    ||ups.some(u=>u.id==='DIAMOND_SPREADING'||u.extraDrops?.some(d=>d.chance!==1))
    ||ups.some(u=>u.outputMultiplier&&!Number.isInteger(u.outputMultiplier));
  const samples=stochastic?12:1;
  const sum=drops.reduce((n,d)=>n+d.chance,0);
  const exclusive=drops.length>1&&drops.every(d=>d.chance<1)&&Math.abs(sum-1)<.0002;
  const outputFactor=ups.reduce((n,u)=>n*Number(u.outputMultiplier||1),1);
  const cooldown=ups.filter(u=>u.cooldownDrop);
  const hasCompactor=ups.some(u=>u.id==='SUPER_COMPACTOR_3000');
  const held=new Map(),shipped=new Map();
  let overflowQuantity=0,overflowStartSum=0,overflowStarts=0;
  for(let sample=0;sample<samples;sample++){
    const roll=makeRandom(0x31d9e2af+sample*97973+tier*113+minion.id.length*97);
    const inside=new Map(),chest=new Map(),overflow=new Map();
    const nextDue=cooldown.map(u=>u.cooldownDrop.seconds);
    let firstOverflow=null,currentDay=0;
    const drawAmount=x=>Math.floor(x)+(roll()<x%1?1:0);
    const create=(drop,quantity)=>{
      if(quantity<=0)return;
      const item=transform(drop).item;
      let extra=quantity-place(inside,innerSlots,item,quantity);
      if(extra>0&&extSlots)extra-=place(chest,extSlots,item,extra);
      if(extra>0){
        overflow.set(item,(overflow.get(item)||0)+extra);
        overflowQuantity+=extra/samples;
        if(firstOverflow===null)firstOverflow=currentDay;
      }
    };
    for(let cycle=0;cycle<events;cycle++){
      const time=(cycle+1)*interval;currentDay=time/86400;
      for(let k=0;k<cooldown.length;k++){
        const u=cooldown[k];
        while(nextDue[k]<=time+1e-8&&nextDue[k]<=days*86400){
          let amount=1;
          if(minion.id==='VOIDLING_GENERATOR'&&u.id==='SOULFLOW_ENGINE')amount+=tier*.03;
          create(u.cooldownDrop,drawAmount(amount));
          nextDue[k]+=u.cooldownDrop.seconds;
        }
      }
      let chosen;
      if(exclusive){
        const p=roll();let accumulated=0,selected=drops.at(-1);
        for(const d of drops){
          accumulated+=d.chance;
          if(p<accumulated){selected=d;break;}
        }
        chosen=[selected];
      }else chosen=drops.filter(d=>roll()<d.chance);
      let eligible=0;
      for(const d of chosen){
        const n=drawAmount(d.amount*outputFactor);
        eligible+=n;create(d,n);
      }
      for(const up of ups){
        if(up.id==='DIAMOND_SPREADING')continue;
        for(const d of up.extraDrops||[]){
          if(roll()<d.chance){
            const n=drawAmount(d.amount);
            create(d,n);eligible+=n;
          }
        }
      }
      for(const up of ups){
        if(up.id!=='DIAMOND_SPREADING')continue;
        for(let k=0;k<eligible;k++)
          for(const d of up.extraDrops||[])
            if(roll()<d.chance)create(d,drawAmount(d.amount));
      }
      if(hasCompactor){
        compact(inside,steps);
        if(extSlots)compact(chest,steps);
      }
    }
    for(const p of [inside,chest]){
      for(const [id,n] of p)held.set(id,(held.get(id)||0)+n/samples);
    }
    for(const [id,n] of overflow)shipped.set(id,(shipped.get(id)||0)+n/samples);
    if(firstOverflow!==null){overflowStartSum+=firstOverflow;overflowStarts++;}
  }
  const outputs=[];
  for(const [item,qty] of held){
    const m=meta.get(item)||{npc:0,rawItem:item,source:'MINION'};
    outputs.push({item,source:m.source,rawItem:m.rawItem,npc:m.npc,
      unitsPerDay:qty/days,rawUnitsPerDay:0,
      compacted:item!==m.rawItem,overflowUnitsPerDay:0});
  }
  for(const [item,qty] of shipped){
    const m=meta.get(item)||{npc:0,rawItem:item,source:'MINION'};
    outputs.push({item,source:m.source,rawItem:m.rawItem,npc:m.npc,
      unitsPerDay:0,rawUnitsPerDay:0,compacted:false,overflowUnitsPerDay:qty/days});
  }
  const expectedBase=events*drops.reduce((n,d)=>n+d.amount*d.chance,0)*outputFactor;
  const expectedExtras=ups.reduce((n,u)=>n+(u.id==='DIAMOND_SPREADING'
    ?0:(u.extraDrops||[]).reduce((a,d)=>a+d.amount*d.chance,0)*events),0);
  const expectedTimed=ups.reduce((n,u)=>n+(u.cooldownDrop
    ?days*86400/u.cooldownDrop.seconds*(minion.id==='VOIDLING_GENERATOR'
      &&u.id==='SOULFLOW_ENGINE'?1+.03*tier:1):0),0);
  const expectedDiamonds=ups.some(u=>u.id==='DIAMOND_SPREADING')
    ?(expectedBase+expectedExtras)*.1:0;
  const total=expectedBase+expectedExtras+expectedTimed+expectedDiamonds;
  return {model:stochastic?'UPGRADE_MONTE_CARLO_12':'UPGRADE_EVENT',
    outputs,events,samples,overflowQuantity,
    overflowShare:total?overflowQuantity/total:0,
    firstOverflowDay:overflowStarts?overflowStartSum/overflowStarts:null,
    innerSlots,extSlots,
    warning:stochastic?'Upgrade output is a 12-seed stochastic estimate.':
      'Upgrade inventory follows chronological events under documented offline assumptions.'};
}
