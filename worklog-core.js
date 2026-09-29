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
  /* ── 작업 증빙 ─────────────────────────────────────────
     업무일지 숫자 뒤에 있는 실제 목록. 실제 작업일 월별 문서:
       { r:{ dd:{ 리뷰ID:[브랜드, 제품, 작성일, 출처] } }, p:{ dd:{ 제품ID:[브랜드, 제품명] } } }
     출처 c = 검수 콘솔로 처리, m = CMS 화면에서 직접 처리 */
  function evidenceFrom(work){
    const out={};
    const put=(k,d,id,info)=>{if(!date(d)||!/^\d+$/.test(String(id)))return;const doc=out[d.slice(0,7)]||(out[d.slice(0,7)]={r:{},p:{}});(doc[k][d.slice(8)]||(doc[k][d.slice(8)]={}))[String(id)]=info;};
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
  function mergeMonth(local,remote){
    if(!remote)return JSON.parse(JSON.stringify(local));
    if(!local)return JSON.parse(JSON.stringify(remote));
    const out=JSON.parse(JSON.stringify(local));
    const la=local._auto||{},ra=remote._auto||{},led={r:{},p:{}};
    for(const k of ['r','p']){const A=la[k]||{},B=ra[k]||{};for(const dd of new Set([...Object.keys(A),...Object.keys(B)]))led[k][dd]=unionIds(A[dd],B[dd]);}
    if(Object.keys(led.r).length||Object.keys(led.p).length)out._auto=led;
    if(remote.target!=null&&(remote._t||0)>(local._t||0)){out.target=remote.target;out._t=remote._t;}
    out.days=out.days||{};
    for(const dd of new Set([...Object.keys(local.days||{}),...Object.keys(remote.days||{})])){
      const L=(local.days||{})[dd],R=(remote.days||{})[dd];
      const win=!L?R:!R?L:((R._t||0)>(L._t||0)?R:L), other=win===L?R:L;
      const d=JSON.parse(JSON.stringify(win));
      if(other){if(!d.memo&&other.memo)d.memo=other.memo;if(!d.unreg&&other.unreg)d.unreg=other.unreg;if(!d.manual&&other.manual)d.manual=other.manual;}
      /* 숫자: 자동 집계가 있는 쪽의 조정값을 쓰고, 합친 장부로 다시 센다 */
      const src=win.auto?win:(other&&other.auto?other:null);
      if(src){
        const ar=((led.r||{})[dd]||[]).length,ap=((led.p||{})[dd]||[]).length;
        const offR=(src.r||0)-(src.auto.r||0),offP=(src.p||0)-(src.auto.p||0);
        d.r=Math.max(0,ar+offR);d.p=Math.max(0,ap+offP);d.auto={r:ar,p:ap};
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
  function mergeConsole(a,b){a=a||{};b=b||{};return {alias:mergeAlias(a.alias,b.alias),gate:mergeGate(a.gate,b.gate),done:mergeByTime(a.done,b.done),pending:mergeByTime(a.pending,b.pending,'u'),texts:mergeTexts(a.texts,b.texts),sent:mergeSent(a.sent,b.sent)};}
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
    for(const m of st.touchedMonths||[]){const merged=mergeMonth(st.months[m],rd(m));months({[m]:merged});out.months[m]=merged;push.push({month:m,data:merged});}
    for(const m of st.touchedEv||[]){const merged=mergeEvidence(rd('~ev:'+m),st.evidence[m]);out.evidence[m]=merged;push.push({month:'~ev:'+m,data:merged});}
    for(const d of Object.keys(st.audit||{})){const r=rd('~audit:'+d);const merged=(r&&Array.isArray(r.items))?mergeAudit(r,Object.assign({},st.audit[d],{date:d})):st.audit[d];out.audit[d]=merged;push.push({month:'~audit:'+d,data:merged});}
    if(Array.isArray(st.pending))push.push({month:'~pending',data:{at:now,items:st.pending.slice(0,500)}});
    if(st.console){
      const L=rd('~learn')||{},sentR={};
      sentMonths.forEach(m=>Object.assign(sentR,rd('~sent:'+m)||{}));
      const merged=mergeConsole({alias:L.alias,gate:L.gate,done:L.done,pending:L.pending,texts:rd('~texts')||{},sent:sentR},st.console);
      out.console=merged;
      push.push({month:'~learn',data:{alias:merged.alias,gate:merged.gate,done:merged.done,pending:merged.pending}});
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
    const res=syncStore(store.getItem(key),p.work,base,now);
    store.setItem(key,res.value);
    if(uid)store.setItem('unpa-worklog-active',key);
    const ev=readJSON(store,EV_KEY,null)||{v:1,months:{}};ev.months=ev.months||{};
    const fresh=evidenceFrom(p.work);
    Object.keys(fresh).forEach(m=>{ev.months[m]=mergeEvidence(ev.months[m],fresh[m]);});
    const audit=readJSON(store,AUDIT_KEY,null)||{v:1,days:{}};audit.days=audit.days||{};
    let auditDays=0;
    Object.keys(p.audit||{}).forEach(d=>{const day=p.audit[d];if(!date(d)||!day||!Array.isArray(day.items))return;audit.days[d]=mergeAudit(audit.days[d],Object.assign({},day,{date:d}));auditDays++;});
    if(Array.isArray(p.pending))store.setItem(PENDING_KEY,JSON.stringify({at:iso,items:p.pending}));
    let cloud='off',consoleOut=null;
    if(io&&uid){
      try{
        const snap=JSON.parse(store.getItem(key));
        /* 자동 집계 기간의 달은 바뀐 게 없어도 서버와 합친다 — 다른 컴퓨터가 한 일을 받아 오려면 */
        const range=[];for(let m=p.work.from.slice(0,7);m<=p.work.to.slice(0,7);){range.push(m);const y=+m.slice(0,4),mo=+m.slice(5,7);m=(mo===12?(y+1)+'-01':y+'-'+pad2(mo+1));}
        const touchedMonths=[...new Set([...(snap.dirty||[]),...res.touched,...range])].filter(m=>snap.months[m]);
        const days={};Object.keys(p.audit||{}).forEach(d=>{if(audit.days[d])days[d]=audit.days[d];});
        const out=await cloudSync(io,{now:iso,months:snap.months,touchedMonths,evidence:ev.months,touchedEv:[...new Set([...Object.keys(fresh),...range])],
          audit:days,pending:Array.isArray(p.pending)?p.pending:null,console:p.console||null,sentMonths:monthsBack(now,5)});
        /* 서버와 주고받는 사이에 업무일지 탭에서 고친 것이 있어도 잃지 않도록 한 번 더 합쳐서 쓴다 */
        const cur=JSON.parse(store.getItem(key));
        touchedMonths.forEach(m=>{cur.months[m]=Object.assign(mergeMonth(cur.months[m],out.months[m]),{_u:iso,_remote:iso});});
        cur.dirty=(cur.dirty||[]).filter(m=>touchedMonths.indexOf(m)<0);
        store.setItem(key,JSON.stringify(cur));
        Object.keys(out.evidence).forEach(m=>{ev.months[m]=out.evidence[m];});
        Object.keys(out.audit).forEach(d=>{audit.days[d]=out.audit[d];});
        consoleOut=out.console;cloud='on';
      }catch(e){cloud='error: '+String(e&&e.message||e).slice(0,100);}
    }
    /* 작업 증빙은 이 브라우저에 최근 4개월만 (서버에는 전부) */
    const evKeys=Object.keys(ev.months).sort();evKeys.slice(0,Math.max(0,evKeys.length-4)).forEach(k=>{delete ev.months[k];});
    let evError=null;try{store.setItem(EV_KEY,JSON.stringify(ev));}catch(e){evError=String(e&&e.message||e);}
    const auditError=auditDays||cloud==='on'?writeAudit(store,audit):null;
    const info={at:iso,from:p.work.from,today:res.today,partial:!!p.work.partial,changes:res.changes.slice(0,60),nChanges:res.changes.length,
                auditDays,auditError,evError,cloud};
    try{store.setItem('unpa-worklog-sync-v1',JSON.stringify(info));}catch(e){}
    return {ok:true,today:res.today,changes:res.changes.slice(0,20),nChanges:res.changes.length,auditDays,auditError,cloud,console:consoleOut};
  }
  return {date,months,mergeAudit,unappliedIds,applyWork,syncStore,syncAudit,syncWindow,
          evidenceFrom,mergeEvidence,mergeMonth,mergeAlias,mergeSent,mergeTexts,mergeGate,mergeConsole,mergeByTime,monthsBack,cloudSync};
});
