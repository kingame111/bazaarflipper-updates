const $=(id)=>document.getElementById(id);
const fmtCoins=(n)=>Number.isFinite(Number(n))?new Intl.NumberFormat('en-US',{maximumFractionDigits:Math.abs(n)<100?2:0}).format(Number(n)):'—';
const fmtPct=(n)=>Number.isFinite(Number(n))?`${Number(n).toFixed(1)}%`:'—';
const fmtDays=(n)=>Number.isFinite(Number(n))?`${Number(n)<1?(Number(n)*24).toFixed(1)+'h':Number(n).toFixed(1)+'d'}`:'—';
const fmtSpan=(ms)=>{const x=Math.max(0,Number(ms)||0),h=x/3600000;return h<1?`${Math.round(x/60000)}m`:h<48?`${h.toFixed(h<10?1:0)}h`:`${(h/24).toFixed(1)}d`;};
const fmtAgo=(ts)=>{const age=Math.max(0,Date.now()-Number(ts||0));return !ts?'—':age<60000?`${Math.max(1,Math.round(age/1000))}s ago`:age<3600000?`${Math.round(age/60000)}m ago`:`${(age/3600000).toFixed(1)}h ago`;};
const upgradeNames=(r)=>{const names=(r.upgrades||[]).map(x=>x.name);while(names.length<2)names.push('Empty');return names.slice(0,2);};
const controls=['tier','count','fuel','sellMethod','priceMode','compareDays','collectionIntervalDays','family','search','sort','tax','beacon','crystal','otherSpeed'];
let catalog=null,lastData=null,timer=null,requestSeq=0,lastHistoryLoadedAt=null,statusTimer=null;
const COLUMN_KEY='bazaarflipper.minions.columns.v2',OLD_COLUMN_KEY='bazaarflipper.minions.columns.v1',VIEW_KEY='bazaarflipper.minions.views.v2',COMPARE_KEY='bazaarflipper.minions.compareDays.v1',EXCLUDED_KEY='bazaarflipper.minions.excludedUpgrades.v1';
const columnNames=['#','Minion','Best upgrades','Tier','Net / day','LIVE comparison','Data coverage','Gross / day','Bazaar tax / day','Recurring / day','Setup (one-time)','Payback','30d ROI','Speed'];
const headerHelp=[
  'Current rank after applying the selected sort. Rank changes when filters, tier, fuel, price model or comparison window change.',
  'The minion family being modeled. Click a row for the full calculation and output breakdown.',
  'The two compatible upgrade slots that maximize recurring net profit for the selected price model. Mutually exclusive upgrades are never stacked.',
  'The minion tier actually used in this calculation. This must match the Tier selector above.',
  'Coins kept per day after Bazaar tax and recurring consumable fuel costs. One-time setup cost is not subtracted here.',
  'Percent difference between LIVE net/day and the selected historical-window net/day for the exact same minion setup. Positive means LIVE is higher.',
  'How much reliable local price history exists for the items used by this setup during the selected comparison window. Below 80% is flagged.',
  'Total sale value before Bazaar tax and before recurring fuel costs.',
  'Estimated Bazaar selling tax paid per day for outputs sold through the Bazaar. NPC sales do not incur Bazaar tax.',
  'Recurring consumable cost per day, mainly finite-duration fuel. Permanent fuel such as Enchanted Lava Bucket correctly shows 0 here.',
  'One-time cost to build the selected minion tier, permanent fuel and upgrades. N/A appears only when an exact required component cannot be priced.',
  'One-time setup cost divided by net profit per day. It estimates how many days are needed to recover the setup cost.',
  'Thirty days of net profit divided by the one-time setup cost. This is a setup-return metric, not a Bazaar flip ROI.',
  'Combined production-speed bonus from fuel, upgrades and the external speed bonuses entered above.'
];

