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
  const el=()=>({style:{},onclick:null,appendChild(){},remove(){},click(){},querySelectorAll:()=>[],
                 querySelector:()=>null,insertBefore(){},set innerHTML(v){},get innerHTML(){return '';},
                 dataset:{},classList:{contains:()=>false},parentNode:{insertBefore(){}}});
  const ctx={
    location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me',search:''},
    document:{getElementById:()=>el(),createElement:el,body:{appendChild(){}},
              querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{constructor(){}get(){return null;}},
    Blob:class{constructor(p){this.parts=p;}},Image:class{},
    URL:Object.assign(function(u,b){return new URL(u,b);},
        {createObjectURL:()=>'blob:stub',revokeObjectURL(){},prototype:URL.prototype}),
    AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    alert:m=>{ctx.__alert=m;},confirm:()=>ctx.__confirm!==false,
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
