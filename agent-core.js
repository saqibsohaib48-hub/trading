/* Scalp Radar · Trade Agent core
   Shared by scalp-radar.html (runs the autopilot after every scan) and agent.html (shows memory, findings, lets you decide).
   Pure logic plus browser storage. No orders are ever sent anywhere. */
(function(){
'use strict';
const KEYS={S:'scalpRadarV1',D:'scalpRadarDemoV1',F:'scalpRadarFutV1',CMD:'scalpRadarAgentCmd',MEM:'scalpRadarAgentMem'};
const sum=a=>a.reduce((s,x)=>s+x,0),avg=a=>a.length?sum(a)/a.length:0;
const money=n=>(n<0?'−$':'$')+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const smoney=n=>(n>0?'+':n<0?'−':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=(n,d=1)=>isFinite(n)?(n>0?'+':'')+n.toFixed(d)+'%':'—';
const cls=n=>n>0?'up':n<0?'dn':'mut';
const fr=n=>isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'R':'—';
const fpf=n=>n===Infinity?'∞':isFinite(n)&&n>0?n.toFixed(2):'0.00';
const dur=x=>{const m=Math.round(x);return m<60?m+'m':Math.floor(m/60)+'h '+(m%60)+'m'};
const hh=h=>String(h).padStart(2,'0')+':00';
const getLS=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}};
const setLS=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}};
const clone=o=>JSON.parse(JSON.stringify(o));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const DAY=864e5;

/* ---------- settings view (same for both pages) ---------- */
const DEFS={ready:70,minInd:12,side:'BOTH',exitMode:'strict',risk:1,block:[],badHours:[],btcFilter:false,minAtr:0};
function settingsView(S,D,F){const s=Object.assign({},DEFS,S||{});s.block=(s.block||[]).slice();s.badHours=(s.badHours||[]).slice();
  s.lev=F&&F.cfg?F.cfg.lev:10;s.futRisk=F&&F.cfg?F.cfg.risk:1;s.maxHold=F&&F.cfg?F.cfg.maxHold:60;return s}

/* ---------- trades ---------- */
function norm(t,acct){const c=t.ctx||{},fut=acct==='Futures';
  return{acct,base:t.base,sym:t.sym,dir:t.dir,lev:t.lev||1,openAt:t.openAt,closeAt:t.closeAt,why:t.why||'',
    net:fut?t.net:t.pnl,gross:fut?t.gross:(t.pnl+(t.fees||0)),fees:t.fees||0,funding:t.funding||0,R:t.R||0,hold:(t.closeAt-t.openAt)/60000,
    score:c.score??t.score??null,ind:c.ind??null,agree:c.agree??null,rsi:c.rsi??null,atr:c.atr??null,volX:c.volX??null,whale:c.whale??null,
    btc:c.btc??null,rank:c.rank??null,tags:c.tags||[],hour:c.hour??new Date(t.openAt).getHours(),dow:c.dow??new Date(t.openAt).getDay(),hasCtx:!!t.ctx}}
function tradesFrom(spot,fut,mode){const out=[];
  if(mode!=='Spot'&&fut)for(const t of fut.closed||[])out.push(norm(t,'Futures'));
  if(mode!=='Futures'&&spot)for(const t of spot.closed||[])out.push(norm(t,'Spot'));
  return out.filter(t=>isFinite(t.net)).sort((a,b)=>a.closeAt-b.closeAt)}
const learnMode=(spot,fut)=>fut&&fut.closed&&fut.closed.length?'Futures':'Spot';
function stats(a){const n=a.length,w=a.filter(t=>t.net>0),l=a.filter(t=>t.net<=0),gw=sum(w.map(t=>t.net)),gl=-sum(l.map(t=>t.net));
  let st=0,maxL=0;for(const t of a){if(t.net<=0){st++;maxL=Math.max(maxL,st)}else st=0}
  return{n,wins:w.length,wr:n?w.length/n*100:0,net:sum(a.map(t=>t.net)),gross:sum(a.map(t=>t.gross)),fees:sum(a.map(t=>t.fees)),funding:sum(a.map(t=>t.funding)),
    pf:gl?gw/gl:(gw?Infinity:0),exp:n?sum(a.map(t=>t.net))/n:0,expR:n?avg(a.map(t=>t.R)):0,avgW:w.length?gw/w.length:0,avgL:l.length?gl/l.length:0,maxL,hold:n?avg(a.map(t=>t.hold)):0}}
