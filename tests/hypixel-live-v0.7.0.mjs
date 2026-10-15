import {fetchBazaar,fetchItemMetadata,fetchBazaarTaxContext} from '../candidate-src/src/hypixel.mjs';

const results={},started=Date.now();
for(const [name,fn] of [['bazaar',fetchBazaar],['items',fetchItemMetadata],['election',fetchBazaarTaxContext]]){
  const t=Date.now();
  try{
    const output=await fn(18000);
    const outcome={status:'PASS',elapsedMs:Date.now()-t};
    if(name==='bazaar'){
      outcome.productCount=Object.keys(output.products||{}).length;
      outcome.dataTimestamp=Number(output.lastUpdated)||null;
      const rows=Object.values(output.products||{});
      outcome.twoSided=rows.filter(x=>x?.buy_summary?.length&&x?.sell_summary?.length).length;
      outcome.badTopPrices=rows.filter(x=>{
        if(!x?.buy_summary?.length||!x?.sell_summary?.length)return false;
        const ask=Number(x.buy_summary[0].pricePerUnit);
        const bid=Number(x.sell_summary[0].pricePerUnit);
        return !Number.isFinite(ask)||!Number.isFinite(bid)||ask<=0||bid<=0;
      }).length;
      if(outcome.productCount<100||outcome.twoSided<100||outcome.badTopPrices>0)
        throw Error('Market contract problem: '+JSON.stringify(outcome));
      const age=Date.now()-outcome.dataTimestamp;
      if(outcome.dataTimestamp&&age>20*60*1000)throw Error('Bazaar timestamp >20 minutes old');
    }
    if(name==='items'){
      outcome.itemCount=output.map.size;
      if(outcome.itemCount<100)throw Error('Unusually small items list');
    }
    if(name==='election')outcome.mayor=output.mayorName;
    results[name]=outcome;
  }catch(error){
    results[name]={status:'FAIL',elapsedMs:Date.now()-t,error:error instanceof Error?error.message:String(error)};
  }
}
console.log(JSON.stringify({at:new Date().toISOString(),source:'GitHub hosted runner, not the user LAN',
  elapsedMs:Date.now()-started,results},null,2));
if(Object.values(results).some(x=>x.status==='FAIL'))process.exitCode=1;
