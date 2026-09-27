/* Shared, dependency-free validation and merge rules. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorklogCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function date(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
  function integer(n){return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;}
  function months(input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('월 데이터 형식 오류');
    const result={};
    for(const [m,v] of Object.entries(input)){
      if(!date(m+'-01')||!v||typeof v.days!=='object'||Array.isArray(v.days)||!integer(v.target))throw Error('월/목표 형식 오류: '+m);
      const copy=JSON.parse(JSON.stringify(v));
      for(const [d,x] of Object.entries(copy.days))if(!date(m+'-'+d)||!x||!integer(x.r)||!integer(x.p)||typeof (x.memo||'')!=='string'||typeof (x.unreg||'')!=='string')throw Error('일별 데이터 형식 오류: '+m+'-'+d);
      result[m]=copy;
    }return result;
  }
  function mergeAudit(old,incoming){
    if(!incoming||!date(incoming.date)||!Array.isArray(incoming.items))throw Error('검수 기록 형식 오류');
    const rows=new Map((old&&old.items||[]).map(x=>[String(x.id),x]));
    for(const x of incoming.items){
      if(!x||!/^\d+$/.test(String(x.id))||(x.applied!==undefined&&typeof x.applied!=='boolean'))throw Error('검수 항목 형식 오류');
      const prior=rows.get(String(x.id));
      rows.set(String(x.id),prior&&prior.applied&&!x.applied?prior:{...x,applied:x.applied===true});
    }
    const events=new Map();
    for(const x of [...(old&&old.executions||[]),...(incoming.executions||[])])events.set([x.id,x.action,x.at].join(':'),x);
    return {...old,...incoming,items:[...rows.values()],executions:[...events.values()]};
  }
  function unappliedIds(ids,ledger){if(!Array.isArray(ids)||ids.some(id=>!/^\d+$/.test(String(id))))throw Error('리뷰 식별자 오류');return [...new Set(ids.map(String))].filter(id=>!ledger[id]);}

  /* ── CMS 자동 집계 반영 ─────────────────────────────────
     업무일지는 "실제로 일한 날" 기준이다. 콘솔이 CMS 에서 모은
     [리뷰 ID, 승인한 날] · [제품 ID, 등록한 날] 을 날짜별 장부(_auto)에 쌓고,
     장부의 건수로 그날 리뷰·제품 수를 채운다.
     - 장부는 늘기만 한다. 다시 받아도 같은 건은 한 번만 센다.
     - 처음 자동으로 채우는 날, 전에 직접 적어 둔 값은 day.manual 에 남긴다.
     - 자동 반영 뒤 사람이 숫자를 고치면 그 차이를 조정값으로 보고 다음 동기화 때도 유지한다. */
  function pad2(n){return String(n).padStart(2,'0');}
  function blankMonth(m,target){const n=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate(),days={};for(let i=1;i<=n;i++)days[pad2(i)]={r:0,p:0,memo:'',unreg:''};return {month:m,target,days};}
  function nextDay(d){const t=new Date(Date.parse(d+'T00:00:00Z')+864e5);return t.toISOString().slice(0,10);}
  function applyWork(input,p,opts){
    if(!p||p.v!==1||!date(p.from)||!date(p.to)||p.from>p.to)throw Error('자동 집계 형식 오류');
    const lists={r:p.reviews||[],p:p.products||[]};
    for(const k of ['r','p']){
      if(!Array.isArray(lists[k])||lists[k].length>100000)throw Error('자동 집계 목록 오류');
      for(const x of lists[k])if(!Array.isArray(x)||!/^\d+$/.test(String(x[0]))||!date(x[1]))throw Error('자동 집계 항목 오류');
    }
    const target=(opts&&opts.target)||1450000;
    const out=JSON.parse(JSON.stringify(input||{}));
    const mon=m=>{if(!out[m])out[m]=blankMonth(m,target);const t=out[m];if(!t.days)t.days={};const n=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();for(let i=1;i<=n;i++)if(!t.days[pad2(i)])t.days[pad2(i)]={r:0,p:0,memo:'',unreg:''};if(t.target==null)t.target=target;return t;};
    for(const k of ['r','p'])for(const [id,d] of lists[k]){
      if(d<p.from||d>p.to)continue;
      const t=mon(d.slice(0,7));t._auto=t._auto||{r:{},p:{}};t._auto[k]=t._auto[k]||{};
      const day=t._auto[k][d.slice(8)]||(t._auto[k][d.slice(8)]=[]);
      if(day.indexOf(String(id))<0)day.push(String(id));
    }
    const changes=[],touched=new Set();
    for(let d=p.from;d<=p.to;d=nextDay(d)){
      const mm=d.slice(0,7),dd=d.slice(8),t=mon(mm),day=t.days[dd],a=t._auto||{};
      const ar=((a.r||{})[dd]||[]).length,ap=((a.p||{})[dd]||[]).length;
      const r0=day.r||0,p0=day.p||0;
      let offR=0,offP=0;
      if(day.auto){offR=r0-(day.auto.r||0);offP=p0-(day.auto.p||0);}
      else if((r0||p0)&&(r0!==ar||p0!==ap)&&!day.manual)day.manual={r:r0,p:p0};
      const nr=Math.max(0,ar+offR),np=Math.max(0,ap+offP);
      if(nr!==r0||np!==p0)changes.push({d,r:[r0,nr],p:[p0,np]});
      if(!day.auto||day.auto.r!==ar||day.auto.p!==ap||nr!==r0||np!==p0)touched.add(mm);
      day.r=nr;day.p=np;day.auto={r:ar,p:ap};
    }
    const last=mon(p.to.slice(0,7)).days[p.to.slice(8)];
    return {months:out,changes,touched:[...touched],today:{d:p.to,r:last.r,p:last.p}};
  }
  /* 브라우저에 저장된 업무일지 원문(JSON 문자열)에 자동 집계를 반영한다. 원문이 깨졌으면 손대지 않는다. */
  function syncStore(raw,work,base,now){
    const store=raw?JSON.parse(raw):(base||{v:1,months:{},dirty:[]});
    if(!store||typeof store!=='object'||!store.months)throw Error('업무일지 저장 형식 오류');
    months(store.months);
    const res=applyWork(store.months,work);
    months(res.months);
    const at=(now||new Date()).toISOString();
    res.touched.forEach(m=>{res.months[m]._u=at;});
    const dirty=new Set(Array.isArray(store.dirty)?store.dirty:[]);res.touched.forEach(m=>dirty.add(m));
    const next=Object.assign({},store,{v:store.v||1,savedAt:at,months:res.months,dirty:[...dirty]});
    return {value:JSON.stringify(next),changes:res.changes,touched:res.touched,today:res.today};
  }
  /* 검수 기록(날짜별 판정)을 기존 기록에 합친다 */
  /* 검수 기록은 날마다 쌓이므로 최근 keep 일(리뷰 작성일 기준)만 남긴다 — 업무일지 건수와 저장공간을 나눠 쓴다 */
  function syncAudit(raw,days,now,keep){
    const o=raw?JSON.parse(raw):{v:1,days:{}};
    if(!o||typeof o!=='object')throw Error('검수 기록 저장 형식 오류');
    const cur=o.days&&typeof o.days==='object'?o.days:{};const next=Object.assign({},cur);let n=0;
    Object.keys(days||{}).forEach(d=>{if(!date(d))return;const day=days[d];if(!day||!Array.isArray(day.items))return;next[d]=mergeAudit(cur[d],Object.assign({},day,{date:d}));n++;});
    const ds=Object.keys(next).sort(),k=keep||60,dropped=ds.length>k?ds.slice(0,ds.length-k):[];
    dropped.forEach(d=>{delete next[d];});
    return {value:JSON.stringify({v:1,savedAt:(now||new Date()).toISOString(),days:next}),days:n,dropped};
  }
  return {date,months,mergeAudit,unappliedIds,applyWork,syncStore,syncAudit};
});