function drawdown(a,base){let eq=base,peak=base,dd=0;for(const t of a){eq+=t.net;peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak*100)}return dd}
const confOf=n=>n>=50?'High':n>=20?'Medium':'Low';
function sweep(T,key,from,to){const K=T.filter(t=>t[key]!=null),rows=[];for(let v=from;v<=to;v++){const a=K.filter(t=>t[key]>=v);if(a.length)rows.push(Object.assign({v},stats(a)))}return{K,rows}}
function groupBy(T,fn){const g={};for(const t of T){const k=fn(t);if(k==null)continue;(g[k]=g[k]||[]).push(t)}return g}
const againstBtc=t=>t.btc!=null&&((t.dir==='LONG'&&t.btc<-0.3)||(t.dir==='SHORT'&&t.btc>0.3));

/* ---------- memory ---------- */
function defMem(){return{v:1,autopilot:true,lessons:[],vetoes:{},strikes:{},log:[],lastAuto:0}}
function loadMem(){const m=Object.assign(defMem(),getLS(KEYS.MEM)||{});m.lessons=m.lessons||[];m.vetoes=m.vetoes||{};m.strikes=m.strikes||{};m.log=m.log||[];return m}
function saveMem(m){if(m.log.length>300)m.log.length=300;if(m.lessons.length>300)m.lessons=m.lessons.slice(0,300);return setLS(KEYS.MEM,m)}
function vetoed(m,key,now=Date.now()){return(m.vetoes[key]||0)>now}
function veto(key,days=14){const m=loadMem();m.vetoes[key]=Date.now()+days*DAY;m.log.unshift({at:Date.now(),by:'you',text:`Told the agent not to suggest “${key}” for ${days} days`});saveMem(m)}

/* ---------- mistakes: why each losing trade lost ---------- */
const MISTAKES={
  against:{label:'Traded against the BTC trend',guard:s=>s.btcFilter?'Guarded: trades against BTC are skipped':null},
  weak:{label:'Weak signal score (below 75)',guard:s=>s.ready>=75?`Guarded: Ready threshold is ${s.ready}`:null},
  fewind:{label:'Few indicators agreed (below 14 of 20)',guard:s=>s.minInd>=14?`Guarded: needs ${s.minInd}/20 indicators`:null},
  stretched:{label:'Entered when RSI was already stretched',guard:()=>null},
  quiet:{label:'Market too quiet: fees ate the move',guard:s=>s.minAtr>=0.2?`Guarded: min volatility ${s.minAtr}%`:null},
  wild:{label:'Market too wild: stop hit by noise',guard:()=>null},
  fast:{label:'Stopped out within 10 minutes (bad timing)',guard:()=>null},
  time:{label:'Trade went nowhere and ran out of time',guard:s=>s.maxHold<=40?`Guarded: time limit ${s.maxHold} min`:null},
  repeat:{label:'Re-entered a coin that just lost',guard:()=>null},
  fees:{label:'Right direction, but fees turned it into a loss',guard:()=>null},
  coin:{label:'Traded a coin that keeps losing',guard:(s,t)=>t&&s.block.includes(t.base)?`Guarded: ${t.base} is blocked`:null},
  hour:{label:'Traded in an hour that keeps losing',guard:(s,t)=>t&&s.badHours.includes(t.hour)?`Guarded: ${hh(t.hour)} is paused`:null}};
function mistakesOf(t,T,i){const m=[];if(t.net>0)return m;
  if(againstBtc(t))m.push('against');
  if(t.score!=null&&t.score<75)m.push('weak');
  if(t.ind!=null&&t.ind<14)m.push('fewind');
  if(t.rsi!=null&&((t.dir==='LONG'&&t.rsi>66)||(t.dir==='SHORT'&&t.rsi<34)))m.push('stretched');
  if(t.atr!=null&&t.atr<0.2)m.push('quiet');
  if(t.atr!=null&&t.atr>1.2)m.push('wild');
  if(/Stop loss/.test(t.why)&&t.hold<10)m.push('fast');
  if(/Time limit/.test(t.why))m.push('time');
  if(T.slice(Math.max(0,i-15),i).some(p=>p.base===t.base&&p.net<0&&t.openAt-p.closeAt<6*36e5))m.push('repeat');
  if(t.gross>0&&t.net<=0)m.push('fees');
  return m}
