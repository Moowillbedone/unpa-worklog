/* 실행 경로 — 무엇이 실제로 CMS 로 나가는가 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

/* 업무일지 동기화가 남기는 목표 스냅샷 — 이번 달(한국 시간) · 방금 센 것 */
function snap(o){ const now=Date.now(); return Object.assign({month:new Date(now+9*3600e3).toISOString().slice(0,7),target:1430000,won:0,
  at:new Date(now).toISOString(),countedAt:new Date(now-60e3).toISOString(),builtAt:new Date(now-30e3).toISOString(),partial:false,ids:{r:[],p:[]}},o||{}); }
/* cms-console.js 를 통째로 실행하고 내부를 꺼내 온다.
   네트워크는 전부 가짜이며 실제 CMS 로는 아무것도 나가지 않는다. */
function harness(opts){
  opts=opts||{};
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
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];},
                  get length(){ return Object.keys(store).length; },key:i=>Object.keys(store)[i]===undefined?null:Object.keys(store)[i]},
    URLSearchParams:class{constructor(){}get(){return null;}},
    Blob:class{constructor(p){this.parts=p;ctx.__blobs=(ctx.__blobs||0)+1;}},Image:class{},
    URL:Object.assign(function(u,b){return new URL(u,b);},
        {createObjectURL:()=>'blob:stub',revokeObjectURL(){},prototype:URL.prototype}),
    AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,WorklogCore:require('../worklog-core.js'),
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
  if(!opts.noGuard) vm.runInContext(fs.readFileSync(path.join(root,'cms-claude.js'),'utf8'), ctx);   /* 콘솔이 쓰는 공용 목표 가드 */
  vm.runInContext(code.replace('  /* ── 시작 ── */',
    `globalThis.api={buildReq,runJobs,sentLoad,doneLoad,doneToggle,auditPayload,CAP,
                     postScan,gridJobs,confidenceOf,histLoad,histSave,recheckRegistered,findProduct,aliasKey,
                     evenDates,backlogTodo,sentApply,auditDays,scanDates,
                     collectWork,workPayload,outboxLoad,outboxAudit,outboxRun,syncNow,lastActor,
                     pendingRecord,pendingLoad,learnFromWatch,associate,consoleState,applyConsoleState,doneRaw,
                     setBacklog:b=>{BACKLOG=b;},backlogList,seedFromVerdicts,
                     budget,planApprovals,goalSave,openGrid,refreshSkipped,remainList,
                     hideRecord,learnHides,hidefpLoad,hidefpMark,hideOverridden,kindUnsure,hideKind,renderQueue,
                     setUncheck:(id,v)=>{UNCHECK[id]=v;},
                     setMe:e=>{ME=e;},setWork:w=>{WORK=w;},getSyncHtml:()=>SYNC_HTML,startWorkSync,
                     listAll,loadBacklog,scanRows,capOf,canSend,sentMark,
                     getAbort:()=>SCAN_ABORT,
                     setResults:r=>{results=r;},
                     setDate:d=>{SCAN_DATE=d;},setTpl:t=>{tplMap=t;},getResults:()=>results};
     /* ── 시작 ── */`), ctx);
  /* 목표를 모르면 승인하지 않으므로, 실행 경로 테스트는 넉넉한 목표·빈 이번 달 집계를 기본으로 둔다 (목표 테스트는 각자 덮어쓴다) */
  if(!opts.noGoal){
    const d=new Date();
    ctx.api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:d.toISOString(),startedAt:d.toISOString()});
    ctx.api.goalSave(snap({target:1e9,won:0}));
  }
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

test('near-identical texts in one scan are flagged, samples are drawn from high confidence',async()=>{
  const {api}=harness(); api.setDate('2026-09-26');
  const words=['피부가','편해요','촉촉','산뜻','무난','흡수','향이','보습','진정','발림','가볍고','끈적임','없이','아침','저녁','건성','지성','복합성','민감','트러블'];
  const rows=Array.from({length:40},(_,i)=>{
    let t='리뷰'+i+' ';
    for(let k=0;k<30;k++) t+=words[(i*7+k*13+k*k*i)%words.length]+(i+k)+' ';
    return cand(100+i,{_body:t});
  });
  rows.push(cand(900,{user:'copycat',_body:LONG}), cand(901,{user:'copycat',product:'다른 제품',_body:LONG+'!'}));
  api.setResults(rows); await api.postScan();
  const r900=rows.find(r=>r.id===900), r901=rows.find(r=>r.id===901);
  assert.ok(r900.dup && r901.dup,'거의 같은 본문 둘 다 표시');
  assert.equal(r900.conf,'check'); assert.equal(r901.conf,'check');
  assert.match(r900.dup,/같은 사용자/);
  const highs=rows.filter(r=>r.conf==='high'), samples=highs.filter(r=>r.sample);
  assert.ok(highs.length>=30,'나머지는 고신뢰 ('+highs.length+')');
  assert.equal(samples.length,Math.max(3,Math.ceil(highs.length*0.1)),'표본은 10%, 최소 3건');
});

