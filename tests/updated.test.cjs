/* 유저 수정완료(UPDATED) 건 — 콘솔 "수정완료만 검토" · 업무일지 배지 · 걷어낸 Tampermonkey 자동 동기화 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

/* cms-console.js 를 가짜 CMS 창에서 돌린다 — 네트워크는 전부 가짜, 시작 직전에 내부 함수를 꺼낸다 */
function consoleCtx(opts){
  opts=opts||{};
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const attrs=Object.assign({},opts.attrs||{}), fetched=[], appended=[], posted=[];
  const el=()=>({style:{},onclick:null,appendChild(){},remove(){},click(){},querySelectorAll:()=>[],addEventListener(){},
                 querySelector:()=>null,set innerHTML(v){},get innerHTML(){return '';},dataset:{},classList:{contains:()=>false}});
  const store={};
  const ctx={
    location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me',search:'',hash:'',pathname:'/review/list/all'},
    document:{documentElement:{hasAttribute:k=>k in attrs,getAttribute:k=>k in attrs?attrs[k]:null,removeAttribute:k=>{delete attrs[k];},setAttribute:(k,v)=>{attrs[k]=v;}},
              getElementById:()=>el(),createElement:el,body:{appendChild:x=>appended.push(x)},head:{appendChild(){}},querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{get(){return null;}},URL,AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    WorklogCore:require('../worklog-core.js'),crypto:globalThis.crypto,alert:m=>{ctx.__alert=m;},confirm:()=>true,
    addEventListener(){},removeEventListener(){},open:()=>null,postMessage:(m,o)=>posted.push([m,o]),
    fetch:async url=>{ fetched.push(String(url)); const t='{"results":[],"templates":[]}'; return {status:200,text:async()=>t,json:async()=>JSON.parse(t)}; },
  };
  ctx.window=ctx; ctx.XMLHttpRequest=function(){}; ctx.XMLHttpRequest.prototype={open(){},setRequestHeader(){}};
  vm.createContext(ctx);
  const src=opts.expose ? code.replace('  /* ── 시작 ── */','  globalThis.api={updatedRows,scanUpdated,backlogTodo,getLabel:()=>SCAN_LABEL,getDate:()=>SCAN_DATE};\n  /* ── 시작 ── */') : code;
  vm.runInContext(src,ctx);
  return {ctx,attrs,fetched,appended,posted};
}

test('a leftover Tampermonkey run marker makes the console exit silently',async()=>{
  const {attrs,fetched,appended,posted,ctx}=consoleCtx({attrs:{'data-unpa-autosync-run':'a'.repeat(32)}});
  await new Promise(r=>setTimeout(r,50));
  assert.equal(attrs['data-unpa-autosync-run'],undefined,'표시는 지운다');
  assert.equal(appended.length,0,'콘솔 카드를 띄우지 않는다');
  assert.equal(fetched.length,0,'CMS 를 조회하지도 않는다');
  assert.equal(ctx.__alert,undefined);
  /* 옛 스크립트가 30분 쉬도록 '끝났다'(빈 결과)를 알린다 — 실패 신호를 보내면 1분마다 다시 부른다 */
  assert.equal(posted.length,1);
  assert.equal(JSON.stringify(posted[0]),JSON.stringify([{type:'unpa-auto-payload',nonce:'a'.repeat(32),payload:null},'https://cms.unpa.me']));
});

test('the retired userscript does nothing on either site',()=>{
  const code=fs.readFileSync(path.join(root,'unpa-autosync.user.js'),'utf8');
  const head=code.split('// ==/UserScript==')[0];
  assert.match(head,/@version\s+1\.1\.0/);
  assert.match(head,/@grant\s+none/);
  assert.match(head,/@updateURL\s+https:\/\/moowillbedone\.github\.io\/unpa-worklog\/unpa-autosync\.user\.js/,'설치된 사본이 이 빈 버전으로 업데이트되게 주소는 그대로');
  for(const host of ['cms.unpa.me','moowillbedone.github.io']){
    const touched=[];
    const ctx={location:{hostname:host,pathname:'/unpa-worklog/'},
      document:new Proxy({},{get:(o,k)=>{ touched.push('document.'+String(k)); return undefined; }}),
      setTimeout:()=>touched.push('setTimeout'),setInterval:()=>touched.push('setInterval'),
      addEventListener:()=>touched.push('addEventListener')};
    ctx.window=ctx; vm.createContext(ctx); vm.runInContext(code,ctx);
    assert.deepEqual(touched,[],host+' 에서 아무것도 건드리지 않는다');
  }
});

test('"수정완료만 검토" picks only UPDATED reviews (with their written date) and does not scan when there are none',async()=>{
  const {ctx}=consoleCtx({expose:true});
  const backlog=[
    {date:'2026-10-12',rows:[{id:1,status:'UPDATED'},{id:2,status:'PENDING'}]},
    {date:'2026-09-30',rows:[{id:3,status:'UPDATED'},{id:4,status:'UPDATED'}]},
    {date:'2026-10-10',rows:[{id:5,status:'PENDING'}]},
  ];
  const rows=ctx.api.updatedRows(backlog);
  assert.equal(JSON.stringify(rows.map(x=>[x.id,x._date])),JSON.stringify([[1,'2026-10-12'],[3,'2026-09-30'],[4,'2026-09-30']]));
  /* 수정완료가 하나도 없으면 스캔하지 않고 알린다 */
  await ctx.api.scanUpdated([{date:'2026-10-10',rows:[{id:9,status:'PENDING'}]}]);
  assert.match(ctx.__alert,/수정완료된 리뷰가 없습니다/);
});

test('the worklog badge counts only UPDATED reviews and leaves out suspended users',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const fn=html.split('function updatedReviews(){')[1].split('\nfunction renderUpdList')[0];
  const store={};
  const ctx={localStorage:{getItem:k=>store[k]===undefined?null:store[k]},JSON,Array};
  vm.createContext(ctx); vm.runInContext('function updatedReviews(){'+fn+';globalThis.f=updatedReviews;',ctx);
  assert.equal(ctx.f().list.length,0,'아직 동기화 전이면 0');
  store['unpa-pending-v1']=JSON.stringify({at:'2026-10-14T00:00:00Z',items:[],backlog:[
    {id:'1',d:'2026-10-12',status:'UPDATED'},{id:'2',d:'2026-10-12',status:'PENDING'},
    {id:'3',d:'2026-09-30',status:'UPDATED',blocked:true},{id:'4',d:'2026-08-22',status:'UPDATED'}]});
  const r=ctx.f();
  assert.equal(JSON.stringify(r.list.map(x=>x.id)),'["1","4"]');
  assert.equal(r.at,'2026-10-14T00:00:00Z');
  store['unpa-pending-v1']=JSON.stringify({at:'x',items:[],backlog:null});
  assert.equal(ctx.f().list.length,0,'남은 목록을 못 불러온 동기화면 0');
});

test('a revise the console just sent drops that review from the 수정완료 list until CMS is listed again',()=>{
  const {ctx}=consoleCtx({expose:true});
  const listAt='2026-10-14T10:00:00.000Z';
  const rows=[{id:1,status:'UPDATED'},{id:2,status:'UPDATED'},{id:3,status:'PENDING'},{id:4,status:'UPDATED'},{id:5,status:'UPDATED',visible:false}];
  const sent={
    '1':{action:'revise_product',at:'2026-10-12T09:00:00.000Z'},   /* 예전에 보냄 → 유저가 고쳤다 → 다시 검토 */
    '2':{action:'revise_product',at:'2026-10-14T10:05:00.000Z'},   /* 목록을 받은 뒤 방금 또 보냄 → 빠진다 */
    '4':{action:'approve',at:'2026-10-12T09:00:00.000Z'},
  };
  const ids=r=>JSON.stringify(r.map(x=>x.id));
  assert.equal(ids(ctx.api.backlogTodo(rows,sent,listAt)),'[1,3]');
  assert.equal(ids(ctx.api.backlogTodo(rows,sent)),'[1,2,3]','목록을 받는 순간(시각 없이)은 예전 규칙 그대로');
});
