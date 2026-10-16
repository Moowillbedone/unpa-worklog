/* 검수 예외 '무시' · '복원' — 업무일지 탭, ✏️ 배지, 동기화 창, 검수 콘솔까지 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

/* index.html 의 검수 예외 블록만 떼어 가짜 화면에서 돌린다 */
function excCtx(items){
  const start=html.indexOf("  var XK='unpa-exceptions-v1';");
  const endMark="  window.addEventListener('storage', function(e){ if(e.key===XK) renderExc(); });";
  const end=html.indexOf(endMark,start)+endMark.length;
  assert.ok(start>0&&end>start,'검수 예외 블록을 찾지 못함');
  const store={'unpa-exceptions-v1':JSON.stringify({v:1,items})};
  const els={}, handlers={}, toasts=[];
  const el=id=>els[id]||(els[id]={id,innerHTML:'',addEventListener:(t,f)=>{ handlers[id+':'+t]=f; }});
  const ctx={
    localStorage:{getItem:k=>store[k]===undefined?null:store[k],setItem:(k,v)=>{store[k]=String(v);}},
    document:{getElementById:el},
    toast:(m,err)=>toasts.push(m),
    esc:x=>String(x==null?'':x).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[m]),
    jget:k=>{ try{ return JSON.parse(store[k]||'null'); }catch(e){ return null; } },
    md:k=>(+k.slice(5,7))+'/'+(+k.slice(8,10)),
    SB:null,SB_USER:null,JSON,Object,String,Date,Promise,isFinite,
    badge:0,
  };
  ctx.window=ctx; ctx.addEventListener=()=>{};
  ctx.renderUpdBadge=()=>{ ctx.badge++; };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start,end)+'\nrenderExc();\nglobalThis.__tab=function(t){ XTAB=t; renderExc(); };',ctx);
  const click=(id,on,detail)=>handlers['excBody:click']({detail:detail||1,target:{closest:()=>({dataset:{xign:id,on:on?'1':'0'}})}});
  const tabs=()=>{ const m={}; els.excTabs.innerHTML.replace(/data-xtab="(\w+)">[^<]*<span class="n">(\d+)/g,(_,k,n)=>{ m[k]=+n; }); return m; };
  return {ctx,store,els,click,tabs,toasts,items:()=>JSON.parse(store['unpa-exceptions-v1']).items};
}
const base={
  '478039':{id:'478039',d:'2026-09-30',kind:'other',status:'hold',brand:'헤라',product:'페이스 글로우 하이라이터',reason:'증정용',at:'2026-10-14T00:00:00Z'},
  '481077':{id:'481077',d:'2026-10-10',kind:'other',status:'hold',brand:'올리브영',product:'바디브러쉬',reason:'자판 난타',at:'2026-10-14T00:00:00Z'},
  '481030':{id:'481030',d:'2026-10-10',kind:'overseas',status:'done',brand:'더마 씨루어',product:'아이크림',reason:'승인',at:'2026-10-14T00:00:00Z'},
};

test('the 검수 예외 tabs are 보류 / 처리 완료 / 도용 / 전체 / 무시, and 무시 moves a row out of 보류 into its own tab',()=>{
  const t=excCtx(JSON.parse(JSON.stringify(base)));
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:1,plag:0,all:3,ign:0}));
  assert.match(t.els.excBody.innerHTML,/data-xign="478039" data-on="1"[^>]*>무시</);
  t.click('478039',true);
  const x=t.items()['478039'];
  assert.equal(x.ign,true); assert.equal(x.ignBy,'user'); assert.equal(x.status,'hold','상태는 그대로 둔다');
  assert.equal(x.at,'2026-10-14T00:00:00Z','상태 시각은 그대로 — 다른 기기에서 고친 상태를 덮지 않게');
  assert.ok(x.ignUpd>'2026-10-14T00:00:00Z','무시는 자기 시각으로 합쳐진다');
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:1,done:1,plag:0,all:3,ign:1}));
  assert.doesNotMatch(t.els.excBody.innerHTML,/#478039/,'보류 탭에서는 사라진다');
  assert.ok(t.ctx.badge>0,'✏️ 배지도 다시 센다');
  assert.match(t.toasts.at(-1),/무시 탭/);
  /* 무시 탭: 날짜별로, 복원 버튼과 함께 */
  t.ctx.__tab('ign');
  assert.match(t.els.excBody.innerHTML,/9\/30 작성/);
  assert.match(t.els.excBody.innerHTML,/data-xign="478039" data-on="0"[^>]*>↩ 복원</);
  assert.match(t.els.excBody.innerHTML,/복원하면 보류로 돌아갑니다/);
});