test('text seen on a previous day under another review is flagged',async()=>{
  const {api}=harness();
  api.setDate('2026-09-24'); api.setResults([cand(1)]); await api.postScan();
  api.setDate('2026-09-26'); const again=cand(2); api.setResults([again]); await api.postScan();
  assert.match(again.dup,/과거 리뷰\(#1/); assert.equal(again.conf,'check');
  const same=cand(1); api.setResults([same]); await api.postScan();
  assert.equal(same.dup,undefined,'원본 리뷰를 다시 스캔해도 원본은 복붙으로 몰리지 않는다');
});

test('a review re-posted after the user deleted the original is not a duplicate',async()=>{
  const {api,ctx}=harness();
  ctx.__route=(url)=> /\/admin\/reviews\/1$/.test(url) ? {status:200,body:{id:1,deletedAt:'2026-10-02T06:05:41Z'}} : null;
  api.setDate('2026-09-28'); api.setResults([cand(1)]); await api.postScan();
  api.setDate('2026-10-02'); const again=cand(2); api.setResults([again]); await api.postScan();
  assert.equal(again.dup,undefined,'원본이 지워졌으면 중복으로 보지 않는다');
  assert.ok(again.reasons.some(w=>/지운 리뷰\(#1\)/.test(w)));
  const third=cand(3); api.setResults([third]); await api.postScan();
  assert.match(third.dup||'',/과거 리뷰\(#2/,'다시 올린 리뷰가 새 원본이 된다');
});

test('product reselect with swatch goes out as one combined message',()=>{
  const {api}=harness();
  api.setTpl(Object.assign({},TPL,{product_match_swatch:{body:'[{제품명}] 검색 및 선택. 또한 해당 제품의 발색샷도 첨부 부탁드립니다. 문의 help'}}));
  const r=api.buildReq({id:7,action:'revise_product',product_exact:'새틴 베일 쿠션',with_swatch:true});
  assert.equal(r.body.content.length,1);
  assert.match(r.body.content[0],/\[새틴 베일 쿠션\][\s\S]*발색샷/);
  assert.equal((r.body.content[0].match(/문의/g)||[]).length,1,'문의 안내는 한 번만');
  const {api:bare}=harness(); bare.setTpl(TPL);
  assert.equal(bare.buildReq({id:8,action:'revise_product',product_exact:'x',with_swatch:true}),null,
    '합친 문구가 없으면 발색 요청을 빠뜨린 채 보내지 않는다');
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
  const days=Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(w.reviews))).map(([k,v])=>[k,v[0]]));
  assert.deepEqual(days,{'1':d0,'2':localYmd(new Date(at(2,23))),'3':d0});
  assert.deepEqual(Object.keys(w.products).sort(),['1000','1001'],'내가 등록한 제품만');
  assert.equal(w.products['1000'][0],d0); assert.equal(w.mine.length,2,'짝짓기에 쓸 내가 등록한 제품');
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
  assert.equal(JSON.stringify(pl.work.reviews),JSON.stringify([['5','2026-09-27','','','','m']]));
  assert.ok(pl.console && pl.console.sent,'콘솔 경험도 함께 보낸다'); assert.ok(Array.isArray(pl.pending));
  assert.ok(pl.audit['2026-09-24']);
  fire({type:'unpa-sync-done',nonce,ok:true,seq:pl.seq,today:{d:'2026-09-27',r:5,p:1},nChanges:1});
  assert.deepEqual(Object.keys(api.outboxLoad()),[],'넘긴 뒤 보관함을 비운다');
  assert.match(api.getSyncHtml(),/오늘 리뷰 <b>5<\/b>/);
});

test('audit records stay small: approvals keep one line, other verdicts keep their evidence',()=>{
  const {api}=harness(); api.setDate('2026-09-24');
  const long='x'.repeat(300);
  api.setResults([
    {id:1,date:'2026-09-24',action:'approve',applied:true,reasons:[long],text:long,attachments:['https://a','https://b'],photo:{label:'직접촬영'},photoCls:['camera']},
    {id:2,date:'2026-09-24',action:'hold',applied:false,reasons:['욕설','확인'],text:'본문',photo:{label:'판별 애매'},product_exact:'수분 크림',warn:'브랜드 조회 안 됨'},
  ]);
  const a=api.auditPayload('2026-09-24');
  const ap=a.items[0], ho=a.items[1];
  assert.equal(ap.reason.length,80); assert.equal(ap.text,undefined); assert.equal(ap.attachments,undefined);
  assert.equal(ho.reason,'욕설 · 확인'); assert.equal(ho.text,'본문'); assert.equal(ho.product_exact,'수분 크림'); assert.equal(ho.warn,'브랜드 조회 안 됨');
  assert.equal(a.schema,undefined);
  assert.ok(JSON.stringify(ap).length<400,'승인 1건 '+JSON.stringify(ap).length+'바이트');
});

/* ── 경험 쌓기 (2026-09-29) ─────────────────────────────── */
const ago=h=>new Date(Date.now()-h*3600e3).toISOString();
test('what a person did after the console gave up is learned for next time',async()=>{
  const {api,ctx}=harness(); api.setDate('2026-09-24');
  api.pendingRecord([{id:11,date:'2026-09-24',action:'register_product',brand:'앙쥬',product:'미러 블러 멜팅 에센스',exbak:true,brand_match:{id:9},reasons:['브랜드○ · 없음']},
                     {id:12,date:'2026-09-24',action:'register_product',brand:'앙쥬',product:'수분 크림',exbak:true,brand_match:{id:9},reasons:['x']},
                     {id:13,date:'2026-09-24',action:'hold',brand:'b',product:'p',reasons:['욕설']}]);
  assert.equal(Object.keys(api.pendingLoad()).length,3);
  ctx.__route=url=>{
    if(url.endsWith('/reviews/11')) return {status:200,body:{productId:501,productName:'미러링 블러 멜팅팟 에센스'}};
    return {status:404,body:{}};
  };
  const r=await api.learnFromWatch({
    '11':{status:'UPDATED',productName:'미러링 블러 멜팅팟 에센스',brandName:'앙쥬',visible:true,actor:'someone'},   /* 유저가 제품을 골랐다 */
    '12':{status:'REVISED',productName:'수분 크림',brandName:'앙쥬',visible:true,actor:'me@x'},                     /* CMS 에서 직접 요청 */
    '13':{status:'PENDING',productName:'p',brandName:'b',visible:false,actor:''}},'me@x');                      /* 미노출됨 */
  assert.equal(r.learned,1); assert.equal(r.sent,1); assert.equal(r.done,1);
  const h=api.histLoad(); const al=h.alias[api.aliasKey(9,'미러 블러 멜팅 에센스')];
  assert.equal(al.pid,501,'(브랜드, 유저 표기) → 유저가 고른 제품을 배운다');
  const pend=api.pendingLoad(); assert.equal(pend['11'].st,'learned'); assert.equal(pend['12'].st,'sent-manual'); assert.equal(pend['13'].st,'resolved');
  /* 다음에 같은 표기가 오면 이름이 전혀 안 비슷해도 바로 확정 */
  ctx.__route=url=> url.includes('/admin/products?') ? {status:200,body:{total:1,results:[{id:501,name:'미러링 블러 멜팅팟 에센스'}]}} : {status:404,body:{}};
  const again=await api.findProduct(9,'미러 블러 멜팅 에센스');
  assert.equal(again.confident,true); assert.equal(again.pick.id,501);
});

test('a product I just registered is paired with the waiting review, even with a loose name',()=>{
  const {api}=harness();
  const e={id:'21',ex:true,st:'open',b:'앙쥬',bid:9,p:'미러 블러 멜팅 에센스',since:ago(2)};
  const mine=[{id:501,name:'미러링 블러 멜팅팟 에센스',bid:9,bname:'앙쥬',at:ago(1)},
              {id:502,name:'데일리 선크림',bid:9,bname:'앙쥬',at:ago(1)},
              {id:503,name:'미러 블러 멜팅 에센스',bid:77,bname:'다른브랜드',at:ago(1)}];
  const a=api.associate([e],mine);
  assert.equal(a.length,1); assert.equal(a[0].p.id,501,'같은 브랜드, 대기 뒤에 등록한 제품');
  assert.equal(api.associate([Object.assign({},e,{since:ago(0)})],mine).length,0,'대기 전에 등록된 제품은 짝짓지 않는다');
  const twins=mine.concat([{id:504,name:'미러링 블러 멜팅팟 에센스 리필',bid:9,bname:'앙쥬',at:ago(1)}]);
  assert.equal(api.associate([e],twins).length,0,'비슷한 후보가 둘이면 사람에게');
  const cream={id:'22',ex:true,st:'open',b:'앙쥬',bid:9,p:'수분 크림',since:ago(2)};
  assert.equal(api.associate([cream],[{id:505,name:'수분 토너',bid:9,bname:'앙쥬',at:ago(1)}]).length,0,'종류가 다르면 짝짓지 않는다');
  assert.equal(api.associate([Object.assign({},e,{bid:null,b:'앙쥬(Anjou)'})],mine.slice(0,1)).length,1,'브랜드는 이름 표기 차이도 맞춘다');
});

test('recheck after registering: the fresh product is found even when search wording misses it',async()=>{
  const {api,ctx}=harness(); api.setMe('me@x');
  api.pendingRecord([{id:31,date:'2026-09-24',action:'register_product',brand:'앙쥬',product:'미러 블러 에센스',exbak:true,brand_match:{id:9},reasons:['없음']}]);
  ctx.__route=url=>{
    if(url.includes('/admin/brands?')) return {status:200,body:{total:1,results:[{id:9,name:'앙쥬',approved:true}]}};
    if(url.includes('/admin/products?') && url.includes('brandId=')) return {status:200,body:{total:0,results:[]}};   /* 검색어로는 안 걸림 */
    if(url.includes('/admin/products?')) return {status:200,body:{totalCount:1,results:[{id:601,name:'미러링 블러 멜팅팟 에센스',brand:{id:9,name:'앙쥬'},approvedAt:new Date().toISOString(),approvedBy:'ME@x'}]}};
    return {status:404,body:{}};
  };
  const r={id:31,action:'register_product',brand:'앙쥬',product:'미러 블러 에센스',reasons:[],approvable:false};
  const found=await api.recheckRegistered([r]);
  assert.equal(found.length,1); assert.equal(r.action,'revise_product'); assert.equal(r.product_id,601);
  assert.match(r.reasons.join(' '),/방금 등록한/);
});

test('experience coming back from the server is merged, not overwritten',()=>{
  const {api,store}=harness();
  const h=api.histLoad(); h.alias['1|a']={pid:1,name:'A',n:1,t:'2026-09-28'}; api.histSave(h);
  store['unpa-console-sent-v1']=JSON.stringify({'7':{action:'approve',at:'2026-09-28T00:00:00Z'}});
  store['unpa-console-manual-done-v1']=JSON.stringify({'8':{at:'2026-09-28T00:00:00Z'}});
  const ok=api.applyConsoleState({alias:{'2|b':{pid:2,name:'B',n:1,t:'2026-09-27'}},sent:{'9':{action:'hide',at:'2026-09-27T00:00:00Z',u:'x'}},
                                 done:{'8':{off:true,at:'2026-09-29T00:00:00Z'}},pending:{},texts:{},gate:[]});
  assert.equal(ok,true);
  const h2=api.histLoad(); assert.ok(h2.alias['1|a']&&h2.alias['2|b'],'이 컴퓨터에서 배운 것도, 다른 컴퓨터 것도');
  const sent=api.sentLoad(); assert.ok(sent['7']&&sent['9'],'다른 컴퓨터에서 보낸 것은 다시 안 보낸다');
  assert.equal(api.doneLoad()['8'],undefined,'다른 컴퓨터에서 해제한 완료 표시'); assert.equal(api.doneRaw()['8'].off,true);
});

test('remaining list follows CMS and old verdicts refill the waiting list for auto pairing',()=>{
  const {api,store}=harness();
  api.setBacklog([{date:'2026-09-20',rows:[{id:1,status:'PENDING',visible:true,brandName:'b',productName:'p'},{id:2,status:'PENDING',visible:true,brandName:'b',productName:'q',userBlocked:true}]}]);
  store['unpa-console-sent-v1']=JSON.stringify({'1':{action:'approve',at:new Date().toISOString()}});   /* 콘솔을 연 뒤 처리함 */
  const bl=api.backlogList();
  assert.equal(JSON.stringify(bl.map(x=>[x.id,x.blocked])),JSON.stringify([['2',true]]),'처리한 것은 빼고 넘긴다');
  const n=api.seedFromVerdicts({'10':{action:'register_brand',brand:'새브랜드',product:'새 크림',d:'2026-09-20',applied:false},
                                '11':{action:'approve',d:'2026-09-20'},'12':{action:'register_product',d:'2026-09-20',applied:true}});
  assert.equal(n,1);
  const e=api.pendingLoad()['10'];
  assert.equal(e.a,'register_brand'); assert.equal(e.ex,true); assert.equal(e.st,'open');
  assert.equal(e.since.slice(0,10)<= '2026-09-20',true,'리뷰 작성일 뒤에 등록한 제품과 짝지을 수 있게');
  assert.equal(api.seedFromVerdicts({'10':{action:'register_brand',d:'2026-09-20'}}),0,'이미 있으면 덮지 않는다');
});

/* ── 월 목표에 맞춰 승인 (2026-09-30) ─────────────────────── */
function goalCase(api){
  const now=new Date(), m=localYmd(now).slice(0,7), d=localYmd(now);
  const reviews={}; for(let i=0;i<2554;i++) reviews[String(100000+i)]=[d,'b','p',d];
  const products={}; for(let i=0;i<137;i++) products[String(500000+i)]=[d,'b','n'];
  api.setWork({reviews,products,failed:[],watch:{},mine:[],at:new Date().toISOString()});     /* 2554×500 + 137×600 = 1,359,200 */
  api.goalSave(snap({target:1430000,won:1359200}));
  const rows=[];
  for(let i=0;i<89;i++) rows.push({id:1000+i,action:'approve',approvable:true,conf:'high',date:'2026-09-2'+(i%9),reasons:[],user:'u'+i});
  for(let i=0;i<77;i++) rows.push({id:2000+i,action:'approve',approvable:true,conf:'check',date:(i<40?'2026-09-20':'2026-09-28'),reasons:[],user:'c'+i});
  rows.push({id:3000,action:'revise_product',product_exact:'X',product:'x',reasons:[]});
  api.setResults(rows);
  return rows;
}
test('only the approvals that fit the monthly target are planned: high confidence first, then the oldest',()=>{
  const {api}=harness(); const rows=goalCase(api);
  const b=api.budget();
  assert.equal(b.won,1359200); assert.equal(b.left,70800); assert.equal(b.approvals,141,'70,800원 ÷ 500 = 141건 (142건이면 초과)');
  api.planApprovals();
  const inPlan=rows.filter(r=>r.action==='approve'&&!r.deferred), out=rows.filter(r=>r.deferred);
  assert.equal(inPlan.length,141); assert.equal(out.length,25);
  assert.equal(inPlan.filter(r=>r.conf==='high').length,89,'고신뢰는 전부');
  assert.ok(out.every(r=>r.conf==='check'&&r.date==='2026-09-28'),'모자란 만큼 사람 확인 건을 오래된 작성일부터 채운다');
});
test('the run itself never crosses the target, and nothing is approved once it is reached',async()=>{
  const {api,sent}=harness(); api.setTpl(TPL); const rows=goalCase(api);
  const jobs=rows.filter(r=>r.action==='approve').concat(rows.filter(r=>r.action==='revise_product'));
  await api.runJobs(jobs);
  const approves=sent.filter(x=>/\/approve$/.test(x.url)).length, revises=sent.filter(x=>/\/revise$/.test(x.url)).length;
  assert.equal(approves,141,'166건 중 목표 안의 141건만 승인'); assert.equal(revises,1,'수정요청은 수입과 무관해 그대로');
  const after=api.budget();
  assert.equal(after.won,1429700,'방금 승인한 141건이 바로 수입에 반영'); assert.equal(after.left,300); assert.equal(after.approvals,0,'남은 300원으로는 더 승인하지 않는다');
});
test('with the target already reached, approvals are refused and kept for next month',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); const rows=goalCase(api);
  api.goalSave(snap({target:1359200,won:1359200}));
  await api.runJobs(rows.filter(r=>r.action==='approve').slice(0,5));
  assert.equal(sent.length,0); assert.match(ctx.__alert,/목표/);
  api.goalSave(snap({target:1430000,won:1400000}));
  assert.equal(api.budget().won,1400000); assert.equal(api.budget().approvals,60);
});

test('skipped cards are not offered again; the remaining slots go to other clean reviews',async()=>{
  const {api,ctx}=harness();
  const now=new Date(), m=localYmd(now).slice(0,7), d=localYmd(now);
  api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString()});
  api.goalSave(snap({target:2000,won:0}));                      /* 남은 2,000원 → 승인 4건 */
  const rows=[];
  for(let i=0;i<4;i++) rows.push({id:10+i,action:'approve',approvable:true,conf:'check',date:'2026-09-20',confWhy:['고해상도 직접촬영 사진 없음'],reasons:[],_gridSt:'skip'});   /* 사람이 건너뜀(따로 수정요청) */
  rows.push({id:20,action:'approve',approvable:true,conf:'check',date:'2026-09-22',confWhy:['다른 리뷰(#1)와 본문 거의 동일 — 복붙 의심','발색 제품 — 발색샷 확인'],reasons:[]});
  for(let i=0;i<5;i++) rows.push({id:30+i,action:'approve',approvable:true,conf:'check',date:'2026-09-28',confWhy:['본문 짧음(30자)'],reasons:[]});
  api.setResults(rows);
  const b=api.planApprovals();
  const chosen=rows.filter(r=>!r.deferred).map(r=>r.id).sort();
  assert.deepEqual(chosen,[30,31,32,33],'건너뛴 4건 대신, 이슈 적은 다른 4건 (복붙·발색 의심 #20 은 뒤로)');
  assert.ok(rows.filter(r=>r._gridSt==='skip').every(r=>r.deferred&&r.skipOut));
  assert.equal(b.skippedN,4);
  /* 그리드를 다시 열 때: 건너뛴 것 중 CMS 에서 수정요청된 것은 후보에서 아예 뺀다 */
  ctx.__route=url=> /\/reviews\/1[0-1]$/.test(url) ? {status:200,body:{status:'REVISED',visible:true}} : /\/reviews\/1[2-3]$/.test(url) ? {status:200,body:{status:'PENDING',visible:true}} : {status:404,body:{}};
  const n=await api.refreshSkipped();
  assert.equal(n,2); assert.equal(rows[0].approvable,false); assert.match(rows[0].reasons.join(' '),/이미 수정요청/);
  assert.equal(rows[2].approvable,true,'아직 대기 중인 건은 그대로(건너뜀 상태 유지)');
});

