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
     - 자동 집계 칸은 CMS 가 기준이다. 사람이 다른 숫자를 적어 두어도 동기화 때 CMS 건수로 바로잡는다.
       (예전에는 차이를 "조정값"으로 유지해, CMS 47건인 날에 잘못 적은 200 이 그대로 남았다)
     - 바로잡기 전에 적혀 있던 값은 day.manual 에 남겨 무엇을 고쳤는지 보인다. */
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
    /* 새 달의 목표는 직전 달 것을 이어받는다 (사람이 바꾼 목표가 다음 달에도 그대로) */
    const carrySrc=m=>{const prev=Object.keys(out).filter(k=>k<m&&out[k]&&integer(out[k].target)).sort().pop();return prev?out[prev]:null;};
    const carry=m=>{const s=carrySrc(m);return s?s.target:target;};
    /* 이어받은 목표에는 원래 정한 시각(_tc)을 함께 둔다 — 기기끼리 합칠 때 나중에 정한 목표가 이기게 */
    const carryT=(t,m)=>{const s=carrySrc(m);t.target=s?s.target:target;const tc=s?(s._t||s._tc||0):0;if(tc)t._tc=tc;};
    const mon=m=>{if(!out[m]){out[m]=blankMonth(m,carry(m));carryT(out[m],m);}const t=out[m];if(!t.days)t.days={};const n=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate();for(let i=1;i<=n;i++)if(!t.days[pad2(i)])t.days[pad2(i)]={r:0,p:0,memo:'',unreg:''};if(t.target==null)carryT(t,m);return t;};
    /* 한 번호는 한 날에만 센다 — 콘솔 보관함(내 컴퓨터 날짜)과 CMS 집계(승인 시각)의 날짜가 다르거나, 같은 리뷰가 다시 승인돼
       날짜가 바뀌어도 수입이 두 번 들어가지 않게. 이번에 들어온 목록은 CMS 집계가 앞, 보관함이 뒤라 먼저 온 날짜를 쓰고,
       예전 동기화가 다른 날에 둔 번호는 새 날짜로 옮긴다(옛 날이 이번 범위 밖이면 옮기지 않고 그대로 둔다). */
    for(const k of ['r','p']){
      const where={},placed=new Set();
      for(const m of Object.keys(out)){const a=out[m]&&out[m]._auto&&out[m]._auto[k];if(!a)continue;
        for(const dd of Object.keys(a))for(const x of (a[dd]||[]))(where[String(x)]=where[String(x)]||[]).push(m+'-'+dd);}
      const drop=(loc,id)=>{const pa=out[loc.slice(0,7)]._auto[k];pa[loc.slice(8)]=(pa[loc.slice(8)]||[]).filter(x=>String(x)!==id);};
      for(const [id0,d] of lists[k]){
        if(d<p.from||d>p.to)continue;
        const id=String(id0);
        if(placed.has(id))continue;
        placed.add(id);
        const locs=[...new Set(where[id]||[])];
        /* 이번 범위 밖 날에 이미 있으면 그 날(다시 세지 않는 날)을 두고, 범위 안 사본은 모두 지운다 */
        if(locs.some(x=>x<p.from||x>p.to)){locs.filter(x=>x>=p.from&&x<=p.to).forEach(x=>drop(x,id));continue;}
        locs.filter(x=>x!==d).forEach(x=>drop(x,id));
        const t=mon(d.slice(0,7));t._auto=t._auto||{r:{},p:{}};t._auto[k]=t._auto[k]||{};
        const day=t._auto[k][d.slice(8)]||(t._auto[k][d.slice(8)]=[]);
        if(day.indexOf(id)<0)day.push(id);
        where[id]=[d];
      }
    }
    const changes=[],touched=new Set();
    for(let d=p.from;d<=p.to;d=nextDay(d)){
      const mm=d.slice(0,7),dd=d.slice(8),t=mon(mm),day=t.days[dd],a=t._auto||{};
      const ar=((a.r||{})[dd]||[]).length,ap=((a.p||{})[dd]||[]).length;
      const r0=day.r||0,p0=day.p||0;
      /* 사람이 적어 둔 값이 CMS 와 다르면 남겨 두고 CMS 건수로 바로잡는다 */
      const typed=day.auto?(r0!==(day.auto.r||0)||p0!==(day.auto.p||0)):((r0||p0)&&(r0!==ar||p0!==ap));
      if(typed)day.manual={r:r0,p:p0};
      const nr=ar,np=ap;
      if(nr!==r0||np!==p0)changes.push({d,r:[r0,nr],p:[p0,np]});
      if(!day.auto||day.auto.r!==ar||day.auto.p!==ap||nr!==r0||np!==p0)touched.add(mm);
      day.r=nr;day.p=np;day.auto={r:ar,p:ap};
    }
    const last=mon(p.to.slice(0,7)).days[p.to.slice(8)];
    return {months:out,changes,touched:[...touched],today:{d:p.to,r:last.r,p:last.p}};
  }
  /* ── 짝수일별 남은 검수 (미등록 제품수 칸) ───────────────────
     콘솔이 CMS 검수 대기를 훑은 결과: { at, days:{ 'YYYY-MM-DD':{ n, reg, upd, blocked } } } — 리뷰 작성일 기준.
     이미 미노출된 리뷰는 콘솔이 세지 않는다(검수·등록할 필요가 없으므로).
     칸이 비었거나 숫자면 CMS 건수로 맞추고(0 이면 비움), 사람이 적은 메모("유민지", "이월" 등)는 그대로 둔다 — 건수는 day.pend 에 따로 둔다. */
  function isAutoUnreg(v){return !String(v==null?'':v).trim()||/^\d+$/.test(String(v).trim());}
  function applyRemain(out,remain){
    const touched=new Set();
    if(!remain||!remain.days)return [];
    const at=String(remain.at||'');
    for(const d of Object.keys(remain.days)){
      const x=remain.days[d];
      if(!date(d)||!x||!integer(x.n))continue;
      const mm=d.slice(0,7),dd=d.slice(8);
      if(!out[mm]){const prev=Object.keys(out).filter(k=>k<mm&&out[k]&&integer(out[k].target)).sort().pop();out[mm]=blankMonth(mm,prev?out[prev].target:1450000);const tc=prev?(out[prev]._t||out[prev]._tc||0):0;if(tc)out[mm]._tc=tc;}
      const t=out[mm];if(!t.days[dd])t.days[dd]={r:0,p:0,memo:'',unreg:''};
      const day=t.days[dd],pend={n:x.n,reg:x.reg|0,upd:x.upd|0,blocked:x.blocked|0,at};
      const want=x.n>0?String(x.n):'';
      const same=day.pend&&day.pend.n===pend.n&&day.pend.reg===pend.reg&&day.pend.upd===pend.upd&&day.pend.blocked===pend.blocked;
      day.pend=pend;
      if(isAutoUnreg(day.unreg)&&String(day.unreg||'').trim()!==want){day.unreg=want;touched.add(mm);}
      else if(!same)touched.add(mm);
    }
    return [...touched];
  }
  /* 브라우저에 저장된 업무일지 원문(JSON 문자열)에 자동 집계를 반영한다. 원문이 깨졌으면 손대지 않는다. */
  function syncStore(raw,work,base,now,remain){
    const store=raw?JSON.parse(raw):(base||{v:1,months:{},dirty:[]});
    if(!store||typeof store!=='object'||!store.months)throw Error('업무일지 저장 형식 오류');
    months(store.months);
    const res=applyWork(store.months,work);
    applyRemain(res.months,remain).forEach(m=>{if(res.touched.indexOf(m)<0)res.touched.push(m);});
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
  /* ── 작업 증빙 ─────────────────────────────────────────
     업무일지 숫자 뒤에 있는 실제 목록. 실제 작업일 월별 문서:
       { r:{ dd:{ 리뷰ID:[브랜드, 제품, 작성일, 출처] } }, p:{ dd:{ 제품ID:[브랜드, 제품명] } } }
     출처 c = 검수 콘솔로 처리, m = CMS 화면에서 직접 처리 */
  function evidenceFrom(work){
    const out={};
    const put=(k,d,id,info)=>{if(!date(d)||!/^\d+$/.test(String(id)))return;const doc=out[d.slice(0,7)]||(out[d.slice(0,7)]={r:{},p:{}});const day=doc[k][d.slice(8)]||(doc[k][d.slice(8)]={}),prev=day[String(id)];
      /* 같은 번호가 또 오면 빈 칸은 앞 정보를 남긴다(보관함 줄은 브랜드·제품이 비어 있다) */
      day[String(id)]=prev?info.map((v,i)=>v===''&&prev[i]?prev[i]:v):info;};
    for(const x of (work&&work.reviews)||[])if(Array.isArray(x)&&x.length>2)put('r',x[1],x[0],[String(x[2]||'').slice(0,60),String(x[3]||'').slice(0,80),date(x[4])?x[4]:'',x[5]==='c'?'c':'m']);
    for(const x of (work&&work.products)||[])if(Array.isArray(x)&&x.length>2)put('p',x[1],x[0],[String(x[2]||'').slice(0,60),String(x[3]||'').slice(0,80)]);
    return out;
  }
  /* 뒤(b)가 새 정보. 콘솔로 처리했다는 표시(c)는 어느 쪽이든 남긴다 */
  function mergeEvidence(a,b){
    const out={r:{},p:{}};
    for(const k of ['r','p'])for(const src of [a,b]){const s=(src&&src[k])||{};for(const dd of Object.keys(s)){const t=out[k][dd]||(out[k][dd]={});for(const id of Object.keys(s[dd]||{})){const prev=t[id],cur=s[dd][id];t[id]=(k==='r'&&prev&&prev[3]==='c'&&cur&&cur[3]!=='c')?cur.slice(0,3).concat(['c']):cur;}}}
    return out;
  }

  /* ── 여러 컴퓨터의 기록 합치기 ────────────────────────────
     회사·집 브라우저가 따로 쌓은 것을 서버에서 합친다. 어느 쪽 것도 지우지 않는다.
     - 업무일지: 자동 장부(_auto)는 합집합. 메모·직접 조정은 칸마다 나중에 고친 쪽(_t) */
  function unionIds(a,b){return [...new Set([...(a||[]),...(b||[])].map(String))];}
  /* 여러 달을 함께 보며 한 번호는 가장 나중 날짜 한 곳에만 — 달을 넘는 재승인·자정 전후 날짜 차이로 두 달에 남은 사본을 정리하고
     자동 집계 날의 건수를 다시 센다 */
  function oneDayPerId(ms){
    const keys=Object.keys(ms).filter(m=>ms[m]&&ms[m]._auto).sort();
    for(const k of ['r','p']){
      const last={};
      for(const m of keys){const a=ms[m]._auto[k]||{};for(const dd of Object.keys(a).sort())for(const x of (a[dd]||[]))last[String(x)]=m+'-'+dd;}
      for(const m of keys){const a=ms[m]._auto[k]||{};for(const dd of Object.keys(a))a[dd]=(a[dd]||[]).filter(x=>last[String(x)]===m+'-'+dd);}
    }
    for(const m of keys){const t=ms[m],a=t._auto;
      for(const dd of Object.keys(t.days||{})){const d=t.days[dd];if(!d||!d.auto)continue;
        const ar=((a.r||{})[dd]||[]).length,ap=((a.p||{})[dd]||[]).length;d.r=ar;d.p=ap;d.auto={r:ar,p:ap};}}
    return ms;
  }
  function mergeMonth(local,remote){
    if(!remote)return JSON.parse(JSON.stringify(local));
    if(!local)return JSON.parse(JSON.stringify(remote));
    const out=JSON.parse(JSON.stringify(local));
    const la=local._auto||{},ra=remote._auto||{},led={r:{},p:{}};
    for(const k of ['r','p']){const A=la[k]||{},B=ra[k]||{};for(const dd of new Set([...Object.keys(A),...Object.keys(B)]))led[k][dd]=unionIds(A[dd],B[dd]);
      /* 합친 뒤에도 한 번호는 한 날에만 — 다른 기기에 옛 날짜로 남은 사본이 되살아나 두 번 세지 않게(나중 날짜를 남긴다) */
      const last={};for(const dd of Object.keys(led[k]).sort())for(const x of led[k][dd])last[String(x)]=dd;
      for(const dd of Object.keys(led[k]))led[k][dd]=led[k][dd].filter(x=>last[String(x)]===dd);}
    if(Object.keys(led.r).length||Object.keys(led.p).length)out._auto=led;
    /* 목표: 사람이 정한 시각(_t, 이어받은 것은 원래 정한 시각 _tc)이 나중인 쪽. 둘 다 시각이 없으면 낮은 쪽(넘지 않는 쪽) */
    const tl=local._t||local._tc||0,tr=remote._t||remote._tc||0;
    if(remote.target!=null&&tr>tl){out.target=remote.target;if(remote._t)out._t=remote._t;else delete out._t;if(remote._tc)out._tc=remote._tc;else delete out._tc;}
    else if(!tl&&!tr&&integer(remote.target)&&integer(local.target)&&remote.target<local.target)out.target=remote.target;
    {const a=(local._countedAt&&typeof local._countedAt==='object')?local._countedAt:{},b=(remote._countedAt&&typeof remote._countedAt==='object')?remote._countedAt:{},c=Object.assign({},a);
      for(const k of Object.keys(b))if(String(b[k]||'')>String(c[k]||''))c[k]=b[k];if(Object.keys(c).length)out._countedAt=c;}
    out.days=out.days||{};
    for(const dd of new Set([...Object.keys(local.days||{}),...Object.keys(remote.days||{})])){
      const L=(local.days||{})[dd],R=(remote.days||{})[dd];
      const win=!L?R:!R?L:((R._t||0)>(L._t||0)?R:L), other=win===L?R:L;
      const d=JSON.parse(JSON.stringify(win));
      if(other){if(!d.memo&&other.memo)d.memo=other.memo;if(!d.unreg&&other.unreg)d.unreg=other.unreg;if(!d.manual&&other.manual)d.manual=other.manual;}
      /* 남은 검수 건수: 더 최근에 CMS 를 훑은 쪽. 칸이 숫자(자동)면 그 건수로, 메모면 메모 그대로 */
      const pL=L&&L.pend,pR=R&&R.pend;
      if(pL||pR){const P=!pL?pR:!pR?pL:(String(pR.at||'')>String(pL.at||'')?pR:pL);d.pend=P;if(isAutoUnreg(d.unreg))d.unreg=P.n>0?String(P.n):'';}
      /* 숫자: 자동 집계 날은 합친 장부 건수(CMS 기준) 그대로 */
      if(win.auto||(other&&other.auto)){
        const ar=((led.r||{})[dd]||[]).length,ap=((led.p||{})[dd]||[]).length;
        /* 칸에 CMS 와 다른 숫자가 적혀 있었으면 무엇을 바로잡았는지 남긴다 */
        const src=win.auto?win:other;
        if((src.r||0)!==(src.auto.r||0)||(src.p||0)!==(src.auto.p||0))d.manual={r:src.r||0,p:src.p||0};
        d.r=ar;d.p=ap;d.auto={r:ar,p:ap};
      }
      out.days[dd]=d;
    }
    delete out._u;delete out._remote;
    return out;
  }
  function mergeAlias(a,b){const out=Object.assign({},a||{});for(const k of Object.keys(b||{})){const v=b[k],p=out[k];if(!v)continue;if(!p||(v.n||1)>(p.n||1)||((v.n||1)===(p.n||1)&&String(v.t||'')>String(p.t||'')))out[k]=v;}return out;}
  function mergeByTime(a,b,field){const f=field||'at',out=Object.assign({},a||{});for(const k of Object.keys(b||{})){const v=b[k],p=out[k];if(!v)continue;if(!p||String(v[f]||'')>=String(p[f]||''))out[k]=v;}return out;}
  /* 전송 기록: 리뷰마다 나중 기록, 수정요청 횟수는 큰 쪽 — 다른 컴퓨터에서 보낸 것도 다시 보내지 않게 */
  function mergeSent(a,b){const out=Object.assign({},a||{});for(const k of Object.keys(b||{})){const v=b[k],p=out[k];if(!v)continue;if(!p){out[k]=v;continue;}const later=String(v.at||'')>String(p.at||'')?v:p,rn=Math.max(p.rn||0,v.rn||0);out[k]=Object.assign({},later);if(rn)out[k].rn=rn;if(!out[k].u&&(p.u||v.u))out[k].u=p.u||v.u;}return out;}
  /* 본문 지문: 먼저 올라온 리뷰를 원본으로 */
  function mergeTexts(a,b,cap){const out=Object.assign({},a||{});for(const k of Object.keys(b||{})){const v=b[k],p=out[k];if(!v)continue;if(!p){out[k]=v;continue;}const orig=String(v.d||'')<String(p.d||'')?v:p;out[k]=Object.assign({},orig,{t:String(v.t||'')>String(p.t||'')?v.t:p.t});}const ks=Object.keys(out),c=cap||8000;if(ks.length>c)ks.sort((x,y)=>String(out[x].t||'')<String(out[y].t||'')?-1:1).slice(0,ks.length-c).forEach(k=>{delete out[k];});return out;}
  function mergeGate(a,b){const m=new Map();for(const x of [...(a||[]),...(b||[])])if(x&&x.t)m.set(x.t+'|'+(x.d||''),x);return [...m.values()].sort((x,y)=>x.t<y.t?-1:1).slice(-200);}
  function mergeConsole(a,b){a=a||{};b=b||{};return {alias:mergeAlias(a.alias,b.alias),gate:mergeGate(a.gate,b.gate),done:mergeByTime(a.done,b.done),pending:mergeByTime(a.pending,b.pending,'u'),texts:mergeTexts(a.texts,b.texts),sent:mergeSent(a.sent,b.sent),hidefp:mergeByTime(a.hidefp,b.hidefp)};}
  /* 검수 예외(리뷰 대상 아님·보류·해외직구 등): 리뷰마다 나중에 고친 쪽.
     '무시'(ign·ignAt·ignBy)는 따로 시각(ignUpd)을 두고 그 시각이 나중인 쪽을 따른다 —
     오래 열어 둔 화면에서 상태를 고치거나 무시를 눌러도 다른 기기에서 한 무시·상태 변경을 덮지 않게 */
  const IGN_FIELDS=['ign','ignAt','ignBy','ignUpd'];
  function mergeExceptions(a,b){a=a||{};b=b||{};const ai=a.items||{},bi=b.items||{},items=mergeByTime(ai,bi);
    for(const k of Object.keys(items)){const x=ai[k],y=bi[k];if(!x||!y||(!x.ignUpd&&!y.ignUpd))continue;
      const src=String(y.ignUpd||'')>=String(x.ignUpd||'')?y:x,out=Object.assign({},items[k]);
      for(const f of IGN_FIELDS){if(src[f]===undefined)delete out[f];else out[f]=src[f];}
      items[k]=out;}
    return {v:1,items};}
  function monthsBack(now,n){const out=[],y=now.getFullYear(),m=now.getMonth();for(let i=0;i<n;i++){const d=new Date(y,m-i,1);out.push(d.getFullYear()+'-'+pad2(d.getMonth()+1));}return out;}

  /* ── 서버와 한 번에 주고받기 ──────────────────────────────
     io.pull(keys) → [{month,data,updated_at}], io.push(rows) — 실제 서버(Supabase)는 동기화 창이 넣어 준다.
     서버 행 이름(month 칸): 'YYYY-MM' 업무일지 · '~ev:YYYY-MM' 작업 증빙 · '~audit:YYYY-MM-DD' 판정 기록
                           '~pending' 남은 일 · '~learn' 배운 것 · '~texts' 본문 지문 · '~sent:YYYY-MM' 전송 기록 */
  async function cloudSync(io,st){
    const now=st.now||new Date().toISOString();
    const keys=new Set();
    (st.touchedMonths||[]).forEach(m=>keys.add(m));
    (st.touchedEv||[]).forEach(m=>keys.add('~ev:'+m));
    Object.keys(st.audit||{}).forEach(d=>keys.add('~audit:'+d));
    const sentMonths=st.sentMonths||[];
    if(st.console){keys.add('~learn');keys.add('~texts');sentMonths.forEach(m=>keys.add('~sent:'+m));}
    const remote={};
    for(const r of (keys.size?await io.pull([...keys]):[])||[])if(r&&r.month)remote[r.month]=r;
    const rd=k=>remote[k]&&remote[k].data;
    const out={months:{},evidence:{},audit:{},console:null},push=[];
    for(const m of st.touchedMonths||[]){const merged=mergeMonth(st.months[m],rd(m));months({[m]:merged});out.months[m]=merged;}
    oneDayPerId(out.months);
    for(const m of st.touchedMonths||[])push.push({month:m,data:out.months[m]});
    for(const m of st.touchedEv||[]){const merged=mergeEvidence(rd('~ev:'+m),st.evidence[m]);out.evidence[m]=merged;push.push({month:'~ev:'+m,data:merged});}
    for(const d of Object.keys(st.audit||{})){const r=rd('~audit:'+d);const merged=(r&&Array.isArray(r.items))?mergeAudit(r,Object.assign({},st.audit[d],{date:d})):st.audit[d];out.audit[d]=merged;push.push({month:'~audit:'+d,data:merged});}
    if(Array.isArray(st.pending))push.push({month:'~pending',data:{at:now,items:st.pending.slice(0,500),backlog:Array.isArray(st.backlog)?st.backlog.slice(0,3000):null}});
    if(st.console){
      const L=rd('~learn')||{},sentR={};
      sentMonths.forEach(m=>Object.assign(sentR,rd('~sent:'+m)||{}));
      const merged=mergeConsole({alias:L.alias,gate:L.gate,done:L.done,pending:L.pending,hidefp:L.hidefp,texts:rd('~texts')||{},sent:sentR},st.console);
      out.console=merged;
      push.push({month:'~learn',data:{alias:merged.alias,gate:merged.gate,done:merged.done,pending:merged.pending,hidefp:merged.hidefp}});
      push.push({month:'~texts',data:merged.texts});
      const byMonth={};
      for(const k of Object.keys(merged.sent)){const at=String(merged.sent[k].at||'');const m=/^\d{4}-\d{2}/.test(at)?at.slice(0,7):null;if(m&&sentMonths.indexOf(m)>=0)(byMonth[m]||(byMonth[m]={}))[k]=merged.sent[k];}
      Object.keys(byMonth).forEach(m=>push.push({month:'~sent:'+m,data:byMonth[m]}));
    }
    if(push.length)await io.push(push.map(x=>Object.assign({updated_at:now},x)));
    out.pushed=push.map(x=>x.month);
    return out;
  }
  /* ── 동기화 창(sync.html) 한 번의 일 ──────────────────────
     store: 브라우저 저장소(getItem/setItem), io: 서버(로그인 안 했으면 없음), opts.uid: 로그인한 계정
     1) 이 브라우저의 업무일지·작업 증빙·검수기록·남은 일에 반영
     2) 로그인했으면 서버와 합치고, 합친 결과를 이 브라우저에도 되돌려 쓴다
     3) 합쳐진 콘솔 경험(배운 연결·전송 기록 등)을 콘솔에 돌려준다 */
  const EV_KEY='unpa-evidence-v1',AUDIT_KEY='unpa-audit-v1',PENDING_KEY='unpa-pending-v1';
  function readJSON(store,k,fb){try{const v=store.getItem(k);return v?JSON.parse(v):fb;}catch(e){return fb;}}
  function writeAudit(store,obj){
    /* 저장공간이 모자라면 오래된 날부터 덜어 가며 다시 쓴다 */
    for(const keep of [60,40,25,12]){try{const ds=Object.keys(obj.days||{}).sort();ds.slice(0,Math.max(0,ds.length-keep)).forEach(d=>{delete obj.days[d];});store.setItem(AUDIT_KEY,JSON.stringify(obj));return null;}catch(e){var err=String(e&&e.message||e);}}
    return err||'저장 실패';
  }
  /* CMS 에 아직 남은 리뷰마다 예전 스캔에서 내린 판정 — 새 콘솔이 스캔하기 전에도 무엇이 상품등록인지 알 수 있게 */
  function latestVerdicts(audit){
    const out={};
    Object.keys((audit&&audit.days)||{}).sort().forEach(d=>{((audit.days[d]||{}).items||[]).forEach(it=>{if(it&&it.id!=null)out[String(it.id)]=Object.assign({d},it);});});
    return out;
  }
  function verdictsFor(audit,backlog){
    if(!Array.isArray(backlog))return null;
    const all=latestVerdicts(audit),out={};
    backlog.forEach(b=>{const v=all[String(b.id)];if(v)out[String(b.id)]={action:v.action||null,verdict:v.verdict||null,brand:v.brand||'',product:v.product||'',
      reason:String(v.reason||'').slice(0,90),d:v.d,applied:!!v.applied,manual_done:v.manual_done||null};});
    return out;
  }
  const LEASE_MS=60*60e3,SKEW_MS=5*60e3,CLOCK_MS=60e3,GOAL_PROTOCOL=6;   /* 콘솔이 지금 스냅샷 키(v6)를 쓰는 판일 때만 쓸 수 있는 목표를 준다 */
  const validDevice=d=>typeof d==='string'&&/^[0-9a-z]{6,32}$/.test(d);
  /* 이번 달 작업 권한 — 서버 행 하나를 '바뀌지 않았으면 쓰기'(nonce 비교)로만 바꿔 두 기기가 동시에 가질 수 없게.
     모든 기기 시계가 서버 시각과 1분 안이어야 한다(넘겨받기 기준 5분 여유를 믿을 수 있게) */
  /* 이번 달 작업 권한 — 업무일지 사용자마다 한 행('~lease'). 자동으로는 넘어가지 않는다:
     · 권한을 가진 기기가 '작업 권한 넘기기'(release)로 동기화해 닫아 둔 뒤, 같은 CMS 계정의 다른 기기가 그 뒤(5분 여유) 시작한
       완전한 집계로 동기화할 때만 넘어간다 — 닫는 동기화가 그 기기의 승인을 모두 업무일지에 넣은 뒤라서 안전하다.
       닫을 때 업무일지 이번 달 금액을 적어 두고, 넘겨받는 쪽 합계가 그보다 적으면(서버 기록이 덮여 빠짐) 넘기지 않는다.
     · 다른 CMS 계정에는 이번 달 안에는 넘기지 않는다(그 계정 집계로는 앞 기기 승인을 확인할 수 없다).
     · 앞 권한이 지난달에 끝났으면(이번 달 시작 5분 전까지) 누구든 새로 받는다. */
  const kstMonthStart=t=>{const d=new Date(t+9*3600e3);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-9*3600e3;};
  const kstMonthOf=t=>new Date(t+9*3600e3).toISOString().slice(0,7);
  const kstNextMonthStart=t=>kstMonthStart(kstMonthStart(t)+32*864e5);
  const idList=a=>Array.isArray(a)?[...new Set(a.map(String).filter(x=>/^\d{1,12}$/.test(x)))].slice(0,3000):[];
  /* 이번 달 정지 표시(가드 원장의 '!halt') — 정해진 칸의 숫자·문자만 옮긴다. 둘이면 나중에 멈춘 쪽 */
  const haltOf=h=>{
    const num=x=>typeof x==='number'&&isFinite(x);
    if(!h||typeof h!=='object'||Array.isArray(h)||!num(h.v)||typeof h.month!=='string'||!/^\d{4}-\d\d$/.test(h.month)||!num(h.target)||!num(h.t))return null;
    const o={v:h.v,month:h.month,target:h.target,t:h.t};if(num(h.won))o.won=h.won;return o;
  };
  const laterHalt=(a,b)=>{a=haltOf(a);b=haltOf(b);return !a?b:!b?a:(b.t>a.t?b:a);};
  async function claimLease(io,p,now,sk,curWon){
    const dev=validDevice(p.device)?p.device:null,acct=typeof p.acct==='string'&&/^[0-9a-z]{1,16}$/.test(p.acct)?p.acct:null;
    const cAt=Date.parse(p.countedAt)||0,t=now.getTime();
    if(!dev||!acct)return {ok:false,why:'device'};
    if(typeof io.claim!=='function')return {ok:false,why:'cloud'};
    if(typeof sk!=='number'||!isFinite(sk)||Math.abs(sk)>CLOCK_MS)return {ok:false,why:'clock',skew:typeof sk==='number'&&isFinite(sk)?Math.round(sk/1000):null};
    if(p.monthPartial||(p.work&&p.work.partial)||!cAt)return {ok:false,why:'partial'};
    const K='~lease';
    const read=async()=>{const rows=await io.pull([K]);const row=(rows||[]).find(x=>x&&x.month===K);return row&&row.data||null;};
    const cur=await read();
    const nonce=()=>Math.random().toString(36).slice(2,12)+t.toString(36);
    const mine=!!(cur&&cur.device===dev&&cur.acct===acct);
    /* 조회만 하는 동기화([업데이트])는 이 기기가 이미 가진 권한을 이어 갈 뿐, 빈 권한도 남의 권한도 받지 않는다 */
    if(p.view&&!mine)return {ok:false,why:'view',closed:!!(cur&&cur.closed)};
    if(!cur){
      /* 이전 판의 계정별 권한 행이 다른 기기에 아직 살아 있으면 새 권한을 내주지 않는다 */
      let olds=[];
      if(typeof io.list==='function')olds=await io.list('~lease:');
      else{const rows=await io.pull(['~lease:'+acct]);olds=rows||[];}
      for(const r of olds){const o=r&&r.data;if(o&&o.device!==dev&&(Date.parse(o.until)||0)+SKEW_MS>t)return {ok:false,why:'other',closed:false};}
    }
    const ep=typeof p.leaseEpoch==='number'&&isFinite(p.leaseEpoch)?p.leaseEpoch:null;
    if(mine&&p.release){
      if(cur.closed)return {ok:false,why:'released'};                       /* 이미 넘겨 둠 — 다시 쓰지 않는다(넘겨받는 쪽 기준 시각이 밀리지 않게) */
      /* 넘긴다 — 닫고, 이 기기 원장에 남은(업무일지에 아직 없는·결과가 애매한) 승인 번호를 넘겨받는 쪽이 세도록 함께 적는다.
         넘길 때의 순번(closedEpoch)과 이 달 정지 표시(closedHalt — 넘겨받는 쪽도 멈춘 채로)도 함께 */
      const next=Object.assign({},cur,{closed:true,closedAt:now.toISOString(),closedMonth:kstMonthOf(t),closedWon:typeof curWon==='number'?curWon:null,
                                       closedPendR:idList([...idList(cur.pendR),...idList(p.pendR)]),closedEpoch:ep,closedHalt:laterHalt(p.halt,cur.halt),
                                       until:now.toISOString(),nonce:nonce()});
      const ok=await io.claim(K,{nonce:cur.nonce==null?null:cur.nonce},next);
      return {ok:false,why:ok?'released':'other'};
    }
    /* 넘겨 둔 기기: 넘기기를 누르기 전에 만든 동기화(순번이 넘길 때보다 크지 않음)가 늦게 닿아도 권한을 다시 열지 않는다 — [다시 가져오기]가 순번을 올린다 */
    if(mine&&cur.closed&&typeof cur.closedEpoch==='number'&&!(ep!==null&&ep>cur.closedEpoch))return {ok:false,why:'released'};
    /* pendR = 넘겨받은 번호(넘겨받은 쪽 가드가 센다), pendFrom = 그 번호가 모두 승인됐을 수 있는 마지막 시각(+5분) — 그 뒤 시작한 집계만 번호를 뺄 수 있다 */
    let pendR=mine?idList(cur.pendR):[],pendFrom=mine&&typeof cur.pendFrom==='string'?cur.pendFrom:null,halt=mine?haltOf(cur.halt):null;
    if(cur&&!mine){
      /* 지난달 권한: 이번 달 시작 5분 전까지 끝났거나, 지난달에 닫혔다(닫을 때 금액은 지난달 것이라 이번 달과 비교하지 않는다) */
      const prevMonth=(Date.parse(cur.until)||0)+SKEW_MS<=kstMonthStart(t)||!!(cur.closed&&cur.closedMonth&&cur.closedMonth<kstMonthOf(t));
      if(!prevMonth){
        if(cur.acct!==acct)return {ok:false,why:'account'};
        if(!cur.closed){
          /* 기기 번호를 잃은 경우의 복구(사람이 확인하고 누름): 권한이 이미 끝났고, 그 뒤 5분 넘어 시작해 그 기기가 승인할 수 있었던
             리뷰(작성 70일 안)를 다 덮는 집계이며, 업무일지 합계가 그 기기의 마지막 갱신 때보다 적지 않을 때만 */
          const cu=Date.parse(cur.until)||0,from=String(p.countFrom||'');
          const need=new Date(cu+9*3600e3-71*864e5).toISOString().slice(0,10);
          const forceOk=p.force&&cu<t&&cu+SKEW_MS<=cAt&&/^\d{4}-\d\d-\d\d$/.test(from)&&from<=need
                        &&!(typeof cur.renewWon==='number'&&!(typeof curWon==='number'&&curWon>=cur.renewWon));
          if(!forceOk)return {ok:false,why:'other',closed:false,until:cur.until,need};
          /* 그 기기가 넘겨받았던 번호·넘겼던 번호·마지막 동기화 때 그 기기 원장에만 있던(결과 애매·업무일지에 아직 없는) 번호를 모두 이어서 센다 */
          pendR=idList([...idList(cur.pendR),...idList(cur.closedPendR),...idList(cur.ownPendR)]);
          pendFrom=new Date(cu+SKEW_MS).toISOString();
        }else{
          const ca=Date.parse(cur.closedAt)||0;
          if(ca+SKEW_MS>cAt)return {ok:false,why:'other',closed:true,after:new Date(ca+SKEW_MS).toISOString()};
          if(typeof cur.closedWon==='number'&&!(typeof curWon==='number'&&curWon>=cur.closedWon))return {ok:false,why:'behind'};
          pendR=idList(cur.closedPendR);                                     /* 넘긴 기기에 남아 있던 승인 — 넘겨받은 쪽 가드가 센다 */
          pendFrom=new Date(ca+SKEW_MS).toISOString();
        }
        halt=laterHalt(cur.closedHalt,cur.halt);                             /* 넘긴 기기가 이번 달을 멈췄으면 넘겨받은 쪽도 멈춘 채로 */
      }
    }
    if(p.release)return {ok:false,why:'released'};                         /* 넘겨 둔 기기 — 다시 가져오기 전까지는 받지 않는다 */
    /* 넘겨받은 번호 중 이 기기 집계가 '내 승인 아님'으로 본 것(dropR)은 승인된 적이 없다 — 넘겨받은 뒤(pendFrom) 시작한 집계일 때만 뺀다 */
    if(mine&&Array.isArray(p.dropR)&&pendR.length){
      const from=Date.parse(pendFrom||cur.since||'');
      if(isFinite(from)&&cAt>=from){const drop=new Set(idList(p.dropR));pendR=pendR.filter(id=>!drop.has(id));}
    }
    /* 권한은 달을 넘기지 않는다 — 이번 달 끝 5분 전까지만(다음 달엔 저절로 풀리게). renewWon = 이번 갱신 때 업무일지 이번 달 금액.
       ownPendR = 이 기기 원장에만 있는 승인 번호(이 기기가 보낸 목록으로 바꾼다 — 번호를 잃은 이 기기를 넘겨받는 쪽이 센다), halt = 이번 달 정지 표시 */
    const next={device:dev,acct,since:mine&&cur.since?cur.since:now.toISOString(),until:new Date(Math.min(t+LEASE_MS,kstNextMonthStart(t)-SKEW_MS)).toISOString(),
                nonce:nonce(),closed:false,renewWon:typeof curWon==='number'?curWon:null,pendR,pendFrom,
                ownPendR:Array.isArray(p.ownPendR)?idList(p.ownPendR):(mine?idList(cur.ownPendR):[]),halt:laterHalt(halt,p.halt),month:kstMonthOf(t)};
    if(cur&&mine&&cur.month&&cur.month!==next.month){next.pendR=[];next.pendFrom=null;}
    if(await io.claim(K,cur?{nonce:cur.nonce==null?null:cur.nonce}:null,next))return {ok:true,until:next.until,pendR:next.pendR,halt:next.halt};
    /* 못 썼다 — 같은 기기의 다른 동기화가 방금 이어 간 것이면 그대로 내 권한 */
    const back=await read();
    if(back&&back.device===dev&&back.acct===acct&&!back.closed&&(Date.parse(back.until)||0)>t)return {ok:true,until:back.until,pendR:idList(back.pendR),halt:haltOf(back.halt)};
    return {ok:false,why:'other',closed:!!(back&&back.closed)};
  }
  async function syncWindow(store,p,io,opts){
    opts=opts||{};
    if(!p||p.v!==1||!p.work)throw Error('받은 자료 형식 오류');
    const now=opts.now||new Date(),iso=now.toISOString(),uid=opts.uid||null;
    const key=uid?'unpa-worklog-v2:'+uid:(store.getItem('unpa-worklog-active')||'unpa-worklog-v1');
    let base=null;
    if(!store.getItem(key)){
      /* 로그인한 계정 저장소가 처음이면 이 브라우저에 쌓아 온 기록을 그대로 옮겨 온다 (파일 내보내기·가져오기 없이) */
      const old=uid?readJSON(store,'unpa-worklog-v1',null):null;
      if(old&&old.months){months(old.months);base={v:1,months:old.months,dirty:Object.keys(old.months)};}
      else if(opts.base)base=opts.base;
    }
    const res=syncStore(store.getItem(key),p.work,base,now,p.remain);
    store.setItem(key,res.value);
    /* 이 기록이 담고 있는 가장 최근 CMS 집계 시각(달마다·CMS 계정마다 — 계정은 해시로만) — 다른 기기 집계까지 합친 수입과
       가드의 '집계 뒤' 기준을 맞춘다. 일부 실패한 집계는 안 쓴다 */
    const acct=typeof p.acct==='string'&&/^[0-9a-z]{1,16}$/.test(p.acct)?p.acct:null;
    /* 서버 시각과의 차 — 시계가 1분 안인 기기의 집계 시각만 다른 기기와 나누는 기준으로 쓴다 */
    let sk=null;if(io&&uid&&typeof io.skew==='function')try{sk=await io.skew();}catch(e){sk=null;}
    const clockOk=typeof sk==='number'&&isFinite(sk)&&Math.abs(sk)<=CLOCK_MS;
    if(clockOk&&acct&&p.countedAt&&!p.monthPartial&&!p.work.partial&&!isNaN(Date.parse(p.countedAt))){
      const v=JSON.parse(store.getItem(key));
      for(let m=p.work.from.slice(0,7);m<=p.work.to.slice(0,7);){const t=v.months[m];
        if(t){const c=(t._countedAt&&typeof t._countedAt==='object')?t._countedAt:{};if(String(c[acct]||'')<p.countedAt)c[acct]=p.countedAt;t._countedAt=c;}
        const y=+m.slice(0,4),mo=+m.slice(5,7);m=(mo===12?(y+1)+'-01':y+'-'+pad2(mo+1));}
      store.setItem(key,JSON.stringify(v));
    }
    if(uid)store.setItem('unpa-worklog-active',key);
    const ev=readJSON(store,EV_KEY,null)||{v:1,months:{}};ev.months=ev.months||{};
    const fresh=evidenceFrom(p.work);
    Object.keys(fresh).forEach(m=>{ev.months[m]=mergeEvidence(ev.months[m],fresh[m]);});
    const audit=readJSON(store,AUDIT_KEY,null)||{v:1,days:{}};audit.days=audit.days||{};
    let auditDays=0;
    Object.keys(p.audit||{}).forEach(d=>{const day=p.audit[d];if(!date(d)||!day||!Array.isArray(day.items))return;audit.days[d]=mergeAudit(audit.days[d],Object.assign({},day,{date:d}));auditDays++;});
    if(Array.isArray(p.pending))store.setItem(PENDING_KEY,JSON.stringify({at:iso,items:p.pending,backlog:Array.isArray(p.backlog)?p.backlog:null}));
    let cloud='off',consoleOut=null,lease=null;
    if(io&&uid){
      try{
        const snap=JSON.parse(store.getItem(key));
        /* 자동 집계 기간의 달은 바뀐 게 없어도 서버와 합친다 — 다른 컴퓨터가 한 일을 받아 오려면 */
        const range=[];for(let m=p.work.from.slice(0,7);m<=p.work.to.slice(0,7);){range.push(m);const y=+m.slice(0,4),mo=+m.slice(5,7);m=(mo===12?(y+1)+'-01':y+'-'+pad2(mo+1));}
        const touchedMonths=[...new Set([...(snap.dirty||[]),...res.touched,...range])].filter(m=>snap.months[m]);
        const days={};Object.keys(p.audit||{}).forEach(d=>{if(audit.days[d])days[d]=audit.days[d];});
        const out=await cloudSync(io,{now:iso,months:snap.months,touchedMonths,evidence:ev.months,touchedEv:[...new Set([...Object.keys(fresh),...range])],
          audit:days,pending:Array.isArray(p.pending)?p.pending:null,backlog:Array.isArray(p.backlog)?p.backlog:null,console:p.console||null,sentMonths:monthsBack(now,5)});
        /* 서버와 주고받는 사이에 업무일지 탭에서 고친 것이 있어도 잃지 않도록 한 번 더 합쳐서 쓴다 */
        const cur=JSON.parse(store.getItem(key));
        touchedMonths.forEach(m=>{cur.months[m]=Object.assign(mergeMonth(cur.months[m],out.months[m]),{_u:iso,_remote:iso});});
        const sub={};touchedMonths.forEach(m=>{sub[m]=cur.months[m];});oneDayPerId(sub);
        cur.dirty=(cur.dirty||[]).filter(m=>touchedMonths.indexOf(m)<0);
        /* 이어받은 목표를 합친 뒤에 다시 따진다 — 오래 동기화 안 한 기기가 합치기 전에 옛 목표로 새 달을 만들었을 수 있다.
           스스로 정한 목표(_t)가 없는 달은 바로 앞 달이 더 나중에 정해졌으면 그 목표를 이어받고, 다음 동기화 때 서버에 보낸다 */
        {const ms=Object.keys(cur.months).sort();
          for(let i=1;i<ms.length;i++){const tm=cur.months[ms[i]],pv=cur.months[ms[i-1]];if(!tm||!pv||tm._t||!integer(pv.target))continue;
            const pt=pv._t||pv._tc||0;if(pt>(tm._tc||0)&&pv.target!==tm.target||pt>(tm._tc||0)){tm.target=pv.target;tm._tc=pt;if(cur.dirty.indexOf(ms[i])<0)cur.dirty.push(ms[i]);}}}
        store.setItem(key,JSON.stringify(cur));
        Object.keys(out.evidence).forEach(m=>{ev.months[m]=out.evidence[m];});
        Object.keys(out.audit).forEach(d=>{audit.days[d]=out.audit[d];});
        consoleOut=out.console;cloud='on';
      }catch(e){cloud='error: '+String(e&&e.message||e).slice(0,100);}
      /* 이번 달 작업 권한(승인·제품 등록) — CMS 계정마다 한 기기만. 다른 기기가 최근 한 승인은 그 기기가 동기화하기 전엔 안 보이므로,
         권한을 넘겨받으려면 앞 기기의 권한이 끝난 뒤(시계 차 5분 여유) 시작한 CMS 집계가 있어야 한다 */
      if(cloud==='on')try{
        const mk0=p.work.to.slice(0,7),mm=(JSON.parse(store.getItem(key))||{}).months||{},md0=mm[mk0];
        let won0=null;if(md0){let r=0,q=0;Object.values(md0.days||{}).forEach(d=>{r+=d.r||0;q+=d.p||0;});won0=r*500+q*600;}
        lease=await claimLease(io,p,now,sk,won0);
      }catch(e){lease={ok:false,why:'cloud'};}
      else lease={ok:false,why:'cloud'};
    }else if(String(store.getItem('unpa-worklog-active')||'').indexOf('unpa-worklog-v2:')===0){
      lease={ok:false,why:'cloud'};                                            /* 로그인한 브라우저인데 서버에 못 닿음 — 한 기기로 보지 않는다 */
    }
    /* 작업 증빙은 이 브라우저에 최근 4개월만 (서버에는 전부) */
    const evKeys=Object.keys(ev.months).sort();evKeys.slice(0,Math.max(0,evKeys.length-4)).forEach(k=>{delete ev.months[k];});
    let evError=null;try{store.setItem(EV_KEY,JSON.stringify(ev));}catch(e){evError=String(e&&e.message||e);}
    const auditError=auditDays||cloud==='on'?writeAudit(store,audit):null;
    /* 남은 검수(미등록 제품수 칸) 요약 — 업무일지 화면이 업데이트 결과로 보여 준다 */
    let remain=null;
    if(p.remain&&p.remain.days){const days={};let n=0;Object.keys(p.remain.days).forEach(d=>{const x=p.remain.days[d];if(date(d)&&x&&integer(x.n)&&x.n>0){days[d]=x.n;n+=x.n;}});remain={n,days,at:String(p.remain.at||iso)};}
    const info={at:iso,from:p.work.from,today:res.today,partial:!!p.work.partial,changes:res.changes.slice(0,60),nChanges:res.changes.length,
                auditDays,auditError,evError,cloud,remain};
    try{store.setItem('unpa-worklog-sync-v1',JSON.stringify(info));}catch(e){}
    /* 이번 달 목표·수입 — 콘솔이 목표 금액 안에서만 승인하도록 (단가는 업무일지와 같게 리뷰 500 · 제품 600) */
    let goal=null;
    try{const fin=JSON.parse(store.getItem(key)),mk=p.work.to.slice(0,7),md=fin&&fin.months&&fin.months[mk];
      if(md&&integer(md.target)){let r=0,pp=0;Object.values(md.days||{}).forEach(d=>{r+=d.r||0;pp+=d.p||0;});
        /* 이번 달 수입에 이미 들어간 리뷰·제품 번호 — 목표 가드가 "아직 안 센 승인"만 더하도록 번호로 대조한다 */
        const ids=k=>{const a=(md._auto&&md._auto[k])||{},out=new Set();Object.values(a).forEach(l=>(l||[]).forEach(x=>out.add(String(x))));return [...out];};
        const ca=(md._countedAt&&typeof md._countedAt==='object'&&typeof p.acct==='string')?md._countedAt[p.acct]:null;
        goal={month:mk,target:md.target,r,p:pp,won:r*500+pp*600,ids:{r:ids('r'),p:ids('p')},countedAt:ca||null,lease};
        /* 기기 번호가 없는 예전 콘솔: 어떤 버전 가드도 쓰지 못하게 남은 금액 0·번호 목록 없음으로 넘긴다 */
        if(!validDevice(p.device)||p.gk!==GOAL_PROTOCOL)goal={month:mk,target:md.target,r,p:pp,won:md.target,countedAt:null,partial:true,lease:{ok:false,why:'device'}};}}catch(e){}
    return {ok:true,today:res.today,changes:res.changes.slice(0,20),nChanges:res.changes.length,auditDays,auditError,cloud,console:consoleOut,remain,
            verdicts:verdictsFor(audit,p.backlog),goal};
  }
  return {date,months,mergeAudit,unappliedIds,applyWork,applyRemain,isAutoUnreg,syncStore,syncAudit,syncWindow,latestVerdicts,verdictsFor,
          evidenceFrom,mergeEvidence,mergeMonth,mergeAlias,mergeSent,mergeTexts,mergeGate,mergeConsole,mergeByTime,mergeExceptions,EXC_IGN:1,monthsBack,cloudSync};
});