test('복원 puts a row back where it was, without touching its status',()=>{
  const items=JSON.parse(JSON.stringify(base));
  items['481030'].ign=true; items['481030'].ignAt='2026-10-14T01:00:00Z'; items['481030'].ignBy='claude';
  const t=excCtx(items);
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:0,plag:0,all:3,ign:1}));
  t.ctx.__tab('ign');
  assert.match(t.els.excBody.innerHTML,/· Claude/,'누가 무시했는지 보인다');
  t.click('481030',false);
  const x=t.items()['481030'];
  assert.equal(x.ign,false); assert.equal(x.ignAt,undefined); assert.equal(x.ignBy,undefined); assert.equal(x.status,'done');
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:1,plag:0,all:3,ign:0}));
  assert.match(t.toasts.at(-1),/처리 완료 탭으로 돌아갔어요/);
  assert.match(t.els.excBody.innerHTML,/무시한 예외가 없습니다/);
});

test('Claude can ignore through WorklogExc.ignore, and unknown ids are refused',async()=>{
  const t=excCtx(JSON.parse(JSON.stringify(base)));
  const r=await t.ctx.WorklogExc.ignore('481077',true,'claude');
  assert.equal(r.ok,true);
  assert.equal(t.items()['481077'].ignBy,'claude');
  assert.equal((await t.ctx.WorklogExc.ignore('999999',true,'claude')).ok,false);
});

