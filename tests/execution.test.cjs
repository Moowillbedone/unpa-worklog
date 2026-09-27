/* 실행 경로 — 무엇이 실제로 CMS 로 나가는가 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

/* cms-console.js 를 통째로 실행하고 내부를 꺼내 온다.
   네트워크는 전부 가짜이며 실제 CMS 로는 아무것도 나가지 않는다. */
function harness(){
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const raw=[]; const store={};
  const sent={get length(){return raw.filter(x=>x.url.indexOf('/admin/')>=0).length;},
              filter(f){return raw.filter(x=>x.url.indexOf('/admin/')>=0).filter(f);}};
  function XHR(){} XHR.prototype.open=function(){}; XHR.prototype.setRequestHeader=function(){};
  const el=()=>({style:{},onclick:null,appendChild(){},remove(){},click(){},querySelectorAll:()=>[],addEventListener(){},
                 querySelector:()=>null,insertBefore(){},set innerHTML(v){},get innerHTML(){return '';},
                 dataset:{},classList:{contains:()=>false},parentNode:{insertBefore(){}}});
  const ctx={
    location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me',search:''},
    document:{getElementById:()=>el(),createElement:el,body:{appendChild(){}},
              querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{constructor(){}get(){return null;}},
    Blob:class{constructor(p){this.parts=p;ctx.__blobs=(ctx.__blobs||0)+1;}},Image:class{},
    URL:Object.assign(function(u,b){return new URL(u,b);},
        {createObjectURL:()=>'blob:stub',revokeObjectURL(){},prototype:URL.prototype}),
    AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    alert:m=>{ctx.__alert=m;},confirm:()=>ctx.__confirm!==false,crypto:globalThis.crypto,
    __listeners:[],addEventListener(t,f){ if(t==='message') ctx.__listeners.push(f); },
    removeEventListener(t,f){ ctx.__listeners=ctx.__listeners.filter(x=>x!==f); },
    open:(...a)=>{ ctx.__opened=a; return ctx.__open?ctx.__open(...a):null; },
    fetch:async(url,init)=>{ raw.push({url:String(url),method:(init&&init.method)||'GET',body:init&&init.body});
                             const routed=ctx.__route&&ctx.__route(String(url),init||{});
                             const status=routed?routed.status:201;
                             const payload=routed?JSON.stringify(routed.body):'{"status":"APPROVED","templates":[]}';
                             return {status,text:async()=>payload,json:async()=>JSON.parse(payload)}; },
  };
  ctx.window=ctx; ctx.XMLHttpRequest=XHR;
  vm.createContext(ctx);
  vm.runInContext(code.replace('  /* ── 시작 ── */',
    `globalThis.api={buildReq,runJobs,sentLoad,doneLoad,doneToggle,auditPayload,CAP,
                     postScan,gridJobs,confidenceOf,histLoad,histSave,recheckRegistered,findProduct,aliasKey,
                     evenDates,backlogTodo,sentApply,auditDays,scanDates,
                     collectWork,workPayload,outboxLoad,outboxAudit,outboxRun,syncNow,lastActor,
                     setMe:e=>{ME=e;},setWork:w=>{WORK=w;},getSyncHtml:()=>SYNC_HTML,
                     listAll,loadBacklog,scanRows,capOf,canSend,sentMark,
                     getAbort:()=>SCAN_ABORT,
                     setResults:r=>{results=r;},
                     setDate:d=>{SCAN_DATE=d;},setTpl:t=>{tplMap=t;},getResults:()=>results};
     /* ── 시작 ── */`), ctx);
  return {api:ctx.api, sent, ctx, store};
}
const TPL={ product_match:{body:'제품 정보에서 [{제품명}] 검색 및 선택해주세요.'},
            swatch:{body:'해당 제품의 발색샷도 첨부 부탁드립니다.'} };

test('each verdict maps to the documented CMS request',()=>{
  const {api}=harness(); api.setTpl(TPL);
  assert.equal(JSON.stringify(api.buildReq({id:1,action:'approve'})),
    JSON.stringify({method:'POST',url:'https://api-v2.unpa.me/admin/reviews/1/approve',body:{}}));
  assert.equal(JSON.stringify(api.buildReq({id:2,action:'hide'})),
    JSON.stringify({method:'PUT',url:'https://api-v2.unpa.me/admin/reviews/2',body:{visible:false}}));
  const rev=api.buildReq({id:3,action:'revise_product',product_exact:'참 틴트'});
  assert.equal(rev.url,'https://api-v2.unpa.me/admin/reviews/3/revise');
  assert.match(rev.body.content[0],/\[참 틴트\]/);
  const sw=api.buildReq({id:4,action:'revise_swatch'});
  assert.match(sw.body.content[0],/발색샷/);
  assert.equal(api.buildReq({id:5,action:'hold'}),null,'사람이 볼 건은 요청을 만들지 않는다');
});

test('per-action caps refuse oversized batches',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  const many=Array.from({length:api.CAP.hide+1},(_,i)=>({id:1000+i,action:'hide',reasons:[]}));
  await api.runJobs(many);
  assert.equal(sent.length,0,'상한을 넘으면 한 건도 보내지 않는다');
  assert.match(ctx.__alert,/상한/);
});