function mistakeReport(T,set){const losers=[],counts={};
  T.forEach((t,i)=>{const ms=mistakesOf(t,T,i);if(t.net<=0){losers.push({t,ms});for(const k of ms)(counts[k]=counts[k]||[]).push(t)}});
  const bc=groupBy(T,t=>t.base),badC=new Set(Object.entries(bc).filter(([c,a])=>a.length>=4&&stats(a).net<0).map(([c])=>c));
  const bhG=groupBy(T,t=>t.hour),badH=new Set(Object.entries(bhG).filter(([h,a])=>a.length>=5&&stats(a).net<0).map(([h])=>+h));
  for(const l of losers){if(badC.has(l.t.base)){l.ms.push('coin');(counts.coin=counts.coin||[]).push(l.t)}if(badH.has(l.t.hour)){l.ms.push('hour');(counts.hour=counts.hour||[]).push(l.t)}}
  const rows=Object.entries(counts).map(([k,a])=>({key:k,label:MISTAKES[k].label,n:a.length,lost:-sum(a.map(t=>t.net)),
    guard:MISTAKES[k].guard(set,k==='coin'||k==='hour'?null:null)||(k==='coin'&&a.every(t=>set.block.includes(t.base))?'Guarded: all these coins are blocked':null)||(k==='hour'&&a.every(t=>set.badHours.includes(t.hour))?'Guarded: all these hours are paused':null)}))
    .sort((a,b)=>b.lost-a.lost);
  return{losers,rows,unexplained:losers.filter(l=>!l.ms.length).length}}