test('the 전체 tab still lists ignored rows, marked 무시 with a 복원 button',()=>{
  const items=JSON.parse(JSON.stringify(base)); items['478039'].ign=true;
  const t=excCtx(items);
  t.ctx.__tab('all');
  assert.match(t.els.excBody.innerHTML,/#478039/);
  assert.match(t.els.excBody.innerHTML,/data-xign="478039" data-on="0"/);
  assert.match(t.els.excBody.innerHTML,/data-xign="481077" data-on="1"/);
});

test('the ✏️ badge leaves out reviews ignored in 검수 예외',()=>{
  const fn=html.split('function updatedReviews(){')[1].split('\nfunction renderUpdList')[0];
  const store={'unpa-pending-v1':JSON.stringify({at:'x',items:[],backlog:[
    {id:'478039',d:'2026-09-30',status:'UPDATED'},{id:'470186',d:'2026-09-04',status:'UPDATED'}]})};
  const ctx={localStorage:{getItem:k=>store[k]===undefined?null:store[k]},JSON,Array};
  vm.createContext(ctx); vm.runInContext('function updatedReviews(){'+fn+';globalThis.f=updatedReviews;',ctx);
  assert.equal(ctx.f().list.length,2);
  store['unpa-exceptions-v1']=JSON.stringify({v:1,items:{'478039':{id:'478039',ign:true},'470186':{id:'470186',ign:false}}});
  assert.equal(JSON.stringify(ctx.f().list.map(x=>x.id)),'["470186"]');
  store['unpa-exceptions-v1']='{broken';
  assert.equal(ctx.f().list.length,2,'예외 저장소가 깨져도 배지는 센다');
});

test('the sync window tells the console which reviews were ignored',()=>{
  const s=fs.readFileSync(path.join(root,'sync.html'),'utf8');
  const fn=s.split('function ignoredIds(){')[1].split('\n  }\n')[0];
  const store={};
  const ctx={localStorage:{getItem:k=>store[k]===undefined?null:store[k]},JSON,Object,String};
  vm.createContext(ctx); vm.runInContext('function ignoredIds(){'+fn+'\n  }\nglobalThis.f=ignoredIds;',ctx);
  assert.equal(JSON.stringify(ctx.f()),'[]');
  store['unpa-exceptions-v1']=JSON.stringify({v:1,items:{'1':{ign:true},'2':{ign:false},'3':{}}});
  assert.equal(JSON.stringify(ctx.f()),'["1"]');
  assert.match(s,/\{ignored:ignoredIds\(\)\}/,'완료 신호에 실어 보낸다');
});

/* cms-console.js — 무시 목록은 수정완료 검토·전체 스캔에서만 빼고, 남은 건수는 CMS 그대로 */
function consoleApi(){
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const el=()=>({style:{},onclick:null,appendChild(){},remove(){},click(){},querySelectorAll:()=>[],addEventListener(){},
                 querySelector:()=>null,set innerHTML(v){},get innerHTML(){return '';},dataset:{},classList:{contains:()=>false}});
  const store={}, listeners=[], opened=[];
  const ctx={
    location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me',search:'',hash:'',pathname:'/review/list/all'},
    document:{documentElement:{hasAttribute:()=>false,getAttribute:()=>null,removeAttribute(){},setAttribute(){}},
              getElementById:()=>el(),createElement:el,body:{appendChild(){}},head:{appendChild(){}},querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>store[k]===undefined?null:store[k],setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{get(){return null;}},URL,AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    WorklogCore:require('../worklog-core.js'),crypto:globalThis.crypto,alert:m=>{ctx.__alert=m;},confirm:()=>true,
    addEventListener:(t,f)=>{ if(t==='message') listeners.push(f); },removeEventListener(){},
    open:url=>{ const w={url,closed:false,posted:[],postMessage(m){ this.posted.push(m); },close(){}}; opened.push(w); return w; },postMessage(){},
    fetch:async()=>{ const t='{"results":[],"templates":[]}'; return {status:200,text:async()=>t,json:async()=>JSON.parse(t)}; },
  };
  ctx.window=ctx; ctx.XMLHttpRequest=function(){}; ctx.XMLHttpRequest.prototype={open(){},setRequestHeader(){}};
  vm.createContext(ctx);
  vm.runInContext(code.replace('  /* ── 시작 ── */',
    '  globalThis.api={ignSet,isIgn,ignApply,updatedRows,bUpdated,bIgnored,scanAll,remainList,runJobs,syncNow,setBacklog:b=>{BACKLOG=b;},'
    +'setMe:m=>{ME=m;},getResults:()=>results,setResults:r=>{results=r;}};\n  /* ── 시작 ── */'),ctx);
  return {ctx,store,listeners,opened};
}

test('the console remembers the ignored list and says when it changed',()=>{
  const {ctx,store}=consoleApi();
  assert.equal(ctx.api.isIgn('478039'),false);
  assert.equal(ctx.api.ignSet(['478039','481077']),true);
  assert.equal(ctx.api.isIgn('478039'),true); assert.equal(ctx.api.isIgn(478039),true,'숫자 번호도 같은 리뷰');
  assert.equal(ctx.api.ignSet(['481077','478039']),false,'순서만 다르면 바뀐 게 아니다');
  assert.equal(JSON.stringify(Object.keys(JSON.parse(store['unpa-console-ignored-v1']).ids).sort()),'["478039","481077"]');
  assert.equal(ctx.api.ignSet([]),true,'복원하면 다시 들어온다');
  assert.equal(ctx.api.isIgn('478039'),false);
});

test('ignored reviews are left out of 수정완료 검토 and 전체 스캔, but the remaining count stays as CMS has it',async()=>{
  const {ctx}=consoleApi();
  const backlog=[
    {date:'2026-09-30',rows:[{id:478039,status:'UPDATED'},{id:477000,status:'UPDATED'}]},
    {date:'2026-10-10',rows:[{id:481077,status:'PENDING'}]},
  ];
  backlog.all=backlog; backlog.at='2026-10-14T00:00:00Z';
  ctx.api.ignSet(['478039','481077']);
  assert.equal(JSON.stringify(ctx.api.updatedRows(backlog).map(x=>x.id)),'[477000]');
  assert.equal(ctx.api.bUpdated(backlog[0]),1); assert.equal(ctx.api.bIgnored(backlog[0]),1);
  ctx.api.setBacklog(backlog);
  const rm=ctx.api.remainList();
  assert.equal(rm.days['2026-09-30'].n,2,'CMS 에는 남아 있으니 남은 건수는 그대로');
  assert.equal(rm.days['2026-09-30'].upd,1,'수정완료 수에서는 뺀다');
  assert.equal(rm.days['2026-10-10'].n,1);
  /* 남은 게 전부 무시한 건이면 스캔하지 않는다 */
  await ctx.api.scanAll([backlog[1]]);
  assert.match(ctx.__alert,/모두 업무일지에서 무시한 건/);
});

test('a double-click on 무시 changes only the row that was clicked',()=>{
  const t=excCtx(JSON.parse(JSON.stringify(base)));
  t.click('478039',true,1);
  t.click('481077',true,2);           /* 줄이 빠지고 같은 자리에 온 다음 줄 버튼 — 두 번째 클릭은 버린다 */
  assert.equal(t.items()['478039'].ign,true);
  assert.equal(t.items()['481077'].ign,undefined);
});

test('an ignore and a status change made on different devices both survive the merge',()=>{
  const C=require('../worklog-core.js');
  const old={id:'481077',status:'hold',reason:'old',at:'2026-10-14T01:00:00Z'};
  /* (a) PC 에서 상태를 고쳤고, 오래 열어 둔 휴대폰에서 무시를 눌렀다 */
  const server={v:1,items:{'481077':Object.assign({},old,{status:'done',reason:'new',at:'2026-10-14T02:00:00Z'})}};
  const phone={v:1,items:{'481077':Object.assign({},old,{ign:true,ignAt:'2026-10-14T03:00:00Z',ignBy:'user',ignUpd:'2026-10-14T03:00:00Z'})}};
  let m=C.mergeExceptions(server,phone).items['481077'];
  assert.equal(m.status,'done'); assert.equal(m.reason,'new'); assert.equal(m.ign,true); assert.equal(m.ignBy,'user');
  m=C.mergeExceptions(phone,server).items['481077'];
  assert.equal(m.status,'done'); assert.equal(m.ign,true,'합치는 순서와 상관없이');
  /* (b) 한 기기에서 무시했고, 오래 열어 둔 다른 기기에서 나중에 상태만 고쳤다 */
  const ignored={v:1,items:{'478039':{id:'478039',status:'hold',at:'2026-10-14T01:00:00Z',ign:true,ignAt:'2026-10-14T02:00:00Z',ignBy:'claude',ignUpd:'2026-10-14T02:00:00Z'}}};
  const stale={v:1,items:{'478039':{id:'478039',status:'done',at:'2026-10-14T05:00:00Z'}}};
  m=C.mergeExceptions(ignored,stale).items['478039'];
  assert.equal(m.status,'done'); assert.equal(m.ign,true,'무시가 풀리지 않는다'); assert.equal(m.ignBy,'claude');
  /* 복원도 나중 것이 이긴다 */
  const restored={v:1,items:{'478039':{id:'478039',status:'hold',at:'2026-10-14T01:00:00Z',ign:false,ignUpd:'2026-10-14T06:00:00Z'}}};
  m=C.mergeExceptions(Object.assign({},stale,{items:{'478039':Object.assign({},stale.items['478039'],ignored.items['478039'],{status:'done',at:'2026-10-14T05:00:00Z'})}}),restored).items['478039'];
  assert.equal(m.ign,false); assert.equal(m.ignAt,undefined); assert.equal(m.ignBy,undefined); assert.equal(m.status,'done');
  /* 무시를 한 번도 안 쓴 예전 항목은 예전처럼 통째로 나중 것 */
  m=C.mergeExceptions({v:1,items:{'1':{status:'hold',at:'1'}}},{v:1,items:{'1':{status:'done',at:'2'}}}).items['1'];
  assert.equal(JSON.stringify(m),JSON.stringify({status:'done',at:'2'}));
});

test('an ignore made on another computer reaches the console in the ready message, before the payload is built',async()=>{
  const {ctx,listeners,opened}=consoleApi();
  const D='2026-09-30';
  const b=[{date:D,rows:[{id:478039,status:'UPDATED'},{id:477000,status:'UPDATED'}]}];
  b.all=b; b.at='2026-10-14T00:00:00Z';
  ctx.api.setBacklog(b); ctx.api.setMe({id:1});
  assert.equal(ctx.api.syncNow(),true);
  const w=opened.at(-1), nonce=w.url.split('#n=')[1];
  /* 동기화 창(업무일지 쪽): 이 컴퓨터에는 478039 가 무시 전, 서버에는 다른 컴퓨터에서 무시한 기록 */
  const s=fs.readFileSync(path.join(root,'sync.html'),'utf8');
  const script=s.split('<script>').pop().split('</script>')[0];
  const wstore={'unpa-worklog-v1':JSON.stringify({v:1,months:{}}),
    'unpa-exceptions-v1':JSON.stringify({v:1,items:{'478039':{id:'478039',status:'hold',at:'2026-10-14T00:00:00Z'}}})};
  const serverExc={v:1,items:{'478039':{id:'478039',status:'hold',at:'2026-10-14T00:00:00Z',ign:true,ignAt:'2026-10-14T05:00:00Z',ignBy:'user',ignUpd:'2026-10-14T05:00:00Z'}}};
  const toConsole=[], wl=[];
  const src={postMessage:m=>{ toConsole.push(m); listeners.forEach(f=>f({origin:'https://moowillbedone.github.io',source:w,data:m})); }};
  w.postMessage=function(m){ this.posted.push(m); wl.forEach(f=>f({origin:'https://cms.unpa.me',source:src,data:m})); };
  const q=rows=>{ const o={select(){return o;},eq(){return o;},in(k,arr){ return Promise.resolve({data:rows.filter(r=>arr.indexOf(r.month)>=0)}); }}; return o; };
  const sctx={
    location:{hash:'#n='+nonce,pathname:'/unpa-worklog/sync.html'},history:{replaceState(){}},
    document:{getElementById:id=>({id,textContent:'',innerHTML:'',hidden:true})},
    localStorage:{getItem:k=>wstore[k]===undefined?null:wstore[k],setItem:(k,v)=>{wstore[k]=String(v);},removeItem:k=>{delete wstore[k];}},
    WorklogCore:require('../worklog-core.js'),JSON,Object,String,Date,Promise,Array,
    setTimeout:()=>0,close(){},
    addEventListener:(t,f)=>{ if(t==='message') wl.push(f); },
    supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}})},
      from:()=>Object.assign(q([{month:'~exc',data:serverExc,updated_at:'2026-10-14T05:00:00Z'}]),{upsert:async()=>({error:null})})})},
  };
  sctx.window=sctx; sctx.opener=src;
  vm.createContext(sctx); vm.runInContext(script,sctx);
  for(let i=0;i<200 && !toConsole.some(m=>m.type==='unpa-sync-done');i++) await new Promise(r=>setTimeout(r,10));
  const ready=toConsole.find(m=>m.type==='unpa-sync-ready');
  assert.equal(JSON.stringify(ready.ignored),'["478039"]','준비 신호에 이미 서버 무시 목록이 들어 있다');
  const payload=w.posted.find(m=>m.type==='unpa-sync-data').payload;
  assert.equal(payload.remain.days[D].upd,1,'이번 동기화부터 수정완료 수에서 빠진다');
  assert.equal(JSON.parse(wstore['unpa-exceptions-v1']).items['478039'].ign,true,'이 컴퓨터 업무일지에도 합쳐 둔다');
  assert.equal(toConsole.find(m=>m.type==='unpa-sync-done').ok,true);
});
test('the console builds the sync payload only after the ready message brings the current ignored list',()=>{
  const {ctx,listeners,opened}=consoleApi();
  const b=[{date:'2026-09-30',rows:[{id:478039,status:'UPDATED'},{id:477000,status:'UPDATED'}]}];
  b.all=b; b.at='2026-10-14T00:00:00Z';
  ctx.api.setBacklog(b); ctx.api.setMe({id:1});
  assert.equal(ctx.api.syncNow(),true);
  const w=opened.at(-1), nonce=w.url.split('#n=')[1];
  assert.equal(w.posted.length,0,'준비 신호 전에는 보내지 않는다');
  listeners.forEach(f=>f({origin:'https://moowillbedone.github.io',source:w,data:{type:'unpa-sync-ready',nonce,ignored:['478039']}}));
  const p=w.posted[0].payload;
  assert.equal(p.remain.days['2026-09-30'].upd,1,'방금 무시한 건은 이번 동기화부터 빠진다');
  assert.equal(p.remain.days['2026-09-30'].n,2);
  assert.equal(ctx.api.isIgn('478039'),true);
});