test('remaining counts per date leave out hidden and already handled reviews',()=>{
  const {api,store}=harness();
  const bl=[{date:'2026-10-08',rows:[{id:1,status:'PENDING',visible:true},{id:2,status:'UPDATED',visible:true},{id:3,status:'PENDING',visible:true,userBlocked:true},{id:4,status:'PENDING',visible:true}]},
            {date:'2026-10-06',rows:[]}];
  bl.all=bl.slice(); bl.at='2026-10-09T13:00:00Z';
  api.setBacklog(bl);
  store['unpa-console-sent-v1']=JSON.stringify({'4':{action:'approve',at:new Date().toISOString()}});     /* 콘솔을 연 뒤 승인함 */
  store['unpa-console-pending-v1']=JSON.stringify({'1':{id:'1',a:'register_product',st:'open',since:new Date().toISOString()}});
  const r=api.remainList();
  assert.equal(JSON.stringify(r.days['2026-10-08']),JSON.stringify({n:2,reg:1,upd:1,blocked:1}),'미노출·처리한 것·정지 사용자는 빼고 2건');
  assert.equal(r.days['2026-10-06'].n,0,'남은 게 없는 날도 넘겨 칸을 비우게 한다');
});

/* ── 미노출 판정 학습 (2026-10-09) ─────────────────────────── */
test('a hide the person corrected is learned; suspended users are never learned',()=>{
  const {api}=harness();
  const rows=[{id:1,action:'hide',reasons:['사진 전부 저해상/도용 의심'],_body:'정상 리뷰 본문 아주 길게 씀'},
              {id:2,action:'hide',reasons:['사진 전부 저해상/도용 의심'],_body:'또 다른 정상 리뷰'},
              {id:3,action:'hide',reasons:['정지 사용자 (누적 1회) — 검수 제외, 미노출'],_body:'x'},
              {id:4,action:'hide',reasons:['무성의한 리뷰 — 상투어만 있음 («좋아요»)'],_body:'좋아요 굿'},
              {id:5,action:'hide',reasons:['사진 전부 저해상/도용 의심'],_body:'세 번째'}];
  api.hideRecord(rows);
  assert.equal(Object.keys(api.hidefpLoad()).sort().join(','),'1,2,4,5','정지 사용자는 기억하지 않는다');
  /* 사람이 CMS 에서 정상 승인 (1,2) · 실수로 승인한 정지 사용자(3) · 실제 미노출(5) */
  const n=api.learnHides({'1':{status:'APPROVED',actor:'me',visible:true},'2':{status:'APPROVED',actor:'me',visible:true},
                          '3':{status:'APPROVED',actor:'me',visible:true},'5':{status:'PENDING',actor:'',visible:false}},'me');
  assert.equal(n,2);
  const fp=api.hidefpLoad(); assert.equal(fp['1'].st,'override'); assert.equal(fp['5'].st,'confirmed'); assert.equal(fp['3'],undefined);
  assert.ok(api.kindUnsure('photo-web'),'사진 저해상 판정: 정상 2 / 맞힘 1 → 자주 틀린 판정');
  assert.equal(api.kindUnsure('blocked'),null);
  /* 무성의 판정을 사람이 해제하면 같은 본문은 다음부터 미노출로 보지 않는다 */
  api.hidefpMark(rows[3],'override',true);
  assert.equal(api.hideOverridden(999,'좋아요 굿'),'같은 본문');
  assert.equal(api.hideOverridden(1,'아무 본문'),'이 리뷰');
});
test('an unchecked hide stays unchecked after re-rendering, and learned-unsure rules start unchecked',()=>{
  const {api}=harness(); api.setDate('2026-10-08');
  const a={id:21,action:'hide',exec:true,reasons:['무의미한 본문 — 자모 나열'],_body:'ㅁㄴㅇㄹ',date:'2026-10-08'};
  const b={id:22,action:'hide',exec:true,reasons:['무의미한 본문 — 자모 나열'],_body:'ㅂㅈㄷㄱ',date:'2026-10-08'};
  api.setResults([a,b]); api.renderQueue('2026-10-08');
  assert.equal(a._unchecked,false); assert.equal(b._unchecked,false);
  api.setUncheck(21,true); a._unchecked=undefined;
  api.renderQueue('2026-10-08'); api.renderQueue('2026-10-08');
  assert.equal(a._unchecked,true,'다른 일을 해서 다시 그려도 해제 유지'); assert.equal(b._unchecked,false);
  /* 새로 스캔해 결과가 새 객체여도: 사람이 정상으로 본 리뷰는 해제된 채로 */
  api.hidefpMark(a,'override',true);
  const a2=Object.assign({},a,{_unchecked:undefined}); api.setUncheck(21,undefined);
  api.setResults([a2]); api.renderQueue('2026-10-08');
  assert.equal(a2._unchecked,true);
});