/* ---------- findings (each one is a lesson the agent could learn) ---------- */
function badCoins(T,set,mem){const g=groupBy(T,t=>t.base);return Object.entries(g).filter(([c,a])=>{const s=stats(a);return a.length>=4&&s.net<0&&s.wr<40&&!set.block.includes(c)&&!(mem&&vetoed(mem,'coin:'+c))}).map(([c])=>c).sort()}
function badHours(T,set,mem){const g=groupBy(T,t=>t.hour);return Object.entries(g).filter(([h,a])=>{const s=stats(a);return a.length>=5&&s.net<0&&s.expR<-0.3&&!set.badHours.includes(+h)&&!(mem&&vetoed(mem,'hour:'+h))}).sort((a,b)=>stats(a[1]).net-stats(b[1]).net).slice(0,4).map(([h])=>+h).sort((a,b)=>a-b)}
function findings(T,set,opts){
  opts=opts||{};const mem=opts.mem||loadMem(),base=opts.base||1000,out=[],S0=stats(T);
  const add=f=>{if((f.key&&vetoed(mem,f.key))||vetoed(mem,'id:'+f.id))return;out.push(f)};
  if(T.length<20)add({id:'sample',sev:'info',title:`Only ${T.length} closed trade${T.length===1?'':'s'} so far`,body:`The agent needs about <b>20 trades</b> for first hints and <b>30+</b> before autopilot makes any change. Keep auto-scan and the demo running.`,conf:'—'});
  if(T.length&&T.filter(t=>!t.hasCtx).length>T.length*0.5)add({id:'ctx',sev:'info',title:'Older trades have no entry details',body:'Trades opened before the agent update did not record score, indicators, RSI or volatility, so some findings use only the newer trades. This fixes itself as new trades close.',conf:'—'});
  if(T.length>=10){
    if(S0.exp>0&&S0.pf>=1.3)add({id:'ok',sev:'good',title:`Profitable after all costs: ${smoney(S0.net)} over ${S0.n} trades`,body:`Profit factor <b>${fpf(S0.pf)}</b>, average <b>${fr(S0.expR)}</b> (${smoney(S0.exp)}) per trade, win rate ${S0.wr.toFixed(0)}%. Keep the current rules and keep collecting trades before changing much.`,conf:confOf(S0.n)});
    else if(S0.exp<=0)add({id:'losing',sev:'bad',title:`Losing after costs: ${smoney(S0.net)} over ${S0.n} trades`,body:`Average <b>${fr(S0.expR)}</b> (${smoney(S0.exp)}) per trade, profit factor ${fpf(S0.pf)}. ${S0.gross>0?'The trades make money before fees, so the fixes below aim at fewer, stronger trades.':'The trades lose even before fees, so the signals need to be stricter. The fixes below show where to start.'}`,conf:confOf(S0.n)});
    else add({id:'thin',sev:'warn',title:`Small profit: ${smoney(S0.net)} over ${S0.n} trades`,body:`Profit factor <b>${fpf(S0.pf)}</b> is below 1.3, so a few bad trades could wipe it out. Look at the fixes below.`,conf:confOf(S0.n)});
  }
  for(const [key,label,cur,setKey] of [['score','Ready score threshold',set.ready,'ready'],['ind','minimum indicators agreeing',set.minInd,'minInd']]){
    const {K,rows}=sweep(T,key,cur,key==='score'?92:20),minN=Math.max(10,Math.ceil(K.length*0.3));if(K.length<15)continue;
    const b0=stats(K),ok=rows.filter(r=>r.n>=minN&&r.v>cur);if(!ok.length)continue;
    const best=ok.reduce((a,b)=>b.exp>a.exp?b:a);
    if(best.exp>b0.exp+Math.abs(b0.exp)*0.15&&best.exp>0)
      add({id:'cut-'+key+'-'+best.v,key:'rule:'+setKey,kind:setKey,sev:b0.exp<=0?'bad':'warn',n:best.n,title:`Raise the ${label} from ${cur} to ${best.v}`,
        body:`Trades with ${key==='score'?'score':'indicators'} ≥ <b>${best.v}</b>: ${best.n} trades, <b>${smoney(best.exp)}</b> avg (${fr(best.expR)}), win rate ${best.wr.toFixed(0)}%, PF ${fpf(best.pf)}. All trades: ${K.length} trades, ${smoney(b0.exp)} avg, PF ${fpf(b0.pf)}. You trade less often but each trade is better.`,
        conf:confOf(best.n),act:{label:`Set to ${best.v}`,cmd:{S:{[setKey]:best.v}},summary:`${label} → ${best.v}`,auto:true}});
  }
  const L=stats(T.filter(t=>t.dir==='LONG')),Sh=stats(T.filter(t=>t.dir==='SHORT'));
  if(set.side==='BOTH'){
    if(Sh.n>=10&&Sh.exp<0&&L.n>=10&&L.exp>0)add({id:'side-long',key:'rule:side',kind:'side',sev:'warn',n:Math.min(L.n,Sh.n),title:'Shorts are losing money, longs are not',body:`Shorts: ${Sh.n} trades, <b>${smoney(Sh.net)}</b>, avg ${fr(Sh.expR)}. Longs: ${L.n} trades, <b>${smoney(L.net)}</b>, avg ${fr(L.expR)}. Trading long only would have kept the winners. The agent re-tests shorts after a week, because this flips when the market turns.`,conf:confOf(Math.min(L.n,Sh.n)),act:{label:'Long only',cmd:{S:{side:'LONG'}},summary:'Trade direction → long only',auto:true,expireDays:7}});
    if(L.n>=10&&L.exp<0&&Sh.n>=10&&Sh.exp>0)add({id:'side-short',key:'rule:side',kind:'side',sev:'warn',n:Math.min(L.n,Sh.n),title:'Longs are losing money, shorts are not',body:`Longs: ${L.n} trades, <b>${smoney(L.net)}</b>, avg ${fr(L.expR)}. Shorts: ${Sh.n} trades, <b>${smoney(Sh.net)}</b>, avg ${fr(Sh.expR)}. Trading short only would have kept the winners. The agent re-tests longs after a week, because this flips when the market turns.`,conf:confOf(Math.min(L.n,Sh.n)),act:{label:'Short only',cmd:{S:{side:'SHORT'}},summary:'Trade direction → short only',auto:true,expireDays:7}});
  }else add({id:'side-on-'+set.side,sev:'info',title:`Trading ${set.side.toLowerCase()} only right now`,body:`The ${set.side==='LONG'?'short':'long'} side is switched off, so there is no fresh data on it.`,conf:'—',act:{label:'Allow both',cmd:{S:{side:'BOTH'}},summary:'Trade direction → long and short'}});
  const bc=badCoins(T,set,mem);
  if(bc.length)add({id:'coins-'+bc.join(','),kind:'coins',coins:bc,sev:'warn',n:sum(bc.map(c=>T.filter(t=>t.base===c).length)),title:`Block ${bc.length} coin${bc.length>1?'s':''} that keep losing: ${bc.join(', ')}`,
    body:bc.map(c=>{const s=stats(T.filter(t=>t.base===c)),k=(mem.strikes['coin:'+c]||0);return`<b>${c}</b> ${s.n} trades, ${s.wins} wins, ${smoney(s.net)}${k?` · blocked ${k}× before`:''}`}).join(' · ')+'. Blocked coins still show in the scanner but the demos skip them. The block is lifted later to re-test, and lasts longer each time a coin is blocked again.',
    conf:confOf(sum(bc.map(c=>T.filter(t=>t.base===c).length))),act:{label:'Block coins',cmd:{S:{block:[...new Set([...set.block,...bc])]}},summary:`Blocked ${bc.join(', ')}`,auto:true,coins:bc}});
  const bh=badHours(T,set,mem);
  if(bh.length)add({id:'hours-'+bh.join(','),kind:'hours',hours:bh,sev:'warn',n:sum(bh.map(h=>T.filter(t=>t.hour===h).length)),title:`Pause trading in ${bh.length} losing hour${bh.length>1?'s':''}: ${bh.map(hh).join(', ')}`,
    body:bh.map(h=>{const s=stats(T.filter(t=>t.hour===h));return`<b>${hh(h)}</b> ${s.n} trades, ${smoney(s.net)}, avg ${fr(s.expR)}`}).join(' · ')+'. Local time. The demos just don’t open new trades in these hours.',
    conf:confOf(sum(bh.map(h=>T.filter(t=>t.hour===h).length))),act:{label:'Pause hours',cmd:{S:{badHours:[...new Set([...set.badHours,...bh])].sort((a,b)=>a-b)}},summary:`Paused hours ${bh.map(hh).join(', ')}`,auto:true,hours:bh}});
  const ag=T.filter(againstBtc);
  if(!set.btcFilter&&ag.length>=10){const s=stats(ag),w=stats(T.filter(t=>t.btc!=null&&!againstBtc(t)));if(s.expR<0&&w.expR>s.expR+0.2)add({id:'btc',key:'rule:btcFilter',kind:'btcFilter',sev:'warn',n:s.n,title:'Trades against the BTC trend keep losing',body:`Against BTC: ${s.n} trades, avg <b>${fr(s.expR)}</b>, ${smoney(s.net)}. With BTC or neutral: avg ${fr(w.expR)}. Skipping trades that fight BTC removes this mistake.`,conf:confOf(s.n),act:{label:'Skip trades against BTC',cmd:{S:{btcFilter:true}},summary:'Skip trades against the BTC trend',auto:true}})}
  if(!(set.minAtr>=0.2)){const q=T.filter(t=>t.atr!=null&&t.atr<0.2),o=T.filter(t=>t.atr!=null&&t.atr>=0.2);if(q.length>=10&&o.length>=10){const s=stats(q),w=stats(o);if(s.expR<0&&w.expR>s.expR+0.2)add({id:'atr',key:'rule:minAtr',kind:'minAtr',sev:'warn',n:s.n,title:'Quiet markets lose money after fees',body:`When 5m volatility (ATR) was below 0.2%: ${s.n} trades, avg <b>${fr(s.expR)}</b>. Above it: avg ${fr(w.expR)}. Moves that small don’t pay for the fees.`,conf:confOf(s.n),act:{label:'Min volatility 0.2%',cmd:{S:{minAtr:0.2}},summary:'Skip trades when ATR is below 0.2%',auto:true}})}}
  if(T.length>=10){const s=stats(T),costs=s.fees-s.funding;
    if(s.gross>0&&costs/s.gross>0.5)add({id:'costs',key:'rule:ready',kind:'ready',sev:'warn',n:s.n,title:`Fees${s.funding?' and funding':''} eat ${(costs/s.gross*100).toFixed(0)}% of your gross profit`,body:`Your trades made ${smoney(s.gross)} before costs, then paid ${money(s.fees)} in fees${s.funding?` and ${smoney(-s.funding)} in funding`:''} (about ${money(s.fees/s.n)} per trade). The direction is right; there are too many small trades. Raising the Ready threshold by 3 means fewer, stronger trades that keep more of the move.`,conf:confOf(s.n),act:{label:`Ready → ${set.ready+3}`,cmd:{S:{ready:set.ready+3}},summary:`Ready threshold → ${set.ready+3} (cut fees)`,auto:true}});
    if(s.gross<=0)add({id:'noedge',sev:'bad',title:'No edge before costs',body:`The trades lost ${smoney(s.gross)} even before fees. The entries are the problem, not the fees. Stricter entries are the first step; the What-if simulator shows which rules would have been profitable.`,key:'rule:start',kind:'ready',n:s.n,conf:confOf(s.n),act:{label:`Ready → ${Math.min(85,set.ready+3)}, indicators → ${Math.min(18,set.minInd+2)}`,cmd:{S:{ready:Math.min(85,set.ready+3),minInd:Math.min(18,set.minInd+2)}},summary:`Stricter entries: Ready → ${Math.min(85,set.ready+3)}, indicators → ${Math.min(18,set.minInd+2)}`,auto:true}})}
  const dd=drawdown(T,base);
  if(T.length>=10&&(dd>10||S0.maxL>=6)&&set.risk>0.25)add({id:'risk',key:'rule:risk',kind:'risk',sev:'bad',n:T.length,title:`Drawdown ${dd.toFixed(1)}%, ${S0.maxL} losses in a row`,body:`At the current risk this streak costs too much. Halving risk per trade halves the damage while the other rules improve.`,conf:confOf(T.length),
    act:{label:'Halve risk',cmd:{S:{risk:Math.max(0.25,+(set.risk/2).toFixed(2))},fut:{risk:Math.max(0.25,+(set.futRisk/2).toFixed(2))}},summary:`Risk per trade → ${Math.max(0.25,+(set.risk/2).toFixed(2))}% spot, ${Math.max(0.25,+(set.futRisk/2).toFixed(2))}% futures`,auto:true,safety:true}});
  const liq=T.filter(t=>t.why==='Liquidated');
  if(liq.length&&set.lev>2)add({id:'liq',key:'rule:lev',kind:'lev',sev:'bad',n:liq.length,title:`${liq.length} liquidation${liq.length>1?'s':''}`,body:`Liquidations lost ${money(-sum(liq.map(t=>t.net)))}. Lower leverage moves the liquidation price further from your stop.`,conf:'High',act:{label:`Leverage → ${Math.max(2,Math.floor(set.lev/2))}×`,cmd:{fut:{lev:Math.max(2,Math.floor(set.lev/2))}},summary:`Futures leverage → ${Math.max(2,Math.floor(set.lev/2))}×`,auto:true,safety:true}});
  const sig=T.filter(t=>/Left|Signal|Dropped|No longer/.test(t.why)),tpsl=T.filter(t=>!/Left|Signal|Dropped|No longer|Manual|Time/.test(t.why));
  if(sig.length>=8){const a=stats(sig),b=stats(tpsl);
    if(set.exitMode==='strict'&&a.expR<-0.1&&b.expR>0&&tpsl.length>=8)add({id:'exit-fade',key:'rule:exitMode',kind:'exitMode',sev:'warn',n:a.n,title:'Closing on signal changes is cutting trades too early',body:`${a.n} trades closed because the signal changed: avg <b>${fr(a.expR)}</b>. Trades that ran to their stop or targets: avg <b>${fr(b.expR)}</b>. Holding through WATCH lets more trades reach their targets.`,conf:confOf(a.n),act:{label:'Hold through WATCH',cmd:{S:{exitMode:'fade'}},summary:'Close rule → only on reversal or WAIT',auto:true}});
    if(set.exitMode!=='strict'&&a.expR>0.1&&b.expR<0)add({id:'exit-strict',key:'rule:exitMode',kind:'exitMode',sev:'warn',n:a.n,title:'Early exits on signal changes are helping',body:`Signal-change exits avg <b>${fr(a.expR)}</b> vs ${fr(b.expR)} for trades left to their stop/targets. Closing as soon as a coin leaves the Trade now list protects more profit.`,conf:confOf(a.n),act:{label:'Strict exits',cmd:{S:{exitMode:'strict'}},summary:'Close rule → leaves READY',auto:true}})}
  const tl=T.filter(t=>t.why.includes('Time limit'));
  if(tl.length>=6&&set.maxHold>40){const s=stats(tl);if(s.expR<-0.15)add({id:'time',key:'rule:maxHold',kind:'maxHold',sev:'info',n:s.n,title:`Trades that hit the time limit lose on average (${fr(s.expR)})`,body:`${s.n} trades ran out of time. If a scalp hasn’t worked in 40 minutes it rarely does; a shorter limit frees the slot for a better setup.`,conf:confOf(s.n),act:{label:'Time limit → 40 min',cmd:{fut:{maxHold:40},spot:{maxHold:40}},summary:'Time limit → 40 min',auto:true}})}
  const tagG={};for(const t of T)for(const g of t.tags)(tagG[g]=tagG[g]||[]).push(t);
  const bestTag=Object.entries(tagG).filter(([k,a])=>a.length>=6).map(([k,a])=>[k,stats(a)]).sort((a,b)=>b[1].expR-a[1].expR)[0];
  if(bestTag&&bestTag[1].expR>S0.expR+0.2&&bestTag[1].expR>0)add({id:'tag-'+bestTag[0],sev:'good',title:`Best setups carry the “${bestTag[0]}” tag`,body:`${bestTag[1].n} trades, avg <b>${fr(bestTag[1].expR)}</b>, win rate ${bestTag[1].wr.toFixed(0)}% vs ${fr(S0.expR)} overall. When trading by hand, favor cards with this tag.`,conf:confOf(bestTag[1].n)});
  // never say "fixes below" without one: give a safe starting fix when losing and nothing else has enough data
  if(T.length>=10&&S0.exp<=0&&!out.some(f=>f.act&&f.sev!=='info')&&!vetoed(mem,'rule:start')){
    const r2=Math.min(85,set.ready+3),i2=Math.min(18,set.minInd+2);
    add({id:'start',key:'rule:start',kind:'ready',sev:'warn',n:T.length,title:`Start here: stricter entries (Ready ${set.ready} → ${r2}, indicators ${set.minInd} → ${i2})`,
      body:`With ${T.length} trades${T.filter(t=>!t.hasCtx).length?`, ${T.filter(t=>!t.hasCtx).length} of them without entry details,`:''} there isn’t enough data yet to pinpoint the exact cause. The safest first step for a losing scalper is fewer, higher-quality trades: it cuts fees and drops the weakest setups. The agent re-checks after the next 20 trades and undoes it if results get worse.`,
      conf:confOf(T.length),act:{label:'Apply both',cmd:{S:{ready:r2,minInd:i2}},summary:`Stricter entries: Ready → ${r2}, indicators → ${i2}`,auto:true}})}
  const order={bad:0,warn:1,good:2,info:3};return out.sort((a,b)=>order[a.sev]-order[b.sev]);
}