test('reviews scanned before the ignored list arrived are dropped, and are never sent',async()=>{
  const {ctx}=consoleApi();
  ctx.api.setResults([{id:478039,action:'revise_product'},{id:477000,action:'approve'},{id:481077,action:'hide',applied:true}]);
  ctx.api.ignApply(['478039','481077']);
  assert.equal(JSON.stringify(ctx.api.getResults().map(r=>r.id)),'[477000,481077]','이미 처리한 건은 기록으로 남긴다');
  await ctx.api.runJobs([{id:478039,action:'revise_product'}]);
  assert.match(ctx.__alert,/무시한 리뷰입니다/);
});

test('도용 (plagiarism) gets its own tab and a dark-red label, whatever its status, and 무시·복원 brings it back to 도용',()=>{
  const items=JSON.parse(JSON.stringify(base));
  items['482750']={id:'482750',d:'2026-10-14',kind:'plagiarism',status:'sent',brand:'존슨즈',product:'핑크 로션',reason:'477042 본문 그대로',at:'2026-10-17T00:00:00Z'};
  items['482754']={id:'482754',d:'2026-10-14',kind:'plagiarism',status:'hold',brand:'김정문알로에',product:'에멀전 S',reason:'482753 본문 복사',at:'2026-10-17T00:00:00Z'};
  const t=excCtx(items);
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:1,plag:2,all:5,ign:0}),'보류 상태여도 도용은 보류 탭이 아니라 도용 탭에');
  assert.doesNotMatch(t.els.excBody.innerHTML,/#482754/,'보류 탭에 섞이지 않는다');
  t.ctx.__tab('plag');
  assert.match(t.els.excBody.innerHTML,/<span class="xk plagiarism">도용<\/span>/);
  assert.match(t.els.excBody.innerHTML,/#482750/); assert.match(t.els.excBody.innerHTML,/#482754/);
  assert.match(t.els.excSum.innerHTML,/도용 2건/);
  assert.doesNotMatch(t.els.excSum.innerHTML,/xk plagiarism/,'도용 탭 합계 옆에는 [도용 N] 칩을 안 붙인다');
  assert.doesNotMatch(t.els.excBody.innerHTML,/<div class="xday">[^<]*<span class="xk/,'날짜 줄에도 종류 칩이 없다');
  assert.match(t.els.excBody.innerHTML,/<span class="xk plagiarism">도용<\/span><a /,'각 줄 앞 도용 라벨은 남긴다');
  t.ctx.__tab('done');
  assert.doesNotMatch(t.els.excBody.innerHTML,/#482750/,'수정요청 보냄이어도 처리 완료 탭에는 안 나온다');
  t.ctx.__tab('all');
  assert.match(t.els.excSum.innerHTML,/<span class="xk plagiarism">도용 2<\/span>/,'전체 탭에서는 종류별 칩을 그대로 보여 준다');
  t.ctx.__tab('plag');
  t.click('482750',true);
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:1,plag:1,all:5,ign:1}));
  t.ctx.__tab('ign');
  assert.match(t.els.excBody.innerHTML,/복원하면 도용으로 돌아갑니다/);
  assert.match(t.els.excBody.innerHTML,/title="도용으로 되돌립니다"/);
  t.click('482750',false);
  assert.match(t.toasts.at(-1),/도용 탭으로 돌아갔어요/);
  assert.equal(JSON.stringify(t.tabs()),JSON.stringify({hold:2,done:1,plag:2,all:5,ign:0}));
  t.ctx.__tab('plag'); t.items();
  const empty=excCtx(JSON.parse(JSON.stringify(base))); empty.ctx.__tab('plag');
  assert.match(empty.els.excBody.innerHTML,/도용으로 올린 리뷰가 없습니다/);
});

