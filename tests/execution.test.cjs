const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function harness(){
  const ids={},storage=new Map(),sent=[],alerts=[];
  class Element{
    constructor(){this.style={};this.children=[];this.dataset={};this.classList={contains:()=>false};}
    set innerHTML(s){this.html=s;for(const m of s.matchAll(/id="([^"]+)"/g)){const e=new Element();e.parentNode=this;ids[m[1]]=e;}}
    get innerHTML(){return this.html||'';}
    appendChild(e){this.children.push(e);e.parentNode=this;if(e.id)ids[e.id]=e;return e;}
    insertBefore(e){return this.appendChild(e);}
    remove(){if(this.id)delete ids[this.id];}
    querySelector(){return null;}
    querySelectorAll(){return [];}
    click(){}
  }
  function XHR(){}XHR.prototype.open=function(){};XHR.prototype.setRequestHeader=function(){};
  const ctx={location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me'},window:{fetch:()=>{throw Error('Network prohibited');}},document:{body:new Element(),createElement:()=>new Element(),getElementById:id=>ids[id]||null},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},XMLHttpRequest:XHR,alert:x=>alerts.push(x),confirm:()=>false,URL,Blob,AbortController,setTimeout:()=>0,clearTimeout:()=>{},crypto:require('node:crypto').webcrypto};
  vm.createContext(ctx);const source=fs.readFileSync(require.resolve('../cms-console.js'),'utf8').split('  /* ── 시작 ── */')[0];
  vm.runInContext(source+`;globalThis.api={runJobs,openGrid,auditPayload,scan,renderQueue,set(rows){results=rows;SCAN_DATE='2026-09-02';},mock(g,s){get=g;send=s;delay=async()=>{};dl=()=>{};tplMap={swatch:{body:'발색샷 요청'},product_match:{body:'{제품명} 재선택'}};},get rows(){return results;}};})();`,ctx);
  const detail={id:1,contentText:'촉촉해요',productId:2};
  ctx.api.mock(async()=>({status:200,json:detail}),async(...args)=>{sent.push(args);return {status:201,json:{id:1,status:'APPROVED'}};});
  const row={id:1,brand:'브랜드',product:'쿠션',action:'hold',approvable:true,attachments:[],reasons:[],snapshot:JSON.stringify(detail)};
  ctx.api.set([row]);return {ctx,ids,storage,sent,alerts,row,detail};
}
test('grid defaults to skip and preserves swatch selection on reopen',()=>{
  const h=harness();h.ctx.api.openGrid();assert.match(h.ids.gGo.textContent,/검수완료 0 · 발색샷 0/);
  h.ids.gX.onclick();h.row.selection='swatch';h.ctx.api.openGrid();assert.match(h.ids.gGo.textContent,/검수완료 0 · 발색샷 1/);
});
test('cancelled execution does not mutate verdict or transmit',async()=>{
  const h=harness();await h.ctx.api.runJobs([{...h.row,action:'approve',humanVerified:true}]);
  assert.equal(h.row.action,'hold');assert.equal(h.sent.length,0);assert.equal(h.storage.size,0);
});
test('unverified approval is rejected even if manually passed to executor',async()=>{
  const h=harness();h.ctx.confirm=()=>true;await h.ctx.api.runJobs([{...h.row,action:'approve'}]);assert.equal(h.sent.length,0);
});
test('successful execution is journaled and cannot execute twice',async()=>{
  const h=harness();h.ctx.confirm=()=>true;const job={...h.row,action:'approve',humanVerified:true};
  await h.ctx.api.runJobs([job]);assert.equal(h.sent.length,1);assert.equal(h.row.applied,true);
  assert.equal(JSON.parse(h.storage.get('unpa-console-journal-v2'))['1'].state,'success');
  await h.ctx.api.runJobs([job]);assert.equal(h.sent.length,1);assert.equal(h.ctx.window.__CONSOLE_RUNNING,false);
});
test('changed detail blocks sending',async()=>{
  const h=harness();h.ctx.confirm=()=>true;h.ctx.api.mock(async()=>({status:200,json:{...h.detail,contentText:'changed'}}),async()=>{throw Error('must not send');});
  await h.ctx.api.runJobs([{...h.row,action:'hide'}]);assert.equal(h.storage.has('unpa-console-journal-v2'),false);assert.equal(h.ctx.window.__CONSOLE_RUNNING,false);
});
test('lost response is persisted as uncertain and blocks retry',async()=>{
  const h=harness();h.ctx.confirm=()=>true;let n=0;
  h.ctx.api.mock(async()=>({status:200,json:h.detail}),async()=>{n++;return {status:0,text:'timeout'};});
  const job={...h.row,action:'hide'};await h.ctx.api.runJobs([job]);await h.ctx.api.runJobs([job]);
  assert.equal(n,1);assert.equal(JSON.parse(h.storage.get('unpa-console-journal-v2'))['1'].state,'uncertain');
});
test('storage failure stops before CMS send',async()=>{
  const h=harness();h.ctx.confirm=()=>true;h.ctx.localStorage.setItem=()=>{throw Error('quota');};
  await h.ctx.api.runJobs([{...h.row,action:'hide'}]);assert.equal(h.sent.length,0);assert.equal(h.ctx.window.__CONSOLE_RUNNING,false);
});
test('HTTP 200 without verified result is not counted as success',async()=>{
  const h=harness();h.ctx.confirm=()=>true;
  h.ctx.api.mock(async()=>({status:200,json:h.detail}),async()=>({status:200,json:{ok:true}}));
  await h.ctx.api.runJobs([{...h.row,action:'approve',humanVerified:true}]);
  assert.equal(h.row.applied,false);assert.equal(JSON.parse(h.storage.get('unpa-console-journal-v2'))['1'].state,'uncertain');
});