function loadVisibleColumns(){
  try{
    const current=JSON.parse(localStorage.getItem(COLUMN_KEY)||'null');
    if(Array.isArray(current)) return normalizeColumns(current);
    const old=JSON.parse(localStorage.getItem(OLD_COLUMN_KEY)||'null');
    if(Array.isArray(old)){const migrated=[...old];migrated.splice(8,0,true);return normalizeColumns(migrated);}
  }catch{}
  return columnNames.map(()=>true);
}
function normalizeColumns(v){const x=v.slice(0,columnNames.length);while(x.length<columnNames.length)x.push(true);x[1]=true;return x;}
let visibleColumns=loadVisibleColumns();
let excludedUpgrades=new Set();
try{excludedUpgrades=new Set(JSON.parse(localStorage.getItem(EXCLUDED_KEY)||'[]').map(x=>String(x).toUpperCase()));}catch{}

function option(select,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;select.appendChild(o)}
function populateCatalog(c){
  catalog=c;
  if(!$('tier').options.length) for(let i=1;i<=12;i++) option($('tier'),i,`Tier ${i}`);
  $('tier').value=String(c.defaults?.tier||11);
  if(!$('fuel').options.length){for(const f of c.fuels||[]) option($('fuel'),f.id,f.name);}
  $('fuel').value=c.defaults?.fuel||'ENCHANTED_LAVA_BUCKET';
  if($('family').options.length===1){
    const families=[...new Set((c.minions||[]).map(x=>x.family).filter(Boolean))].sort();
    for(const f of families) option($('family'),f,f);
  }
  buildExcludedUpgradesMenu();
}
function params(){
  const p=new URLSearchParams();
  for(const id of controls)p.set(id,$(id).value);
  p.set('excludedUpgrades',[...excludedUpgrades].sort().join(','));
  return p;
}
async function load(){
  const seq=++requestSeq;
  $('refreshBtn').disabled=true;
  try{
    const res=await fetch('/api/minions?'+params().toString(),{cache:'no-store'});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    if(seq!==requestSeq)return;
    if(!catalog)populateCatalog(data.catalog);
    if(applyHistoryWindowAvailability(data.status?.historyReliability||{})){schedule(0);return;}
    lastData=data;
    render(data);
  }catch(error){
    if(seq!==requestSeq)return;
    $('statusText').textContent='Error';
    $('statusMeta').textContent=error.message;
    $('statusDot').classList.remove('live');
  }finally{if(seq===requestSeq)$('refreshBtn').disabled=false}
}
function updateExcludedButton(){
  const count=excludedUpgrades.size;
  $('excludeUpgradesBtn').textContent=count?(`${count} excluded`):'None excluded';
  $('excludeUpgradesBtn').title=count?[...excludedUpgrades].map(id=>catalog?.upgrades?.find(x=>x.id===id)?.name||id).join(', '):'All compatible upgrades may be considered';
}
function buildExcludedUpgradesMenu(){
  const menu=$('excludeUpgradesMenu');
  if(!menu||!catalog)return;
  menu.innerHTML='';
  const list=(catalog.upgrades||[]).filter(x=>x.id!=='NONE').sort((a,b)=>a.name.localeCompare(b.name));
  for(const up of list){
    const label=document.createElement('label');
    const cb=document.createElement('input');
    cb.type='checkbox';cb.checked=excludedUpgrades.has(up.id);
    cb.addEventListener('change',()=>{
      if(cb.checked)excludedUpgrades.add(up.id);else excludedUpgrades.delete(up.id);
      localStorage.setItem(EXCLUDED_KEY,JSON.stringify([...excludedUpgrades].sort()));
      updateExcludedButton();schedule(0);
    });
    label.append(cb,document.createTextNode(up.name));menu.appendChild(label);
  }
  const actions=document.createElement('div');actions.className='excludeActions';
  const clear=document.createElement('button');clear.type='button';clear.textContent='Clear all';
  clear.onclick=()=>{excludedUpgrades.clear();localStorage.removeItem(EXCLUDED_KEY);buildExcludedUpgradesMenu();updateExcludedButton();schedule(0);};
  actions.appendChild(clear);menu.appendChild(actions);updateExcludedButton();
}