test('with no known monthly goal the console sends no approvals (revise/hide still go)',async()=>{
  const {api,sent,ctx}=harness({noGoal:true}); api.setTpl(TPL); api.setDate('2026-09-02');
  ctx.__route=(url,init)=> (init.method==='POST'||init.method==='PUT') ? {status:201,body:{ok:true}} : {status:404,body:{}};
  const a={id:21,action:'approve',reasons:[]}, h={id:22,action:'hide',reasons:[]};
  api.setResults([a,h]);
  await api.runJobs([a]);
  assert.equal(sent.length,0,'승인만 있으면 한 건도 보내지 않는다');
  assert.match(ctx.__alert,/목표 금액을 확인할 수 없어 승인은 하지 않습니다/);
  await api.runJobs([a,h]);
  assert.equal(sent.filter(x=>/\/approve$/.test(x.url)).length,0,'승인은 빠지고');
  assert.equal(sent.filter(x=>x.method==='PUT').length,1,'미노출은 나간다');
  assert.equal(a.deferred,true);
});

/* ── Claude 도구(cms-claude.js)와 한 목표를 나눠 쓴다 (2026-10-18) ── */
test('the console budget comes from the shared guard: snapshot + everything either tool did after the count',()=>{
  const {api,store}=harness();
  api.goalSave(snap({target:1430000,won:1359200,ids:{r:['old'],p:[]}}));   /* 'old' 는 업무일지 합계에 이미 들어간 리뷰 */
  const now=Date.now();
  store['unpa-claude-ledger-v1']=JSON.stringify({v:1,items:{'r:777':{k:'r',t:now-20e3},'p:무드|다비치|1':{k:'p',t:now-10e3},'r:old':{k:'r',t:now-3*3600e3}}});
  const b=api.budget();
  assert.equal(b.known,true); assert.equal(b.won,1359200+1100,'스냅샷 위에 Claude 승인 500 + 제품 600 (예전처럼 큰 쪽 하나로 덮지 않는다)');
  assert.equal(b.left,70800-1100); assert.equal(b.approvals,Math.floor((70800-1100)/500));
});

