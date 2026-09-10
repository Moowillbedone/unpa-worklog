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
                             const payload='{"status":"APPROVED","templates":[]}';
                             return {status:201,text:async()=>payload,json:async()=>JSON.parse(payload)}; },
  };
  ctx.window=ctx; ctx.XMLHttpRequest=XHR;
  vm.createContext(ctx);
  vm.runInContext(code.replace('  /* ── 시작 ── */',
    `globalThis.api={buildReq,runJobs,sentLoad,CAP,setResults:r=>{results=r;},
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