test('cancelling the confirm sends nothing',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  ctx.__confirm=false;
  await api.runJobs([{id:7,action:'approve',reasons:[]}]);
  assert.equal(sent.length,0);
});

test('a successful send is journaled and never repeats',async()=>{
  const {api,sent}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  const job={id:9,action:'approve',reasons:[]};
  api.setResults([job]);
  await api.runJobs([job]);
  assert.equal(sent.filter(s=>s.method==='POST').length,1);
  assert.ok(api.sentLoad()['9'],'전송 이력에 남는다');
  await api.runJobs([job]);                       /* 같은 건을 다시 실행 */
  assert.equal(sent.filter(s=>s.method==='POST').length,1,'두 번 나가지 않는다');
});

test('nothing is transmitted merely by classifying',async()=>{
  const {sent}=harness();
  assert.equal(sent.filter(s=>s.method&&s.method!=='GET').length,0);
});

test('registration done marks persist, can be undone, and never reach the CMS',()=>{
  const {api,sent,store}=harness(); api.setDate('2026-09-08');
  const r={id:471609,action:'register_product',reasons:['브랜드○ · 제품 없음'],photo:{label:'직접촬영'},photoCls:[]};
  api.setResults([r]);
  const before=sent.length;

  const rec=api.doneToggle(r,true);
  assert.ok(rec && rec.at,'완료 시각이 남는다');
  assert.ok(api.doneLoad()['471609'],'브라우저에 저장된다');
  assert.ok(store['unpa-console-manual-done-v1'],'새로고침 후에도 읽을 수 있는 키에 저장된다');

  const audit=api.auditPayload();
  assert.equal(typeof audit.items[0].manual_done,'string','검수기록 JSON 에 완료 시각이 남는다');

  api.doneToggle(r,false);
  assert.equal(api.doneLoad()['471609'],undefined,'체크를 풀면 지워진다');
  assert.equal(api.auditPayload().items[0].manual_done,null);

  assert.equal(sent.length,before,'완료 표시는 CMS 로 아무 요청도 보내지 않는다');
});

/* ── 자동화 고도화 ─────────────────────────────────────────── */
const LONG='라운드랩 독도 토너 쓰고 있어요. 수분감이 좋아서 건조한 겨울에도 당기지 않고 촉촉하게 유지돼요. 향도 은은하고 흡수가 빨라서 아침에 쓰기 좋습니다. 재구매 의사 있어요.';
function cand(id,over){ return Object.assign({id,brand:'라운드랩',product:'1025 독도 토너',user:'u'+id,action:'approve',approvable:true,applied:false,
  reasons:['직접촬영 · 매칭 정상'],photo:{v:'camera'},photoCls:['camera','camera'],swatch:null,warn:null,
  suspension:{blocked:false,count:0},_body:LONG},over||{}); }