test('no snapshot, last month, partial or stale snapshot → the console does not know the income and approves nothing',async()=>{
  for(const g of [null, snap({month:'2000-01'}), snap({partial:true}), snap({countedAt:new Date(Date.now()-2*3600e3).toISOString()})]){
    const {api,sent,ctx,store}=harness({noGoal:true}); api.setTpl(TPL); api.setDate('2026-09-02');
    if(g) api.goalSave(g);
    assert.equal(api.budget().known,false);
    await api.runJobs([{id:31,action:'approve',reasons:[]}]);
    assert.equal(sent.length,0); assert.match(ctx.__alert,/승인은 하지 않습니다/);
    assert.equal(Object.keys(store).filter(k=>k.indexOf('unpa-claude-ledger-v1')===0).length,0,'아무것도 예약하지 않는다');
  }
});

test('the console reserves each approval in the shared ledger right before sending, so Claude working in another tab cannot overspend',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:2000,won:0}));                       /* 4건 분량 */
  const jobs=[1,2,3,4].map(i=>({id:40+i,action:'approve',reasons:[]}));
  api.setResults(jobs);
  let n=0;
  ctx.__route=(url,init)=>{ if(/\/approve$/.test(url)){ n++; if(n===1){ assert.equal(ctx.UnpaGuard.reserve('r','claude-1').ok,true); assert.equal(ctx.UnpaGuard.reserve('r','claude-2').ok,true); } }
                            return {status:201,body:{ok:true}}; };   /* 첫 전송 중에 Claude 가 2건을 써 버림 */
  await api.runJobs(jobs);
  const approves=sent.filter(x=>/\/approve$/.test(x.url)).length;
  assert.equal(approves,2,'콘솔 2 + Claude 2 = 4건 — 목표 2,000원을 넘지 않는다');
  assert.equal(ctx.UnpaGuard.status().ok,false); assert.equal(ctx.UnpaGuard.status().won,2000);
  assert.equal(jobs.filter(r=>r.deferred).length,2,'남은 2건은 남겨 둔다');
});

