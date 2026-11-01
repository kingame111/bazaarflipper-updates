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