test('only fully safe candidates are high confidence',()=>{
  const {api}=harness(); const h=api.histLoad();
  assert.equal(api.confidenceOf(cand(1),h).level,'high');
  const cases=[
    [{swatch:'틴트'},'발색'],
    [{photoCls:['camera','web']},'저해상'],
    [{photoCls:['unknown']},'직접촬영 사진 없음'],
    [{photoCls:[]},'사진 없음'],
    [{suspension:{blocked:false,count:2}},'정지 이력'],
    [{_body:'좋아요 잘 써요'},'본문 짧음'],
    [{warn:'브랜드 조회 안 됨'},'브랜드'],
    [{dup:'다른 리뷰와 본문 거의 동일'},'본문 거의 동일'],
  ];
  for(const [over,word] of cases){
    const c=api.confidenceOf(cand(2,over),h);
    assert.equal(c.level,'check',word);
    assert.ok(c.why.join(' ').indexOf(word)>=0, word+' 사유 표시');
  }
  h.users['u3']={approve:5,hide:1,revise:0};
  assert.equal(api.confidenceOf(cand(3),h).level,'check','과거 미노출 사용자는 사람이 본다');
});

test('near-identical texts in one scan are flagged, samples are drawn from high confidence',()=>{
  const {api}=harness(); api.setDate('2026-09-26');
  const words=['피부가','편해요','촉촉','산뜻','무난','흡수','향이','보습','진정','발림','가볍고','끈적임','없이','아침','저녁','건성','지성','복합성','민감','트러블'];
  const rows=Array.from({length:40},(_,i)=>{
    let t='리뷰'+i+' ';
    for(let k=0;k<30;k++) t+=words[(i*7+k*13+k*k*i)%words.length]+(i+k)+' ';
    return cand(100+i,{_body:t});
  });
  rows.push(cand(900,{user:'copycat',_body:LONG}), cand(901,{user:'copycat',product:'다른 제품',_body:LONG+'!'}));
  api.setResults(rows); api.postScan();
  const r900=rows.find(r=>r.id===900), r901=rows.find(r=>r.id===901);
  assert.ok(r900.dup && r901.dup,'거의 같은 본문 둘 다 표시');
  assert.equal(r900.conf,'check'); assert.equal(r901.conf,'check');
  assert.match(r900.dup,/같은 사용자/);
  const highs=rows.filter(r=>r.conf==='high'), samples=highs.filter(r=>r.sample);
  assert.ok(highs.length>=30,'나머지는 고신뢰 ('+highs.length+')');
  assert.equal(samples.length,Math.max(3,Math.ceil(highs.length*0.1)),'표본은 10%, 최소 3건');
});