test('a console approve the server refuses (4xx) is taken back; an unclear one (5xx) stays counted',async()=>{
  const {api,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:100000,won:0}));
  ctx.__route=(url)=> /\/51\/approve$/.test(url) ? {status:400,body:{message:'x'}} : /\/52\/approve$/.test(url) ? {status:502,body:{}} : {status:201,body:{}};
  await api.runJobs([{id:51,action:'approve',reasons:[]}]);
  assert.equal(ctx.UnpaGuard.status().spent,0,'거절된 건은 수입에서 뺀다');
  await api.runJobs([{id:52,action:'approve',reasons:[]}]);
  assert.equal(ctx.UnpaGuard.status().spent,500,'됐을 수도 있는 건은 센 채로 둔다');
});

test('once the guard has stopped the month, the console approves nothing either',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:1000,won:900}));
  assert.equal(ctx.UnpaGuard.reserve('p','x|y|1').ok,false);    /* 600 → 초과 → 정지 */
  const b=api.budget(); assert.equal(b.known,true); assert.equal(b.approvals,0); assert.equal(b.halted,true);
  await api.runJobs([{id:61,action:'approve',reasons:[]}]);
  assert.equal(sent.length,0); assert.match(ctx.__alert,/목표 직전에서 멈춘 상태/);
});

