const $=(id)=>document.getElementById(id);
const fmtCoins=(n)=>Number.isFinite(Number(n))?new Intl.NumberFormat('en-US',{maximumFractionDigits:Math.abs(n)<100?2:0}).format(Number(n)):'—';
const fmtPct=(n)=>Number.isFinite(Number(n))?`${Number(n).toFixed(1)}%`:'—';
const fmtDays=(n)=>Number.isFinite(Number(n))?`${Number(n)<1?(Number(n)*24).toFixed(1)+'h':Number(n).toFixed(1)+'d'}`:'—';
const controls=['tier','count','fuel','upgrade1','upgrade2','sellMethod','priceMode','horizonDays','collectionIntervalDays','family','search','sort','tax','optimizerBudget','optimizerSlots','beacon','crystal','otherSpeed'];
let catalog=null,lastData=null,timer=null;

function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o)}
function populateCatalog(c){
  catalog=c;
  if(!$('tier').options.length) for(let i=1;i<=12;i++) option($('tier'),i,`Tier ${i}`);
  $('tier').value=String(c.defaults?.tier||11);
  for(const f of c.fuels||[]) option($('fuel'),f.id,f.name);
  $('fuel').value=c.defaults?.fuel||'ENCHANTED_LAVA_BUCKET';
  for(const u of c.upgrades||[]){option($('upgrade1'),u.id,u.name);option($('upgrade2'),u.id,u.name)}
  $('upgrade1').value=c.defaults?.upgrade1||'SUPER_COMPACTOR_3000';
  $('upgrade2').value=c.defaults?.upgrade2||'DIAMOND_SPREADING';
  const families=[...new Set((c.minions||[]).map(x=>x.family).filter(Boolean))].sort();
  for(const f of families) option($('family'),f,f);
}
function params(){
  const p=new URLSearchParams();
  for(const id of controls){
    const map={beacon:'beacon',crystal:'crystal',otherSpeed:'otherSpeed'};p.set(map[id]||id,$(id).value);
  }
  return p;
}
async function load(){
  $('refreshBtn').disabled=true;
  try{
    const res=await fetch('/api/minions?'+params().toString(),{cache:'no-store'});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    if(!catalog) populateCatalog(data.catalog);
    lastData=data;render(data);
  }catch(error){
    $('statusText').textContent='Error';
    $('statusMeta').textContent=error.message;
    $('statusDot').classList.remove('live');
  }finally{$('refreshBtn').disabled=false}
}
function render(data){
  const live=data.dataMode==='LIVE';
  $('statusDot').classList.toggle('live',live);
  $('statusText').textContent=live?'LIVE':data.dataMode||'Starting';
  $('statusMeta').textContent=data.status?.lastHypixelUpdate?`Market: ${new Date(data.status.lastHypixelUpdate).toLocaleTimeString()}`:'Waiting for first Bazaar snapshot';
  $('modeMeta').textContent=`${data.priceMode} · effective tax ${Number(data.effectiveTaxPercent||0).toFixed(3)}%`;

  const supported=(data.rows||[]).filter(r=>r.supported);
  const topNet=[...supported].sort((a,b)=>b.netDay-a.netDay)[0];
  const topGross=[...supported].sort((a,b)=>b.grossDay-a.grossDay)[0];
  const topPay=[...supported].filter(r=>Number.isFinite(r.paybackDays)).sort((a,b)=>a.paybackDays-b.paybackDays)[0];
  $('mNet').textContent=topNet?fmtCoins(topNet.netDay):'—';$('mNetName').textContent=topNet?.name||'—';
  $('mGross').textContent=topGross?fmtCoins(topGross.grossDay):'—';$('mGrossName').textContent=topGross?.name||'—';
  $('mPayback').textContent=topPay?fmtDays(topPay.paybackDays):'—';$('mPaybackName').textContent=topPay?.name||'Exact setup cost unavailable';
  $('mRows').textContent=supported.length;$('mCoverage').textContent=`${(data.rows||[]).length-supported.length} special/unsupported`;
  $('resultCount').textContent=`${(data.rows||[]).length} minions`;
  $('updatedText').textContent=`Calculated ${new Date(data.generatedAt).toLocaleTimeString()} · horizon ${data.horizonDays} day(s)`;

  const opt=data.optimizer||{};
  const recommendations=opt.recommendations||[];
  $('optimizerMeta').textContent=opt.budget>0
    ? `Budget ${fmtCoins(opt.budget)} · ${opt.slots} slots · exact setup costs only`
    : `${opt.slots} slots · budget ignored`;
  $('optimizerRows').innerHTML='';
  if(!recommendations.length){
    $('optimizerRows').innerHTML='<tr><td colspan="8" class="na">No profitable setup with exact cost fits the selected budget/slots.</td></tr>';
  }else{
    recommendations.forEach((r,i)=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${i+1}</td>
        <td><span class="name">${r.name} T${r.tier}</span><span class="family">${r.family}</span></td>
        <td>${r.quantity}</td>
        <td>${Number.isFinite(r.investment)?fmtCoins(r.investment):'N/A'}</td>
        <td class="profit">${fmtCoins(r.totalNetDay)}</td>
        <td>${fmtDays(r.paybackDays)}</td>
        <td>${Number.isFinite(r.unusedBudget)?fmtCoins(r.unusedBudget):'—'}</td>
        <td><span class="badge ${r.confidence}">${r.confidence}</span></td>`;
      $('optimizerRows').appendChild(tr);
    });
  }

  $('rows').innerHTML='';
  (data.rows||[]).forEach((r,i)=>{
    const tr=document.createElement('tr');
    if(!r.supported){
      tr.className='unsupported';
      tr.innerHTML=`<td>—</td><td><span class="name">${r.name}</span><span class="family">Special model</span></td><td>—</td><td colspan="8" class="na">${r.reason||'Not modeled'}</td>`;
      $('rows').appendChild(tr);return;
    }
    tr.className='dataRow';tr.dataset.index=i;
    const setup=r.setupComplete&&Number.isFinite(r.setupCost)?fmtCoins(r.setupCost):'N/A';
    const pay=Number.isFinite(r.paybackDays)?fmtDays(r.paybackDays):'N/A';
    const roi=Number.isFinite(r.roi30dPercent)?fmtPct(r.roi30dPercent):'N/A';
    tr.innerHTML=`<td>${i+1}</td>
      <td><span class="name">${r.name}</span><span class="family">${r.family}</span></td>
      <td>T${r.tier}</td>
      <td class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}</td>
      <td class="${Number(r.currentVs7dPercent)>=0?'profit':'loss'}">${Number.isFinite(r.currentVs7dPercent)?fmtPct(r.currentVs7dPercent):'N/A'}</td>
      <td>${fmtCoins(r.grossDay)}</td><td>${fmtCoins(r.expensesDay)}</td>
      <td class="${setup==='N/A'?'na':''}">${setup}</td><td class="${pay==='N/A'?'na':''}">${pay}</td>
      <td class="${roi==='N/A'?'na':''}">${roi}</td>
      <td>+${fmtPct(r.speedBonusPercent)}</td><td><span class="badge ${r.confidence}">${r.confidence}</span></td>`;
    tr.addEventListener('click',()=>showDetail(r));
    $('rows').appendChild(tr);
  });
}
function showDetail(r){
  const outputs=(r.outputDetails||[]).map(o=>`<tr><td>${o.item}<span class="family">${o.source}${o.compacted?' · compacted':''}</span></td><td>${fmtCoins(o.unitsPerDay)}</td><td>${o.quote.method}</td><td>${fmtCoins(o.quote.price)}</td><td>${fmtCoins(o.revenuePerDay)}</td></tr>`).join('');
  const warnings=[...(r.warnings||[]),...(r.setupComplete?[]:[`Setup/ROI incomplete: ${(r.setupMissing||[]).join(', ')||'exact recipe unavailable'}`])];
  $('detail').innerHTML=`<div class="detailTitle"><h2>${r.name} T${r.tier}</h2><p>${r.count} minion(s) · ${r.fuel.name} · ${r.upgrades.map(x=>x.name).join(' + ')||'no upgrades'}</p></div>
    <div class="detailStats">
      <div><span>Base action</span><strong>${r.baseSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Effective action</span><strong>${r.effectiveSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Cycles / day / minion</span><strong>${fmtCoins(r.cyclesPerDay)}</strong></div>
      <div><span>Collection interval</span><strong>${Number(r.collectionIntervalDays||1)<1?(Number(r.collectionIntervalDays||1)*24).toFixed(1)+'h':Number(r.collectionIntervalDays||1).toFixed(1)+'d'}</strong></div>
      <div><span>Net / day</span><strong class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}</strong></div>
      <div><span>Setup total</span><strong>${r.setupComplete?fmtCoins(r.setupCost):'N/A'}</strong></div>
      <div><span>Payback</span><strong>${fmtDays(r.paybackDays)}</strong></div>
      <div><span>LIVE net / day</span><strong>${fmtCoins(r.liveNetDay)}</strong></div>
      <div><span>7d expected net / day</span><strong>${fmtCoins(r.expected7dNetDay)}</strong></div>
      <div><span>LIVE vs 7d</span><strong>${Number.isFinite(r.currentVs7dPercent)?fmtPct(r.currentVs7dPercent):'—'}</strong></div>
      <div><span>7d price coverage</span><strong>${fmtPct((r.historicalCoverage||0)*100)}</strong></div>
      <div><span>Price CV</span><strong>${fmtPct((r.stabilityCv||0)*100)}</strong></div>
    </div>
    <h3>Output breakdown · per minion / day</h3>
    <table class="detailOutputs"><thead><tr><th>Output</th><th>Units</th><th>Sale</th><th>Net price</th><th>Revenue</th></tr></thead><tbody>${outputs||'<tr><td colspan="5">No priced outputs</td></tr>'}</tbody></table>
    ${warnings.length?`<div class="warnings"><strong>Notes</strong><ul>${warnings.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:''}`;
  $('detailDialog').showModal();
}
function schedule(){clearTimeout(timer);timer=setTimeout(load,180)}
for(const id of controls){$(id).addEventListener(id==='search'?'input':'change',schedule)}
$('refreshBtn').addEventListener('click',load);
$('closeDialog').addEventListener('click',()=>$('detailDialog').close());
$('detailDialog').addEventListener('click',(e)=>{if(e.target===$('detailDialog'))$('detailDialog').close()});
load();