test('the 도용 label is a dark red chip like the other kind labels',()=>{
  const css=html.match(/\.xk\.plagiarism\{([^}]*)\}/);
  assert.ok(css,'.xk.plagiarism 스타일이 있다');
  assert.match(css[1],/background:#8f1d1d/); assert.match(css[1],/color:#fff/);
  assert.match(html,/plagiarism:'도용'/);
});

test('도용 rows carry source links (original review / article); only http(s) addresses become links',()=>{
  const items={
    '482750':{id:'482750',d:'2026-10-14',kind:'plagiarism',status:'sent',brand:'존슨즈',product:'핑크 로션',reason:'본문 그대로',
      src:[{u:'https://cms.unpa.me/review/detail/477042',t:'원본 리뷰 #477042'}],at:'2026-10-17T00:00:00Z'},
    '483314':{id:'483314',d:'2026-10-16',kind:'plagiarism',status:'hold',brand:'벨먼',product:'바디로션',reason:'',
      src:['https://kpinews.kr/newsView/1065577882459078'],at:'2026-10-17T00:00:00Z'},
    '1':{id:'1',d:'2026-10-16',kind:'plagiarism',status:'hold',brand:'x',product:'y',reason:'r',src:[{u:'javascript:alert(1)',t:'bad'},{u:'https://a.example/"><b>x',t:'<i>t</i>'}],at:'2026-10-17T00:00:00Z'},
  };
  const t=excCtx(items); t.ctx.__tab('plag');
  const h=t.els.excBody.innerHTML;
  assert.match(h,/🔗 근거 <a href="https:\/\/cms\.unpa\.me\/review\/detail\/477042" target="_blank" rel="noopener noreferrer">원본 리뷰 #477042 ↗<\/a>/);
  assert.match(h,/<a href="https:\/\/kpinews\.kr\/newsView\/1065577882459078"[^>]*>https:\/\/kpinews\.kr\/newsView\/1065577882459078 ↗<\/a>/,'이름이 없으면 주소를 보여 준다, 사유가 비어 있어도');
  assert.doesNotMatch(h,/javascript:/,'http(s) 아닌 주소는 버린다');
  assert.doesNotMatch(h,/<i>t<\/i>/,'이름은 이스케이프');
  assert.match(h,/href="https:\/\/a\.example\/&quot;&gt;&lt;b&gt;x"/,'주소도 이스케이프 — 속성을 깨고 나오지 못한다');
  assert.match(h,/&lt;i&gt;t&lt;\/i&gt;/);
});