test('any failed CMS date (or product list) makes this month partial in the payload',()=>{
  const {api}=harness();
  const st=new Date(Date.now()-5*60e3).toISOString();
  api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  let p=api.workPayload();
  assert.equal(p.countedAt,st); assert.equal(p.monthPartial,false); assert.ok(Date.parse(p.builtAt)>=Date.parse(st));
  api.setWork({reviews:{},products:{},failed:['2026-08-30'],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  assert.equal(api.workPayload().monthPartial,true,'지난달에 작성된 리뷰도 이번 달에 승인됐을 수 있다');
});

test('after a sync the goal snapshot carries the count time, build time and partial flag, and the guard trusts it',()=>{
  const {api,ctx}=harness({noGoal:true}); api.setDate('2026-09-24');
  const st=new Date(Date.now()-90e3).toISOString();
  api.setMe('me@example.com'); api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  const posted=[]; const win={postMessage:(m,o)=>posted.push([m,o])};
  ctx.__open=()=>win;
  assert.equal(api.syncNow(),true);
  const nonce=/#n=([a-f0-9]+)/.exec(ctx.__opened[0])[1];
  const fire=data=>ctx.__listeners.slice().forEach(f=>f({origin:'https://moowillbedone.github.io',source:win,data}));
  fire({type:'unpa-sync-ready',nonce});
  const pl=posted[0][0].payload;
  const m=new Date(Date.now()+9*3600e3).toISOString().slice(0,7);
  fire({type:'unpa-sync-done',nonce,ok:true,seq:pl.seq,today:{r:0,p:0},goal:{month:m,target:1430000,r:0,p:0,won:900000,ids:{r:['5'],p:[]}}});
  const g=JSON.parse(ctx.localStorage.getItem('unpa-console-goal-v2'));
  assert.equal(g.countedAt,st); assert.equal(g.builtAt,pl.builtAt); assert.equal(g.partial,false); assert.deepEqual(g.ids.r,['5']);
  const s=ctx.UnpaGuard.status(); assert.equal(s.ok,true); assert.equal(s.won,900000); assert.equal(s.left,530000);
});

test('a sync built on an older CMS count does not overwrite a newer goal snapshot left by another tab',()=>{
  const {api,ctx}=harness({noGoal:true}); api.setDate('2026-09-24');
  const m=new Date(Date.now()+9*3600e3).toISOString().slice(0,7);
  const newer=snap({won:910000,countedAt:new Date(Date.now()-20e3).toISOString()});
  api.goalSave(newer);
  const st=new Date(Date.now()-90e3).toISOString();
  api.setMe('me@example.com'); api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  const posted=[]; const win={postMessage:(mm,o)=>posted.push([mm,o])};
  ctx.__open=()=>win;
  assert.equal(api.syncNow(),true);
  const nonce=/#n=([a-f0-9]+)/.exec(ctx.__opened[0])[1];
  const fire=data=>ctx.__listeners.slice().forEach(f=>f({origin:'https://moowillbedone.github.io',source:win,data}));
  fire({type:'unpa-sync-ready',nonce});
  fire({type:'unpa-sync-done',nonce,ok:true,seq:posted[0][0].payload.seq,today:{r:0,p:0},goal:{month:m,target:1430000,r:0,p:0,won:900000,ids:{r:[],p:[]}}});
  const g=JSON.parse(ctx.localStorage.getItem('unpa-console-goal-v2'));
  assert.equal(g.won,910000,'더 최근 집계로 만든 스냅샷이 남는다'); assert.equal(g.countedAt,newer.countedAt);
});

test('a console approve refused with 4xx keeps the reservation when the Claude tab joined it meanwhile (it may have approved the review itself)',async()=>{
  const {api,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:100000,won:0}));
  ctx.__route=(url)=>{ if(/\/71\/approve$/.test(url)){ assert.equal(ctx.UnpaGuard.reserve('r','71').again,true); return {status:400,body:{message:'already approved'}}; } return {status:201,body:{}}; };
  await api.runJobs([{id:71,action:'approve',reasons:[]}]);
  assert.equal(ctx.UnpaGuard.status().spent,500,'함께 쓴 예약은 지우지 않는다 — 수입에 센 채로 둔다');
});

test('a revise request the console sent clears a leftover (unclear) approval reservation of that review',async()=>{
  const {api,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:100000,won:0}));
  ctx.__route=(url)=> /\/81\/approve$/.test(url) ? {status:502,body:{}} : {status:201,body:{}};
  await api.runJobs([{id:81,action:'approve',reasons:[]}]);
  assert.equal(ctx.UnpaGuard.status().spent,500,'애매한 승인은 센 채로');
  await api.runJobs([{id:81,action:'revise_swatch',reasons:[],brand:'b',product:'p'}]);
  assert.equal(ctx.UnpaGuard.status().spent,0,'수정요청이 나갔으면 승인되지 않은 리뷰 — 예약을 지운다');
});