/* ---------- applying a change and remembering it as a lesson ---------- */
function snapshotOf(cmd,S,D,F){const b={S:{},spot:{},fut:{}};
  for(const k in cmd.S||{})b.S[k]=clone(S[k]!==undefined?S[k]:DEFS[k]);
  for(const k in cmd.spot||{})b.spot[k]=D&&D.cfg?clone(D.cfg[k]):undefined;
  for(const k in cmd.fut||{})b.fut[k]=F&&F.cfg?clone(F.cfg[k]):undefined;return b}
function applyTo(cmd,S,D,F){if(cmd.S)Object.assign(S,clone(cmd.S));if(cmd.spot&&D&&D.cfg)Object.assign(D.cfg,clone(cmd.spot));if(cmd.fut&&F&&F.cfg)Object.assign(F.cfg,clone(cmd.fut))}
function recordLesson(mem,f,before,by,T,now){
  const act=f.act,recent=T.slice(-50),bs=stats(recent);
  const L={id:now+'-'+Math.random().toString(36).slice(2,6),at:now,by,kind:f.kind||'other',key:f.key||null,title:f.title,summary:act.summary,
    before,after:{S:clone(act.cmd.S||{}),spot:clone(act.cmd.spot||{}),fut:clone(act.cmd.fut||{})},coins:act.coins||null,hours:act.hours||null,
    base:{n:bs.n,expR:bs.expR,pf:bs.pf},status:act.safety?'learned':'testing',reviewN:20,expiresAt:null,result:null};
  if(act.coins){L.expiresAt={};for(const c of act.coins){const k=(mem.strikes['coin:'+c]||0)+1;mem.strikes['coin:'+c]=k;L.expiresAt[c]=now+Math.min(56,7*2**(k-1))*DAY}}
  if(act.hours){L.expiresAt={};for(const h of act.hours){const k=(mem.strikes['hour:'+h]||0)+1;mem.strikes['hour:'+h]=k;L.expiresAt[h]=now+Math.min(56,14*2**(k-1))*DAY}}
  if(act.expireDays)L.expiresAt={all:now+act.expireDays*DAY};
  mem.lessons.unshift(L);
  mem.log.unshift({at:now,by,text:`${by==='autopilot'?'Learned':'You applied'}: ${act.summary}`+(by==='autopilot'?` (based on ${f.n||'?'} trades, confidence ${f.conf})`:'')});
  return L}