test('text seen on a previous day under another review is flagged',()=>{
  const {api}=harness();
  api.setDate('2026-09-24'); api.setResults([cand(1)]); api.postScan();
  api.setDate('2026-09-26'); const again=cand(2); api.setResults([again]); api.postScan();
  assert.match(again.dup,/과거 리뷰\(#1/); assert.equal(again.conf,'check');
  const same=cand(1); api.setResults([same]); api.postScan();
  assert.equal(same.dup,undefined,'원본 리뷰를 다시 스캔해도 원본은 복붙으로 몰리지 않는다');
});

test('sample gate: any skipped sample blocks all high-confidence approvals',()=>{
  const {api}=harness();
  const s1=cand(1,{conf:'high',sample:true}), s2=cand(2,{conf:'high',sample:true});
  const c1=cand(3,{conf:'check'}), highs=[cand(4,{conf:'high'}),cand(5,{conf:'high'})];
  const pool=[s1,s2,c1];
  let g=api.gridJobs(pool,{1:'approve',2:'approve',3:'approve'},highs);
  assert.equal(g.gateOk,true); assert.equal(g.jobs.length,5,'표본 통과 → 고신뢰 함께');
  g=api.gridJobs(pool,{1:'approve',2:'skip',3:'approve'},highs);
  assert.equal(g.gateOk,false); assert.equal(g.jobs.map(r=>r.id).join(','),'1,3','표본 하나라도 탈락 → 고신뢰 제외');
  g=api.gridJobs(pool,{1:'approve',2:'swatch',3:'skip'},highs);
  assert.equal(g.gateOk,false,'표본을 발색샷으로 돌린 것도 탈락으로 본다');
});

test('a product name the person matched once is matched automatically next time',async()=>{
  const {api,ctx}=harness();
  ctx.__route=(url)=> url.includes('/admin/products?')
    ? {status:200,body:{total:2,results:[{id:77,name:'바디러브 로션 딥 모이스처'},{id:78,name:'너리싱 샴푸'}]}}
    : {status:404,body:{}};
  let p=await api.findProduct(5,'촉촉 바디로션 딥');
  assert.notEqual(p.confident,true,'처음에는 확정하지 못한다');
  const h=api.histLoad(); h.alias[api.aliasKey(5,'촉촉 바디로션 딥')]={pid:77,name:'바디러브 로션 딥 모이스처',n:1}; api.histSave(h);
  p=await api.findProduct(5,'촉촉 바디로션 딥');
  assert.equal(p.confident,true); assert.equal(p.pick.id,77); assert.ok(p.learned);
});

test('revise_product teaches the alias; hide on already-hidden review does not stop the batch',async()=>{
  const {api,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-26');
  ctx.__route=(url,init)=>{
    if(init.method==='PUT' && url.endsWith('/reviews/11'))
      return {status:400,body:{statusCode:400,message:'현재 노출 상태와 변경하려는 노출 상태가 같습니다!'}};
    if(init.method==='POST'||init.method==='PUT') return {status:201,body:{ok:true}};
    return {status:404,body:{}};
  };
  const hide=cand(11,{action:'hide'});
  const rev=cand(12,{action:'revise_product',product:'촉촉 바디로션 딥',product_exact:'바디러브 로션 딥 모이스처',product_id:77,brand_match:{id:5}});
  const ok=cand(13,{action:'approve'});
  api.setResults([hide,rev,ok]);
  await api.runJobs([hide,rev,ok]);
  assert.equal(hide.applied,true,'이미 미노출 → 완료로 처리');
  assert.equal(rev.applied,true,'앞 건 때문에 멈추지 않는다');
  assert.equal(ok.applied,true);
  const h=api.histLoad();
  assert.equal(h.alias[api.aliasKey(5,'촉촉 바디로션 딥')].pid,77,'보낸 제품명을 기억한다');
  assert.equal(h.users['u13'].approve,1); assert.equal(h.users['u11'].hide,1);
});

test('after manual registration, recheck turns the item into a product re-select request',async()=>{
  const {api,ctx}=harness();
  let registered=false;
  ctx.__route=(url)=>{
    if(url.includes('/admin/brands?')) return {status:200,body:{total:1,results:[{id:9,name:'앙쥬',approved:true}]}};
    if(url.includes('/admin/products?')) return {status:200,body:{total:registered?1:0,results:registered?[{id:501,name:'눈썹문신 워터프루프 아이브로우'}]:[]}};
    if(/\/admin\/products\/501$/.test(url)) return {status:200,body:{id:501,options:[{name:'흑갈색'},{name:'회갈색'}]}};
    return {status:404,body:{}};
  };
  const r=cand(21,{action:'register_product',brand:'앙쥬',product:'눈썹문신 워터프루프 아이브로우 회갈색',approvable:false});
  let found=await api.recheckRegistered([r]);
  assert.equal(found.length,0); assert.equal(r.action,'register_product'); assert.match(r.recheck,/아직|확정/);
  registered=true;
  found=await api.recheckRegistered([r]);
  assert.equal(found.length,1); assert.equal(r.action,'revise_product');
  assert.equal(r.product_id,501); assert.equal(r.brand_match.id,9);
});

/* ── 남은 짝수일 한 번에 · 수정완료 ─────────────────────────── */
test('only even days of the month are listed as mine',()=>{
  const {api}=harness();
  const d=api.evenDates(10,new Date(2026,8,27));          /* 2026-09-27 기준 10일 */
  assert.equal(d.join(','),'2026-09-26,2026-09-24,2026-09-22,2026-09-20,2026-09-18');
  const x=api.evenDates(4,new Date(2026,9,2));             /* 월이 바뀌어도 날짜 기준 짝수 */
  assert.equal(x.join(','),'2026-10-02,2026-09-30');
});

test('backlog skips what the console already handled, but brings back user-fixed reviews',()=>{
  const {api}=harness();
  const sent={ '1':{action:'approve'}, '2':{action:'revise_product'}, '3':{action:'revise_product'}, '4':{action:'hide'} };
  const rows=[
    {id:1,status:'PENDING',visible:true},     /* 승인했는데 아직 목록에 — 처리한 것으로 본다 */
    {id:2,status:'REVISED',visible:true},     /* 수정요청 보내고 대기 — 할 일 아님 */
    {id:3,status:'UPDATED',visible:true},     /* 수정요청 후 유저 수정완료 — 다시 할 일 */
    {id:4,status:'PENDING',visible:false},    /* 미노출 처리됨 */
    {id:5,status:'PENDING',visible:true},     /* 처음 보는 건 */
    {id:6,status:'UPDATED',visible:true},     /* 사람이 CMS에서 직접 요청했던 건의 수정완료 */
  ];
  assert.equal(api.backlogTodo(rows,sent).map(x=>x.id).join(','),'3,5,6');
});

test('a user-fixed review may be re-sent even though it was sent before',async()=>{
  const {api,ctx,sent}=harness(); api.setTpl(TPL); api.setDate('2026-09-20');
  ctx.__route=(url,init)=> (init.method==='POST'||init.method==='PUT') ? {status:201,body:{ok:true}} : {status:404,body:{}};
  const r={id:42,action:'revise_product',product:'x',product_exact:'Y 크림',product_id:9,brand_match:{id:3},reasons:[],reviewStatus:'UPDATED',date:'2026-09-20'};
  api.setResults([r]);
  await api.runJobs([r]);                                   /* 1차 요청 */
  assert.equal(sent.filter(s=>s.method==='POST').length,1);
  const again=Object.assign({},r,{applied:false,reasons:[]});
  api.sentApply(again);                                     /* 유저가 수정완료해서 다시 스캔된 상황 */
  assert.notEqual(again.applied,true,'수정완료 건은 이전 전송 기록으로 막지 않는다');
  assert.ok(again._allowResend);
  api.setResults([again]);
  await api.runJobs([again]);
  assert.equal(sent.filter(s=>s.method==='POST').length,2,'두 번째 요청이 나간다');
  const plain=Object.assign({},r,{reviewStatus:'PENDING',applied:false,reasons:[]});
  api.sentApply(plain);
  assert.equal(plain.applied,true,'수정완료가 아니면 여전히 중복 전송을 막는다');
});

test('audit is split by review date',()=>{
  const {api}=harness(); api.setDate('2026-09-18_2026-09-22');
  api.setResults([
    {id:1,date:'2026-09-18',action:'approve',applied:true,reasons:[]},
    {id:2,date:'2026-09-18',action:'hide',applied:true,reasons:[]},
    {id:3,date:'2026-09-22',action:'approve',applied:true,reasons:[]},
    {id:4,date:'2026-09-22',action:'register_product',applied:false,reasons:[]},
    {id:5,date:'2026-09-20',action:'hold',applied:false,reasons:[]},
  ]);
  assert.equal(api.scanDates().join(','),'2026-09-18,2026-09-20,2026-09-22');
  const a=api.auditDays();
  assert.equal(Object.keys(a.days).join(','),'2026-09-18,2026-09-20,2026-09-22');
  assert.equal(a.days['2026-09-22'].items.length,2);
  assert.equal(a.days['2026-09-20'].date,'2026-09-20');
});

test('several days at once raise the cap by the number of days',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL);
  const hides=Array.from({length:api.CAP.hide+5},(_,i)=>({id:2000+i,action:'hide',reasons:[],date:i%2?'2026-09-24':'2026-09-26'}));
  api.setResults(hides);
  assert.equal(api.capOf('hide'),api.CAP.hide*2);
  await api.runJobs(hides);
  assert.equal(sent.filter(x=>x.method==='PUT').length,hides.length,'2일치면 하루 상한의 두 배까지 나간다');
  const {api:one,sent:s1}=harness(); one.setTpl(TPL);
  const single=hides.map(h=>Object.assign({},h,{date:'2026-09-26'}));
  one.setResults(single); await one.runJobs(single);
  assert.equal(s1.length,0,'하루치는 기존 상한 그대로');
});

test('the same re-select request is not repeated a third time',()=>{
  const {api,store}=harness(); api.setDate('2026-09-20');
  const r={id:77,action:'revise_product',reasons:[],date:'2026-09-20'};
  api.sentMark(r); api.sentMark(r);
  const j=JSON.parse(store['unpa-console-sent-v1']);
  assert.equal(j['77'].rn,2,'수정요청 횟수를 센다');
  const again={id:77,action:'revise_product',reasons:[],reviewStatus:'UPDATED',exec:true};
  api.sentApply(again);
  assert.equal(again.action,'hold','두 번 보냈는데도 그대로면 사람에게');
  assert.match(again.reasons.join(' '),/2번/);
  const fixed={id:77,action:'approve',approvable:true,reasons:[],reviewStatus:'UPDATED'};
  api.sentApply(fixed);
  assert.equal(fixed.action,'approve','고쳤으면 승인은 된다');
  assert.equal(api.canSend(fixed,j['77']),true);
  assert.equal(api.canSend({action:'revise_swatch',_allowResend:true},j['77']),false,'그리드에서 골라도 세 번째 수정요청은 막는다');
  assert.equal(api.canSend({action:'revise_product',_allowResend:true},{action:'revise_product'}),true,'예전 기록(횟수 없음)은 1번으로 본다');
});

test('old journal entries are pruned so storage never silently fills up',()=>{
  const {api,store}=harness();
  const old=new Date(Date.now()-400*864e5).toISOString(), m={};
  for(let i=0;i<5200;i++) m[String(i)]={action:'approve',at:i<300?new Date().toISOString():old,date:'2025-08-01'};
  store['unpa-console-sent-v1']=JSON.stringify(m);
  assert.equal(api.sentMark({id:99999,action:'approve',date:'2026-09-26'}),true);
  const j=JSON.parse(store['unpa-console-sent-v1']);
  assert.equal(Object.keys(j).length,301,'오래된 기록만 버리고 최근 것과 방금 것은 남긴다');
  assert.ok(j['99999'] && j['0']);
});

test('list paging retries once and never counts a review twice',async()=>{
  const {api,ctx}=harness();
  let calls=0;
  const page=(from,n)=>Array.from({length:n},(_,i)=>({id:from+i,status:'PENDING',visible:true}));
  ctx.__route=(url)=>{
    if(!url.includes('/admin/reviews?')) return {status:404,body:{}};
    calls++;
    if(calls===1) return {status:502,body:{}};                            /* 첫 호출은 일시 오류 */
    if(url.includes('page=1&')) return {status:200,body:{total:150,results:page(1,100)}};
    return {status:200,body:{total:150,results:page(96,55)}};             /* 새 리뷰 유입으로 5건 겹침 */
  };
  const rows=await api.listAll('2026-09-26');
  assert.equal(rows.length,150,'겹친 5건은 한 번만');
  assert.equal(new Set(rows.map(r=>r.id)).size,150);
  let n=0; ctx.__route=(url)=>{                                           /* total 을 안 주는 응답 */ n++; return n===1?{status:200,body:{results:page(1,100)}}:{status:200,body:{results:page(101,3)}}; };
  assert.equal((await api.listAll('2026-09-24')).length,103,'total 이 없어도 첫 페이지에서 멈추지 않는다');
});

test('one failing date does not hide the rest of the backlog',async()=>{
  const {api,ctx}=harness();
  ctx.__route=(url)=>{
    if(url.includes('startDate=2026-09-24')) return {status:500,body:{}};
    if(url.includes('startDate=2026-09-26')) return {status:200,body:{total:2,results:[{id:1,status:'PENDING',visible:true},{id:2,status:'UPDATED',visible:true}]}};
    return {status:200,body:{total:0,results:[]}};
  };
  const b=await api.loadBacklog();
  assert.equal(b.map(x=>x.date).join(','),'2026-09-26');
  assert.equal(b[0].updated,1);
  assert.deepEqual([...b.failed],['2026-09-24'],'실패한 날짜는 따로 알린다');
  ctx.__route=()=>({status:401,body:{}});
  assert.equal(await api.loadBacklog(),null,'전부 실패면 로그인 문제로 본다');
});

test('scan follows the fresh detail: already handled or hidden reviews are not sent',async()=>{
  const {api,ctx}=harness(); api.setDate('2026-09-26');
  const base={contentText:'촉촉하고 흡수가 빨라서 아침에 쓰기 좋아요. 향도 은은합니다.',attachments:[],userBlocked:false,userBlockedCount:0,
              productPrice:1000,productImageUrl:'https://img/p.png',productId:5};
  ctx.__route=(url)=>{
    if(url.endsWith('/reviews/1')) return {status:200,body:Object.assign({},base,{status:'APPROVED',visible:true})};
    if(url.endsWith('/reviews/2')) return {status:200,body:Object.assign({},base,{status:'PENDING',visible:false,productId:null,productPrice:null,productImageUrl:null})};
    if(url.includes('/admin/brands?')) return {status:200,body:{total:1,results:[{id:3,name:'브랜드',approved:true}]}};
    if(url.includes('/admin/products?')) return {status:200,body:{total:1,results:[{id:8,name:'수분 크림'}]}};
    return {status:404,body:{}};
  };
  await api.scanRows([{id:1,brandName:'브랜드',productName:'수분 크림',status:'PENDING',visible:true,_date:'2026-09-26'},
                      {id:2,brandName:'브랜드',productName:'수분 크림',status:'PENDING',visible:true,_date:'2026-09-26'}]);
  const [a,b]=api.getResults();
  assert.equal(a.action,'hold'); assert.match(a.reasons[0],/이미 검수완료/);
  assert.equal(b.action,'hold','엑박이어도 누가 미노출한 리뷰에는 재선택 요청을 보내지 않는다');
  assert.match(b.reasons.join(' '),/이미 미노출된 리뷰/);
});

test('scan stops after repeated detail failures instead of crawling on',async()=>{
  const {api,ctx}=harness(); api.setDate('2026-09-26');
  ctx.__route=()=>({status:401,body:{}});
  await api.scanRows(Array.from({length:12},(_,i)=>({id:300+i,brandName:'b',productName:'p',_date:'2026-09-26'})));
  assert.equal(api.getResults().length,5,'연속 5번 실패하면 멈춘다');
  assert.match(api.getAbort(),/연속 5번/);
});

/* ── 업무일지 자동 동기화 (2026-09-27) ───────────────────── */
const localYmd=d=>{const p=n=>(n<10?'0':'')+n;return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};

test('work is counted on the day I approved, only when I was the one who approved',async()=>{
  const {api,ctx}=harness();
  const now=new Date(), d0=localYmd(now), d3=localYmd(new Date(now.getFullYear(),now.getMonth(),now.getDate()-3));
  const at=(daysAgo,h)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()-daysAgo,h,10).toISOString();
  const ME='me@example.com', OT='other@example.com';
  ctx.__route=(url)=>{
    if(url.includes('/admin/reviews?')){
      if(!url.includes('startDate='+d3+'&')) return {status:200,body:{totalCount:0,result:[]}};
      return {status:200,body:{totalCount:6,result:[
        {id:1,approvedAt:at(0,10),revisedBy:[ME],status:'APPROVED'},            /* 3일 전 리뷰를 오늘 승인 */
        {id:2,approvedAt:at(2,23),revisedBy:['Me@Example.com'],status:'APPROVED'},/* 대소문자 무시, 이틀 전 승인 */
        {id:3,approvedAt:at(0,11),lastRevisedAt:at(1,9),revisedBy:[ME,ME],status:'APPROVED'}, /* 수정요청 뒤 내가 승인 */
        {id:4,approvedAt:at(0,12),revisedBy:[ME,OT],status:'APPROVED'},         /* 내가 요청하고 남이 승인 → 내 것 아님 */
        {id:5,approvedAt:at(0,12),revisedBy:[OT],status:'APPROVED'},            /* 다른 담당자 */
        {id:6,approvedAt:null,lastRevisedAt:at(0,9),revisedBy:[ME],status:'REVISED'}, /* 수정요청만 — 세지 않는다 */
      ]}};
    }
    if(url.includes('/admin/products?')){
      const pg=Number(/page=(\d+)/.exec(url)[1]);
      const rows=Array.from({length:300},(_,i)=>({id:pg*1000+i,createdAt:at(pg===1?0:70,8),approvedAt:at(pg===1?0:70,8),approvedBy:i<2&&pg===1?ME:OT}));
      return {status:200,body:{totalCount:900,results:rows}};
    }
    return {status:404,body:{}};
  };
  const w=await api.collectWork(ME);
  const expect={}; expect['1']=d0; expect['2']=localYmd(new Date(at(2,23))); expect['3']=d0;
  assert.deepEqual(JSON.parse(JSON.stringify(w.reviews)),expect);
  assert.deepEqual(Object.keys(w.products).sort(),['1000','1001'],'내가 등록한 제품만');
  assert.equal(w.products['1000'],d0);
  assert.equal(w.failed.length,0);
});