test('a goal snapshot the guard would refuse (future count time) is replaced by the next sync instead of being protected',()=>{
  const {api,ctx}=harness({noGoal:true}); api.setDate('2026-09-24');
  const m=new Date(Date.now()+9*3600e3).toISOString().slice(0,7);
  api.goalSave(snap({won:910000,countedAt:new Date(Date.now()+3*3600e3).toISOString()}));   /* 시계가 3시간 빨랐을 때 남은 것 */
  const st=new Date(Date.now()-90e3).toISOString();
  api.setMe('me@example.com'); api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  const posted=[]; const win={postMessage:(mm,o)=>posted.push([mm,o])};
  ctx.__open=()=>win;
  assert.equal(api.syncNow(),true);
  const nonce=/#n=([a-f0-9]+)/.exec(ctx.__opened[0])[1];
  const fire=data=>ctx.__listeners.slice().forEach(f=>f({origin:'https://moowillbedone.github.io',source:win,data}));
  fire({type:'unpa-sync-ready',nonce});
  fire({type:'unpa-sync-done',nonce,ok:true,seq:posted[0][0].payload.seq,today:{r:0,p:0},goal:{month:m,target:1430000,r:0,p:0,won:900000,ids:{r:[],p:[]}}});
  const g=JSON.parse(ctx.localStorage.getItem('unpa-console-goal-v2'));
  assert.equal(g.countedAt,st); assert.equal(ctx.UnpaGuard.status().ok,true);
});

test('only one CMS count runs at a time: asking again while one is running waits for it',async()=>{
  const {api,ctx}=harness(); api.setMe('me@example.com');
  let gets=0; ctx.__route=(url)=>{ if(/\/admin\/reviews\?/.test(url)) gets++; return {status:200,body:{results:[],totalCount:0}}; };
  const p1=api.startWorkSync(), p2=api.startWorkSync();
  assert.equal(p1,p2,'같은 작업을 돌려준다');
  await p1.catch(()=>{});
  const one=gets; const p3=api.startWorkSync(); assert.notEqual(p3,p1,'끝난 뒤에는 새로 시작한다'); await p3.catch(()=>{});
  assert.ok(gets>=one);
});

test('after the CMS count, a leftover approval reservation for a review the count saw as not approved by me is dropped',async()=>{
  const {api,ctx}=harness(); api.setMe('me@example.com');
  api.goalSave(snap({target:100000,won:0}));
  ctx.localStorage.setItem('unpa-claude-ledger-v1',JSON.stringify({v:1,items:{'r:555':{k:'r',t:Date.now()-3600e3,src:'c'},'r:556':{k:'r',t:Date.now()-3600e3}}}));
  assert.equal(ctx.UnpaGuard.status().spent,1000);
  ctx.__route=(url)=>{
    if(/\/admin\/reviews\?/.test(url)) return {status:200,body:{results:/startDate=(\d{4}-\d\d-\d\d)/.exec(url)[1]===api.workPayload().work.to?[{id:555,status:'PENDING_APPROVAL',createdAt:new Date().toISOString()}]:[],totalCount:0}};
    return {status:200,body:{results:[],totalCount:0}};
  };
  await api.startWorkSync();
  const items=ctx.UnpaGuard.ledger().items;
  assert.deepEqual(Object.keys(items),['r:556'],'집계가 대기로 본 555 는 지우고, 집계가 못 본 556 은 남긴다');
});

test('a console still holding an older guard (no reserveSafe) approves nothing instead of reserving the old way',async()=>{
  const {api,sent,ctx}=harness(); api.setTpl(TPL); api.setDate('2026-09-02');
  api.goalSave(snap({target:100000,won:0}));
  const G=ctx.UnpaGuard; ctx.UnpaGuard={status:G.status,line:G.line,reserve:G.reserve,release:G.release,RATE:G.RATE};   /* 예전 버전처럼 */
  await api.runJobs([{id:91,action:'approve',reasons:[]}]);
  assert.equal(sent.filter(x=>/\/approve$/.test(x.url)).length,0);
});

test('a sync stores the goal under the new key and blocks the old key, using the later of this count and the merged count time',()=>{
  const {api,ctx}=harness({noGoal:true}); api.setDate('2026-09-24');
  const st=new Date(Date.now()-20*60e3).toISOString(), other=new Date(Date.now()-5*60e3).toISOString();
  api.setMe('me@example.com'); api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],at:new Date().toISOString(),startedAt:st});
  const posted=[]; const win={postMessage:(mm,o)=>posted.push([mm,o])};
  ctx.__open=()=>win;
  assert.equal(api.syncNow(),true);
  const nonce=/#n=([a-f0-9]+)/.exec(ctx.__opened[0])[1];
  const fire=data=>ctx.__listeners.slice().forEach(f=>f({origin:'https://moowillbedone.github.io',source:win,data}));
  fire({type:'unpa-sync-ready',nonce});
  const pl=posted[0][0].payload; assert.ok(/^[0-9a-z]+$/.test(pl.acct),'계정은 해시로만'); assert.ok(pl.acct.indexOf('@')<0);
  const m=new Date(Date.now()+9*3600e3).toISOString().slice(0,7);
  fire({type:'unpa-sync-done',nonce,ok:true,seq:pl.seq,today:{r:0,p:0},goal:{month:m,target:1430000,r:0,p:0,won:900000,ids:{r:[],p:[]},countedAt:other}});
  const g=JSON.parse(ctx.localStorage.getItem('unpa-console-goal-v2'));
  assert.equal(g.countedAt,other,'다른 기기가 더 나중에 센 시각을 기준으로');
  const old=JSON.parse(ctx.localStorage.getItem('unpa-console-goal-v1'));
  assert.equal(old.partial,true); assert.equal(old.countedAt,null,'예전 키는 막아 둔다');
});