function applyHistoryWindowAvailability(hr){
  const depth=Number(hr?.reliableDepthMs)||0;
  if(!(depth>0))return false;
  const maxDays=Math.max(1,Math.min(7,Math.floor(depth/86400000)));
  for(const o of $('compareDays').options){
    const days=Number(o.value);
    o.disabled=days>maxDays;
    o.title=o.disabled?`Only ${fmtSpan(depth)} of reliable history is currently available`:'';
  }
  const selected=Number($('compareDays').value)||7;
  if(selected>maxDays){
    $('compareDays').value=String(maxDays);
    localStorage.setItem(COMPARE_KEY,String(maxDays));
    return true;
  }
  return false;
}
function updateStatusCards(status,dataMode){
  const live=(dataMode||status?.dataMode)==='LIVE';
  $('statusDot').classList.toggle('live',live);
  $('statusText').textContent=live?'LIVE':(dataMode||status?.dataMode||'Starting');
  $('statusMeta').textContent=status?.lastHypixelUpdate?`Market update: ${new Date(status.lastHypixelUpdate).toLocaleTimeString()}`:'Waiting for first Bazaar snapshot';
  const hr=status?.historyReliability||{};
  const loading=Boolean(status?.historyStatsLoading);
  $('historyDepth').textContent=loading&&!hr.reliableDepthMs?'Refreshing…':hr.reliableDepthMs>0?fmtSpan(hr.reliableDepthMs):'Building…';
  $('historyCoverage').textContent=loading?'Refreshing history statistics…':hr.reliableDepthMs>0?`${(Number(hr.coverage||0)*100).toFixed(0)}% snapshot coverage`:'Not enough continuous history yet';
}
function render(data){
  updateStatusCards(data.status,data.dataMode);
  const hr=data.status?.historyReliability||{};
  const compareDays=Math.max(1,Math.min(7,Number(data.options?.compareDays||$('compareDays').value||7)));
  $('compareHeader').textContent=`LIVE vs ${compareDays}d`;
  $('coverageHeader').textContent=`${compareDays}d coverage`;
  const histOpt=[...$('priceMode').options].find(o=>o.value==='7D');if(histOpt)histOpt.textContent=`Historical expected — ${compareDays}d`;
  $('modeMeta').textContent=`${data.priceMode} · effective tax ${Number(data.effectiveTaxPercent||0).toFixed(3)}%`;
  renderHistoryDetail(data.status);
  renderDataDetail(data.status,data.dataMode);

  const selectedTier=Number($('tier').value)||Number(data.catalog?.defaults?.tier)||11;
  const mismatched=(data.rows||[]).some(r=>r.supported&&Number(r.tier)!==selectedTier);
  if(mismatched){$('updatedText').textContent='Recalculating…';schedule(0);return;}

  const supported=(data.rows||[]).filter(r=>r.supported);
  const topNet=[...supported].sort((a,b)=>b.netDay-a.netDay)[0];
  const topGross=[...supported].sort((a,b)=>b.grossDay-a.grossDay)[0];
  const topPay=[...supported].filter(r=>Number.isFinite(r.paybackDays)).sort((a,b)=>a.paybackDays-b.paybackDays)[0];
  $('mNet').textContent=topNet?fmtCoins(topNet.netDay):'—';$('mNetName').textContent=topNet?.name||'—';
  $('mGross').textContent=topGross?fmtCoins(topGross.grossDay):'—';$('mGrossName').textContent=topGross?.name||'—';
  $('mPayback').textContent=topPay?fmtDays(topPay.paybackDays):'—';$('mPaybackName').textContent=topPay?.name||'Exact setup cost unavailable';
  $('mRows').textContent=supported.length;$('mCoverage').textContent=`${(data.rows||[]).length-supported.length} special/unsupported`;
  const totalRanked=Number(data.totalRankedRows||supported.length||0);
  $('resultCount').textContent=(data.options?.search||'').trim()?`${(data.rows||[]).length} shown · ranked among ${totalRanked}`:`${(data.rows||[]).length} minions`;
  $('updatedText').textContent=`Calculated ${new Date(data.generatedAt).toLocaleTimeString()} · collection every ${fmtDays(data.options?.collectionIntervalDays||1)}`;

  $('rows').innerHTML='';
  (data.rows||[]).forEach((r,i)=>{
    const tr=document.createElement('tr');
    if(!r.supported){
      tr.className='unsupported';
      tr.innerHTML=`<td>—</td><td><span class="name">${r.name}</span><span class="family">Special model</span></td><td>—</td><td>—</td><td colspan="10" class="na">${r.reason||'Not modeled'}</td>`;
      $('rows').appendChild(tr);return;
    }
    tr.className='dataRow';tr.dataset.index=i;
    const setup=r.setupComplete&&Number.isFinite(r.setupCost)?fmtCoins(r.setupCost):'N/A';
    const pay=Number.isFinite(r.paybackDays)?fmtDays(r.paybackDays):'N/A';
    const roi=Number.isFinite(r.roi30dPercent)?fmtPct(r.roi30dPercent):'N/A';
    const ups=upgradeNames(r),coverage=Number(r.historicalCoverage||0);
    const gap=Number.isFinite(r.netGapToNextDay)&&r.nextNetName?`<span class="gapMeta">+${fmtCoins(r.netGapToNextDay)} vs ${r.nextNetName}</span>`:'';
    const setupTitle=setup==='N/A'?`Missing setup pricing: ${(r.setupMissing||[]).join(', ')||'unknown component'}`:'Complete one-time setup estimate';
    tr.innerHTML=`<td>${r.sortRank||i+1}</td>
      <td><span class="name">${r.name}</span><span class="family">${r.family}</span></td>
      <td><span class="upgradePair"><span class="upgradePill">${ups[0]}</span><span class="upgradePill">${ups[1]}</span></span></td>
      <td>T${r.tier}</td>
      <td class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}${gap}</td>
      <td class="${Number(r.currentVsHistoryPercent)>=0?'profit':'loss'}">${Number.isFinite(r.currentVsHistoryPercent)?fmtPct(r.currentVsHistoryPercent):'N/A'}</td>
      <td class="${coverage<0.8?'historyWeak':''}" title="${coverage<0.8?`Less than 80% reliable ${compareDays}-day price coverage`:`Reliable ${compareDays}-day price coverage`}">${coverage<0.8?'⚠ ':''}${(coverage*100).toFixed(0)}%</td>
      <td>${fmtCoins(r.grossDay)}</td><td>${fmtCoins(r.bazaarTaxDay)}</td><td>${fmtCoins(r.expensesDay)}</td>
      <td class="${setup==='N/A'?'na':''}" title="${setupTitle}">${setup}</td><td class="${pay==='N/A'?'na':''}">${pay}</td>
      <td class="${roi==='N/A'?'na':''}">${roi}</td><td>+${fmtPct(r.speedBonusPercent)}</td>`;
    tr.addEventListener('click',()=>showDetail(r));
    $('rows').appendChild(tr);
  });
  applyColumnVisibility();
}
function showDetail(r){
  const alternatives=(r.upgradeAlternatives||[]).map((a,i)=>`<tr><td>${i===0?'Best':a.rank}</td><td>${(a.upgrades||[]).map(x=>x.name).join(' + ')||'No upgrades'}</td><td class="${a.netPerMinionDay>=0?'profit':'loss'}">${fmtCoins(a.netPerMinionDay)}</td><td>${fmtCoins(a.grossPerMinionDay)}</td><td>${fmtCoins(a.bazaarTaxPerMinionDay)}</td><td>${fmtCoins(a.expensesPerMinionDay)}</td><td>${a.deltaFromBestPerMinionDay===0?'—':fmtCoins(a.deltaFromBestPerMinionDay)}</td></tr>`).join('');
  const outputs=(r.outputDetails||[]).map(o=>`<tr><td>${o.item}<span class="family">${o.source}${o.compacted?' · compacted':''}</span></td><td>${fmtCoins(o.unitsPerDay)}</td><td>${o.quote.method}</td><td>${fmtCoins(o.quote.raw)}</td><td>${fmtCoins(o.grossRevenuePerDay)}</td><td>${fmtCoins(o.bazaarTaxPerDay)}</td><td>${fmtCoins(o.revenuePerDay)}</td></tr>`).join('');
  const setupRows=(r.setupBreakdown||[]).map(x=>`<tr><td>${x.name||x.item}</td><td>${x.kind||'ITEM'}</td><td>${fmtCoins(x.amount)}</td><td>${x.source||'—'}</td><td>${x.unitPrice==null?'N/A':fmtCoins(x.unitPrice)}</td><td>${x.total==null?'N/A':fmtCoins(x.total)}</td></tr>`).join('');
  const warnings=[...(r.warnings||[]),...(r.setupComplete?[]:[`Setup/ROI incomplete: ${(r.setupMissing||[]).join(', ')||'exact recipe unavailable'}`])];
  if(Number(r.historicalCoverage||0)<0.8)warnings.push(`Historical price coverage is only ${(Number(r.historicalCoverage||0)*100).toFixed(0)}% for the selected ${r.compareDays||7}-day window.`);
  $('detail').innerHTML=`<div class="detailTitle"><h2>${r.name} T${r.tier}</h2><p>${r.count} minion(s) · ${r.fuel.name} · ${r.upgrades.map(x=>x.name).join(' + ')||'no upgrades'}</p></div>
    <div class="detailStats">
      <div><span>Base action</span><strong>${r.baseSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Effective action</span><strong>${r.effectiveSecondsPerAction.toFixed(2)}s</strong></div>
      <div><span>Cycles / day / minion</span><strong>${fmtCoins(r.cyclesPerDay)}</strong></div>
      <div><span>Collection interval</span><strong>${Number(r.collectionIntervalDays||1)<1?(Number(r.collectionIntervalDays||1)*24).toFixed(1)+'h':Number(r.collectionIntervalDays||1).toFixed(1)+'d'}</strong></div>
      <div><span>Gross / day</span><strong>${fmtCoins(r.grossDay)}</strong></div>
      <div><span>Bazaar tax / day</span><strong>${fmtCoins(r.bazaarTaxDay)}</strong></div>
      <div><span>Recurring expenses / day</span><strong>${fmtCoins(r.expensesDay)}</strong></div>
      <div><span>Net / day</span><strong class="${r.netDay>=0?'profit':'loss'}">${fmtCoins(r.netDay)}</strong></div>
      <div><span>Setup total · one-time</span><strong>${r.setupComplete?fmtCoins(r.setupCost):'N/A'}</strong></div>
      <div><span>Payback</span><strong>${fmtDays(r.paybackDays)}</strong></div>
      <div><span>LIVE net / day</span><strong>${fmtCoins(r.liveNetDay)}</strong></div>
      <div><span>${r.compareDays||7}d expected net / day</span><strong>${fmtCoins(r.expectedHistoryNetDay)}</strong></div>
      <div><span>LIVE vs ${r.compareDays||7}d</span><strong>${Number.isFinite(r.currentVsHistoryPercent)?fmtPct(r.currentVsHistoryPercent):'—'}</strong></div>
      <div><span>${r.compareDays||7}d price coverage</span><strong>${fmtPct((r.historicalCoverage||0)*100)}</strong></div>
      <div><span>Price CV</span><strong>${fmtPct((r.stabilityCv||0)*100)}</strong></div>
    </div>
    <h3>Setup cost breakdown · per minion</h3>
    <p class="family">Pricing uses a direct Bazaar purchase when available; otherwise a verified crafting recipe is priced recursively from its ingredients.</p>
    <table class="detailOutputs"><thead><tr><th>Component</th><th>Type</th><th>Qty</th><th>Price source</th><th>Unit cost</th><th>Total</th></tr></thead><tbody>${setupRows||'<tr><td colspan="6">No setup-cost components</td></tr>'}</tbody></table>
    <h3>Upgrade comparison</h3>
    <p class="family">All alternatives below use the selected price model. LIVE-vs-history always re-prices the exact same winning setup rather than comparing two different setups.</p>
    <table class="detailOutputs"><thead><tr><th>Rank</th><th>Upgrade setup</th><th>Net / minion / day</th><th>Gross</th><th>Bazaar tax</th><th>Recurring cost</th><th>vs best</th></tr></thead><tbody>${alternatives||'<tr><td colspan="7">No compatible upgrade setup</td></tr>'}</tbody></table>
    <h3>Output breakdown · per minion / day</h3>
    <table class="detailOutputs"><thead><tr><th>Output</th><th>Units</th><th>Sale</th><th>Unit price</th><th>Gross</th><th>Tax</th><th>After tax</th></tr></thead><tbody>${outputs||'<tr><td colspan="7">No priced outputs</td></tr>'}</tbody></table>
    ${warnings.length?`<div class="warnings"><strong>Notes</strong><ul>${warnings.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:''}`;
  $('detailDialog').showModal();
}

function applyColumnVisibility(){
  const head=document.querySelector('.tableWrap table thead tr');
  if(head)[...head.children].forEach((c,i)=>{if(i<visibleColumns.length)c.style.display=visibleColumns[i]?'':'none';});
  document.querySelectorAll('#rows tr.dataRow').forEach(tr=>[...tr.children].forEach((c,i)=>{if(i<visibleColumns.length)c.style.display=visibleColumns[i]?'':'none';}));
}
function buildColumnsMenu(){
  const m=$('columnsMenu');m.innerHTML='';
  columnNames.forEach((n,i)=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.checked=visibleColumns[i];c.disabled=i===1;c.onchange=()=>{visibleColumns[i]=c.checked;visibleColumns[1]=true;localStorage.setItem(COLUMN_KEY,JSON.stringify(visibleColumns));applyColumnVisibility();};l.append(c,document.createTextNode(n));m.appendChild(l);});
  const a=document.createElement('div');a.className='columnActions';
  const all=document.createElement('button');all.type='button';all.textContent='Show all';all.onclick=()=>{visibleColumns=columnNames.map(()=>true);localStorage.setItem(COLUMN_KEY,JSON.stringify(visibleColumns));buildColumnsMenu();applyColumnVisibility();};
  const reset=document.createElement('button');reset.type='button';reset.textContent='Reset';reset.onclick=()=>{visibleColumns=columnNames.map(()=>true);localStorage.removeItem(COLUMN_KEY);buildColumnsMenu();applyColumnVisibility();};
  a.append(all,reset);m.appendChild(a);
}
function views(){try{return JSON.parse(localStorage.getItem(VIEW_KEY)||'{}')||{};}catch{return {};}}
function refreshViews(){const s=$('viewPreset');s.innerHTML='<option value="">Saved views…</option>';for(const n of Object.keys(views()).sort())option(s,n,n);}
function renderHistoryDetail(status){
  const h=status?.historyReliability||{},loading=Boolean(status?.historyStatsLoading);
  $('historyDetail').innerHTML=`<h2>Reliable history</h2><div class="detailStats">
    <div><span>Status</span><strong>${loading?'Refreshing…':'Ready'}</strong></div>
    <div><span>Reliable depth</span><strong>${h.reliableDepthMs?fmtSpan(h.reliableDepthMs):'Not available yet'}</strong></div>
    <div><span>Coverage</span><strong>${fmtPct(Number(h.coverage||0)*100)}</strong></div>
    <div><span>Threshold</span><strong>${fmtPct(Number(h.threshold||.8)*100)}</strong></div>
    <div><span>Reliable products</span><strong>${loading?'Refreshing…':`${h.reliableProducts||0} / ${h.products||0}`}</strong></div>
    <div><span>Reliable since</span><strong>${h.reliableSince?new Date(h.reliableSince).toLocaleString():'—'}</strong></div>
    <div><span>Snapshots checked</span><strong>${h.snapshotCount||0}</strong></div>
  </div>`;
}
function renderDataDetail(status,dataMode){
  const st=status||{},loading=Boolean(st.historyStatsLoading);
  $('dataDetail').innerHTML=`<h2>Data diagnostics</h2><div class="detailStats">
    <div><span>Mode</span><strong>${dataMode||st.dataMode||'—'}</strong></div>
    <div><span>Freshness</span><strong>${fmtAgo(st.lastHypixelUpdate)}</strong></div>
    <div><span>Market products</span><strong>${st.marketProducts??st.minionMarketProducts??0}</strong></div>
    <div><span>History products</span><strong>${loading?'Refreshing…':(st.historyProducts??0)}</strong></div>
    <div><span>History stats</span><strong>${loading?'Refreshing…':'Ready'}</strong></div>
    <div><span>Version</span><strong>${st.version||'—'}</strong></div>
  </div>`;
}
async function pollStatus(){
  try{
    const res=await fetch('/api/status',{cache:'no-store'});if(!res.ok)return;
    const st=await res.json();
    updateStatusCards(st,st.dataMode);
    renderHistoryDetail(st);renderDataDetail(st,st.dataMode);
    if(applyHistoryWindowAvailability(st.historyReliability||{})){schedule(0);return;}
    const loaded=Number(st.historyStatsLastLoadedAt)||null;
    if(lastHistoryLoadedAt==null)lastHistoryLoadedAt=loaded;
    else if(loaded&&loaded!==lastHistoryLoadedAt){lastHistoryLoadedAt=loaded;schedule(0);}
  }catch{}
}
function initHeaderHelp(){
  const ths=[...document.querySelectorAll('.tableWrap table thead th')],tip=$('hoverTooltip');
  ths.forEach((th,i)=>{
    th.dataset.help=headerHelp[i]||'';
    th.classList.add('helpHeader');th.tabIndex=0;
    const show=(e)=>{if(!th.dataset.help)return;tip.textContent=th.dataset.help;tip.hidden=false;move(e);};
    const move=(e)=>{const x=(e.clientX||th.getBoundingClientRect().left)+14,y=(e.clientY||th.getBoundingClientRect().bottom)+14;tip.style.left=Math.min(x,window.innerWidth-tip.offsetWidth-12)+'px';tip.style.top=Math.min(y,window.innerHeight-tip.offsetHeight-12)+'px';};
    th.addEventListener('mouseenter',show);th.addEventListener('mousemove',move);th.addEventListener('mouseleave',()=>tip.hidden=true);
    th.addEventListener('focus',show);th.addEventListener('blur',()=>tip.hidden=true);
  });
}
function schedule(delay=180){clearTimeout(timer);timer=setTimeout(load,delay)}
for(const id of controls){$(id).addEventListener(id==='search'?'input':'change',()=>{if(id==='compareDays')localStorage.setItem(COMPARE_KEY,$('compareDays').value);schedule();})}
$('refreshBtn').addEventListener('click',load);
$('closeDialog').addEventListener('click',()=>$('detailDialog').close());
$('detailDialog').addEventListener('click',(e)=>{if(e.target===$('detailDialog'))$('detailDialog').close()});
$('columnsBtn').onclick=()=>{$('columnsMenu').hidden=!$('columnsMenu').hidden;};
$('excludeUpgradesBtn').onclick=()=>{$('excludeUpgradesMenu').hidden=!$('excludeUpgradesMenu').hidden;};
$('saveViewBtn').onclick=()=>{const n=prompt('Name this table view:');if(!n)return;const v=views();v[n]={columns:visibleColumns,sort:$('sort').value,compareDays:$('compareDays').value,excludedUpgrades:[...excludedUpgrades]};localStorage.setItem(VIEW_KEY,JSON.stringify(v));refreshViews();};
$('viewPreset').onchange=()=>{const v=views()[$('viewPreset').value];if(!v)return;if(v.columns)visibleColumns=normalizeColumns(v.columns);if(v.sort)$('sort').value=v.sort;if(v.compareDays)$('compareDays').value=v.compareDays;if(Array.isArray(v.excludedUpgrades)){excludedUpgrades=new Set(v.excludedUpgrades.map(x=>String(x).toUpperCase()));localStorage.setItem(EXCLUDED_KEY,JSON.stringify([...excludedUpgrades]));buildExcludedUpgradesMenu();}buildColumnsMenu();applyColumnVisibility();load();};
$('historyCard').onclick=()=>$('historyDialog').showModal();$('dataDetailsBtn').onclick=()=>$('dataDialog').showModal();
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
const rc=localStorage.getItem(COMPARE_KEY);if(rc)$('compareDays').value=rc;
buildColumnsMenu();refreshViews();initHeaderHelp();updateExcludedButton();
load();pollStatus();statusTimer=setInterval(pollStatus,10000);