test('runs leave no downloaded files; results wait in the outbox and go with the next sync',async()=>{
  const {api,ctx,store}=harness(); api.setTpl(TPL); api.setDate('2026-09-24');
  ctx.__route=(url,init)=> (init.method==='POST'||init.method==='PUT') ? {status:201,body:{ok:true}} : {status:404,body:{}};
  const jobs=[{id:11,action:'approve',reasons:[],date:'2026-09-24',user:'u'},{id:12,action:'hide',reasons:[],date:'2026-09-24',user:'v'}];
  api.setResults(jobs);
  await api.runJobs(jobs);
  assert.equal(ctx.__blobs||0,0,'처리 로그를 파일로 내려받지 않는다');
  const ob=api.outboxLoad();
  assert.equal(ob.audit['2026-09-24'].executions.length,2,'실행 결과는 검수기록에 붙는다');
  assert.equal(ob.audit['2026-09-24'].items.filter(x=>x.applied).length,2);
  assert.equal(JSON.stringify(ob.reviews.map(x=>x[0])),JSON.stringify(['11']),'승인한 것은 오늘 날짜로 바로 반영 대기');
  assert.equal(ob.reviews[0][1],localYmd(new Date()));
  const p=api.workPayload();
  assert.equal(p.work.from,'2026-09-01'); assert.equal(p.work.to,localYmd(new Date()));
  assert.ok(p.work.reviews.some(x=>x[0]==='11'));
  assert.ok(p.audit['2026-09-24']);
});