function revertLesson(L,S,D,F){
  if(L.coins){S.block=(S.block||[]).filter(c=>!L.coins.includes(c));return true}
  if(L.hours){S.badHours=(S.badHours||[]).filter(h=>!L.hours.includes(h));return true}
  let any=false;
  for(const [sec,obj] of [['S',S],['spot',D&&D.cfg],['fut',F&&F.cfg]]){if(!obj)continue;
    for(const k in L.after[sec]||{})if(same(obj[k],L.after[sec][k])){obj[k]=clone(L.before[sec][k]);any=true}}
  return any}

/* ---------- autopilot: called by the scanner after every scan ---------- */
const AUTO={minTrades:30,gapTrades:10,gapMs:2*36e5,reviewN:20};
function autopilotStep(ctx){
  const {S,D,F}=ctx,now=ctx.now||Date.now(),mem=loadMem(),notes=[];let changed=false;
  if(!mem.autopilot)return{changed:false,notes,mem};
  const T=tradesFrom(D,F,learnMode(D,F)),set=()=>settingsView(S,D,F);
  // 1. review lessons under test: keep what worked, undo what didn't
  for(const L of mem.lessons.filter(l=>l.status==='testing')){
    const after=T.filter(t=>t.openAt>L.at);if(after.length<L.reviewN)continue;
    const a=stats(after);L.result={n:a.n,expR:a.expR,pf:a.pf,at:now};
    if(a.expR<L.base.expR-0.1){if(revertLesson(L,S,D,F))changed=true;L.status='reverted';mem.vetoes[L.key||('lesson:'+L.kind)]=now+7*DAY;
      const msg=`Undid “${L.summary}”: the next ${a.n} trades averaged ${fr(a.expR)} vs ${fr(L.base.expR)} before. Won’t retry for 7 days.`;mem.log.unshift({at:now,by:'autopilot',text:msg});notes.push(msg)}
    else{L.status='learned';const msg=`Kept “${L.summary}”: the next ${a.n} trades averaged ${fr(a.expR)} vs ${fr(L.base.expR)} before.`;mem.log.unshift({at:now,by:'autopilot',text:msg});notes.push(msg)}}
  // 2. lift expired blocks so coins, hours and the other side get re-tested
  for(const L of mem.lessons.filter(l=>l.expiresAt&&(l.status==='testing'||l.status==='learned'))){
    if(L.coins){const due=L.coins.filter(c=>L.expiresAt[c]<=now&&(S.block||[]).includes(c));if(due.length){S.block=S.block.filter(c=>!due.includes(c));changed=true;L.coins=L.coins.filter(c=>!due.includes(c));
      const msg=`Re-testing ${due.join(', ')}: block expired. If ${due.length>1?'they lose':'it loses'} again, the next block lasts twice as long.`;mem.log.unshift({at:now,by:'autopilot',text:msg});notes.push(msg);if(!L.coins.length)L.status='expired'}}
    else if(L.hours){const due=L.hours.filter(h=>L.expiresAt[h]<=now&&(S.badHours||[]).includes(h));if(due.length){S.badHours=S.badHours.filter(h=>!due.includes(h));changed=true;L.hours=L.hours.filter(h=>!due.includes(h));
      const msg=`Re-testing ${due.map(hh).join(', ')}: pause expired.`;mem.log.unshift({at:now,by:'autopilot',text:msg});notes.push(msg);if(!L.hours.length)L.status='expired'}}
    else if(L.expiresAt.all&&L.expiresAt.all<=now){if(revertLesson(L,S,D,F))changed=true;L.status='expired';const msg=`Re-testing after “${L.summary}” expired.`;mem.log.unshift({at:now,by:'autopilot',text:msg});notes.push(msg)}}
  // 3. learn one new lesson, within the safety limits
  const since=T.filter(t=>t.closeAt>mem.lastAuto).length;
  if(T.length>=AUTO.minTrades&&now-mem.lastAuto>=AUTO.gapMs&&(mem.lastAuto===0||since>=AUTO.gapTrades)){
    const base=(learnMode(D,F)==='Futures'?(F&&F.base):(D&&D.base))||1000;
    const testing=new Set(mem.lessons.filter(l=>l.status==='testing').map(l=>l.kind));
    const f=findings(T,set(),{mem,base}).find(f=>f.act&&f.act.auto&&(f.act.safety||f.conf==='Medium'||f.conf==='High')&&!testing.has(f.kind)&&!(f.key&&vetoed(mem,f.key,now)));
    if(f){const before=snapshotOf(f.act.cmd,S,D,F);applyTo(f.act.cmd,S,D,F);recordLesson(mem,f,before,'autopilot',T,now);mem.lastAuto=now;changed=true;notes.push('Learned: '+f.act.summary)}
  }
  saveMem(mem);return{changed,notes,mem};
}

window.AgentCore={VERSION:5,KEYS,DEFS,AUTO,sum,avg,money,smoney,pct,cls,fr,fpf,dur,hh,getLS,setLS,settingsView,norm,tradesFrom,learnMode,stats,drawdown,confOf,sweep,groupBy,
  badCoins,badHours,findings,MISTAKES,mistakeReport,loadMem,saveMem,vetoed,veto,snapshotOf,applyTo,recordLesson,revertLesson,autopilotStep};
})();