test('sync popup: blocked shows a one-click button; a verified reply clears the outbox',async()=>{
  const {api,ctx}=harness(); api.setDate('2026-09-24');
  api.setMe('me@example.com'); api.setWork({reviews:{'5':'2026-09-27'},products:{},failed:[]});
  api.setResults([{id:5,date:'2026-09-24',action:'approve',applied:true,reasons:[]}]); api.outboxAudit();
  assert.equal(api.syncNow(),false);
  assert.match(api.getSyncHtml(),/지금 반영/,'팝업이 막히면 버튼으로');
  const posted=[]; const win={postMessage:(m,o)=>posted.push([m,o])};
  ctx.__open=()=>win;
  assert.equal(api.syncNow(),true);
  const nonce=/#n=([a-f0-9]+)/.exec(ctx.__opened[0])[1];
  assert.match(ctx.__opened[0],/^https:\/\/moowillbedone\.github\.io\/unpa-worklog\/sync\.html#n=/);
  const fire=(data,origin,source)=>ctx.__listeners.slice().forEach(f=>f({origin:origin||'https://moowillbedone.github.io',source:source||win,data}));
  fire({type:'unpa-sync-ready',nonce},'https://evil.example');                /* 다른 주소는 무시 */
  fire({type:'unpa-sync-ready',nonce:'0000'});                                /* 번호가 다르면 무시 */
  assert.equal(posted.length,0);
  fire({type:'unpa-sync-ready',nonce});
  assert.equal(posted.length,1); assert.equal(posted[0][1],'https://moowillbedone.github.io','받는 곳을 업무일지 주소로 한정');
  const pl=posted[0][0].payload;
  assert.equal(JSON.stringify(pl.work.reviews),JSON.stringify([['5','2026-09-27']]));
  assert.ok(pl.audit['2026-09-24']);
  fire({type:'unpa-sync-done',nonce,ok:true,seq:pl.seq,today:{d:'2026-09-27',r:5,p:1},nChanges:1});
  assert.deepEqual(Object.keys(api.outboxLoad()),[],'넘긴 뒤 보관함을 비운다');
  assert.match(api.getSyncHtml(),/오늘 리뷰 <b>5<\/b>/);
});
