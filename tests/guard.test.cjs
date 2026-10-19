/* Claude 용 CMS 도구(cms-claude.js)의 월 목표 가드 — 승인 500원 · 새 제품 등록 600원, 목표를 넘기는 한 건은 실행하지 않는다 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','cms-claude.js'),'utf8');

const COUNTED='2026-10-18T11:50:00Z';                 /* CMS 집계를 시작한 시각 */
const NOW='2026-10-18T12:30:00Z';                     /* 40분 뒤 (KST 21:30) */
const goal=(over)=>Object.assign({at:'2026-10-18T11:54:29Z',countedAt:COUNTED,partial:false,month:'2026-10',target:1430000,r:1646,p:120,won:895000,ids:{r:['482561','100'],p:[]},lease:null},over||{});
const plain=x=>JSON.parse(JSON.stringify(x));

/* 가드만 (DOM 없음) */
/* localStorage 흉내 — 키 목록(length·key)까지: 원장은 한 건 = 한 키라 키를 훑어 읽는다 */
function lsOf(store, onGet, onSet){
  return { getItem:k=>{ if(onGet) onGet(k,store); return store[k]===undefined?null:store[k]; },
           setItem:(k,v)=>{ if(onSet) onSet(k,store); store[k]=String(v); }, removeItem:k=>{ delete store[k]; },
           get length(){ return Object.keys(store).length; }, key:i=>Object.keys(store)[i]===undefined?null:Object.keys(store)[i] };
}
function guard(g, nowIso, extra, onGet, onSet){
  const store={};
  if(g) store['unpa-console-goal-v3']=JSON.stringify(g);
  Object.assign(store, extra||{});
  const clock={now:Date.parse(nowIso)};
  const ctx={localStorage:lsOf(store,onGet,onSet),Date,JSON,Math,Object,String,isFinite,Set,Promise,setTimeout};
  ctx.__unpaNow=()=>clock.now;
  vm.createContext(ctx); vm.runInContext(code,ctx);
  return {G:ctx.UnpaGuard,ctx,store,clock,ledger:()=>plain(ctx.UnpaGuard.ledger())};
}

test('fresh goal: remaining budget and how many approvals / products still fit',()=>{
  const {G}=guard(goal(),NOW);
  const s=G.status();
  assert.equal(s.ok,true); assert.equal(s.won,895000); assert.equal(s.left,535000);
  assert.equal(s.approvals,1070); assert.equal(s.products,891);
  assert.match(G.line(),/목표 ₩1,430,000 · 이번 달 ₩895,000 · 남은 ₩535,000 → 승인 1070건 \/ 제품 891건까지/);
});

test('approvals (500) and new products (600) are counted; the same review twice counts once',()=>{
  const {G,ledger}=guard(goal(),NOW);
  assert.equal(G.reserve('r','483579').ok,true);
  assert.equal(G.reserve('r','483579').again,true);
  assert.equal(G.reserve('p','무드|다비치|1').ok,true);
  const s=G.status();
  assert.equal(s.spent,1100); assert.equal(s.won,896100);
  assert.equal(Object.keys(ledger().items).length,2,'원장에 남아 다른 탭에서도 이어서 센다');
});

test('stops before going over: reaching the target exactly is fine, one more is refused',()=>{
  const {G}=guard(goal({won:1429000}),NOW);
  assert.equal(G.reserve('r','1').ok,true);
  assert.equal(G.reserve('r','2').ok,true);                   /* ₩1,430,000 — 딱 닿음 */
  const no=G.reserve('r','3');
  assert.equal(no.ok,false); assert.equal(no.stop,true);
  assert.match(no.why,/목표 초과 — 이번 달 ₩1,430,000 \+ 리뷰 승인 ₩500 > 목표 ₩1,430,000/);
  assert.equal(G.status().won,1430000); assert.equal(G.status().halted,true);
});

test('once anything is refused, that amount is the month\'s final income — a cheaper approval that would fit is refused too',()=>{
  const {G}=guard(goal({won:1428900}),NOW);                   /* 1,100원 남음 */
  assert.equal(G.reserve('p','a|b|1').ok,true);               /* 1,429,500 */
  assert.equal(G.reserve('p','c|d|2').ok,false);              /* +600 → 초과 → 정지 */
  const r=G.reserve('r','5');
  assert.equal(r.ok,false,'500원 남았지만 이어서 하지 않는다'); assert.match(r.why,/목표 직전에서 멈춘 상태/);
  assert.equal(G.status().won,1429500,'최종 ₩1,429,500 — 목표보다 ₩500 적게 끝남');
});

test('the stop holds across re-syncs with the same target and lifts when the worklog target is raised',()=>{
  const {G,store,clock}=guard(goal({won:1429700}),NOW);
  assert.equal(G.reserve('r','1').ok,false);
  store['unpa-console-goal-v3']=JSON.stringify(goal({won:1429700,countedAt:'2026-10-18T13:00:00Z'})); clock.now=Date.parse('2026-10-18T13:10:00Z');
  assert.equal(G.reserve('r','2').ok,false,'같은 목표로 다시 동기화해도 정지');
  store['unpa-console-goal-v3']=JSON.stringify(goal({won:1429700,target:1500000,countedAt:'2026-10-18T13:20:00Z'})); clock.now=Date.parse('2026-10-18T13:25:00Z');
  assert.equal(G.status().ok,true); assert.equal(G.reserve('r','3').ok,true);
});

test('refuses everything when the goal is unknown, last month\'s, partial, missing its count time, stale (>1h) or from the future',()=>{
  const cases=[
    [null,/목표 정보가 없습니다/],
    [goal({month:'2026-09'}),/이번 달\(2026-10\) 것이 아닙니다/],
    [goal({partial:true}),/집계가 일부 실패/],
    [goal({countedAt:null}),/집계 시각이 없습니다/],
    [goal({countedAt:'2026-10-18T11:00:00Z'}),/90분 전 것입니다/],
    [goal({countedAt:'2026-10-18T14:00:00Z'}),/미래입니다/],
    [goal({target:0}),/목표 정보가 없습니다/],
    [goal({won:-5}),/목표 정보가 없습니다/],
    [goal({ids:undefined}),/리뷰 번호 목록이 없습니다/],
  ];
  for(const [g,re] of cases){ const {G}=guard(g,NOW); assert.equal(G.status().ok,false); assert.match(G.reserve('r','1').why,re); }
});

test('month boundary is Korean time: 10/31 15:30 UTC is already 11/1 in Korea',()=>{
  const {G}=guard(goal({countedAt:'2026-10-31T15:00:00Z'}),'2026-10-31T15:30:00Z');
  assert.equal(G.kstMonth(Date.parse('2026-10-31T15:30:00Z')),'2026-11');
  assert.match(G.status().why,/이번 달\(2026-11\)/);
});

test('approvals count by review number: this month and not yet in the worklog total — no time guessing',()=>{
  const c=Date.parse(COUNTED);
  const items={'r:100':{k:'r',t:c+5*60e3},                        /* 업무일지 합계에 이미 있음 → 빼기 */
               'r:old':{k:'r',t:c-6*3600e3},                      /* 집계 한참 전이어도 합계에 없으면 센다 (60일 밖 리뷰 등) */
               'r:sep':{k:'r',t:Date.parse('2026-09-30T10:00:00Z')}, /* 지난달 승인 — 이번 달 수입 아님 */
               'p:before':{k:'p',t:c-60*60e3},                    /* 제품은 시각으로: 집계 전 등록은 이미 합계에 */
               'p:edge':{k:'p',t:c-3*60e3},'p:after':{k:'p',t:c+20*60e3}};
  const {G}=guard(goal(),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  const s=G.status();
  assert.equal(s.spent,500+600+600); assert.deepEqual(plain(s.n),{r:1,p:2,c:0});
});

test('a sync in the middle of a run neither drops nor double counts: approvals already in the new total stop counting, the rest stay',()=>{
  const {G,store,clock}=guard(goal(),NOW);
  ['a','b','c'].forEach(id=>assert.equal(G.reserve('r',id).ok,true));
  assert.equal(G.status().won,896500);
  /* 새 동기화: a·b 는 업무일지에 들어감(won +1000), c 는 아직 */
  store['unpa-console-goal-v3']=JSON.stringify(goal({won:896000,countedAt:'2026-10-18T12:40:00Z',ids:{r:['482561','100','a','b'],p:[]}}));
  clock.now=Date.parse('2026-10-18T12:45:00Z');
  assert.equal(G.status().won,896500,'같은 금액 — 빠지지도 두 번 세지도 않는다');
});

test('a review the worklog already counted that is pending again costs nothing more (the worklog counts each id once), even at the target',()=>{
  const {G,ledger}=guard(goal({won:1430000}),NOW);                       /* 목표에 딱 닿음, 100 은 업무일지 합계에 있음 */
  const r=G.reserve('r','100');
  assert.equal(r.ok,true); assert.equal(r.free,true); assert.equal(ledger().items['r:100'],undefined);
  assert.equal(G.status().won,1430000); assert.equal(G.status().ok,true,'정지하지 않는다');
  assert.equal(G.reserve('r','999').ok,false,'새 리뷰는 여전히 막는다');
});

test('approvals sent by the review console after the count are counted too (even if its sync never finished), without double counting',()=>{
  const c=Date.parse(COUNTED);
  const sent={ '900':{action:'approve',at:new Date(c+60e3).toISOString()},
               '901':{action:'revise_swatch',at:new Date(c+60e3).toISOString()},
               '100':{action:'approve',at:new Date(c-3600e3).toISOString()},       /* 업무일지 합계에 이미 있음 */
               '903':{action:'approve',at:new Date(c+120e3).toISOString()} };
  const items={'r:903':{k:'r',t:c+120e3}};                                          /* 같은 리뷰를 Claude 원장도 가짐 */
  const {G}=guard(goal(),NOW,{'unpa-console-sent-v1':JSON.stringify(sent),'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  const s=G.status();
  assert.equal(s.spent,1000); assert.deepEqual(plain(s.n),{r:1,p:0,c:1});
});

test('a retry of an old reservation that is no longer counted goes through the budget check again',()=>{
  const items={'r:7':{k:'r',t:Date.parse('2026-09-29T03:00:00Z')}};   /* 지난달 기록 → 이번 달 셈에 없음 */
  const {G,ledger}=guard(goal({won:1430000}),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  const r=G.reserve('r','7');
  assert.equal(r.ok,false,'예전 기록이 있다고 그냥 통과시키지 않는다'); assert.equal(r.again,undefined);
  assert.ok(ledger().halt);
});

test('reserve says whether it made a new entry; only that very reservation may be taken back, and never once another caller joined it',()=>{
  const {G,ledger}=guard(goal(),NOW);
  const a=G.reserve('r','11'); assert.equal(a.created,true); assert.ok(a.token);
  assert.equal(G.release('r','11',a.token+1),false,'다른 예약의 토큰으로는 못 지운다');
  const b=G.reserve('r','11'); assert.equal(b.again,true); assert.equal(b.created,undefined);
  assert.equal(G.release('r','11',a.token),false,'다른 쪽이 함께 쓴 예약(j)은 주인도 못 지운다 — 그쪽이 실제로 승인했을 수 있다');
  assert.deepEqual(Object.keys(ledger().items),['r:11']);
  const c=G.reserve('r','12'); assert.equal(G.release('r','12',c.token),true);
  assert.deepEqual(Object.keys(ledger().items),['r:11']);
});

test('a revise request that went out clears a leftover UNCLEAR approval reservation of that review — a confirmed one stays (it may have been re-opened by an author edit)',()=>{
  const c=Date.parse(COUNTED);
  const {G,ledger}=guard(goal({won:1428500}),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items:{'r:555':{k:'r',t:c+60e3,src:'c',u:1},'r:556':{k:'r',t:c+60e3}}})});
  assert.equal(G.status().left,500);
  assert.equal(G.forget('555'),true); assert.equal(G.status().left,1000);
  assert.equal(G.forget('555'),false);
  assert.equal(G.forget('556'),false,'확실히 된 승인은 지우지 않는다'); assert.deepEqual(Object.keys(ledger().items),['r:556']);
  const r=G.reserve('r','700'); assert.equal(G.mark('r','700',r.token+1),false); assert.equal(G.mark('r','700',r.token),true);
  assert.equal(G.forget('700'),true,'애매 표시를 한 그 예약은 지울 수 있다');
});

test('two tabs reserving at the same moment cannot both pass: the write is re-checked and the later one backs out and stops',()=>{
  /* 이 탭이 '확인'을 마치고 제 기록을 쓰는 순간, 다른 탭이 마지막 500원을 먼저 써 둔 상황 */
  const {G,ledger}=guard(goal({won:1429500}),NOW,null,null,(k,store)=>{
    if(k==='unpa-claude-ledger-v1|r:mine' && !store['unpa-claude-ledger-v1|r:other']) store['unpa-claude-ledger-v1|r:other']=JSON.stringify({k:'r',t:Date.parse(NOW)});
  });
  const r=G.reserve('r','mine');
  assert.equal(r.ok,false); assert.equal(r.stop,true); assert.match(r.why,/동시에 예약/);
  assert.deepEqual(Object.keys(ledger().items),['r:other'],'내 예약은 거두고 다른 탭 예약은 남긴다');
  assert.ok(ledger().halt); assert.equal(G.status().won,1430000,'목표 그대로 — 넘지 않는다');
});

test('each reservation is its own storage key, so two tabs writing at once never erase each other',()=>{
  const {G,store}=guard(goal(),NOW);
  G.reserve('r','1'); G.reserve('p','x|y|1');
  assert.ok(store['unpa-claude-ledger-v1|r:1']); assert.ok(store['unpa-claude-ledger-v1|p:x|y|1']);
  /* 예전 키가 다른 탭의 쓰기로 덮여 사라져도 새 가드는 건마다 키로 그대로 센다 */
  delete store['unpa-claude-ledger-v1'];
  assert.equal(G.status().spent,1100);
});

test('the legacy single-key ledger is still read (entries an older tab wrote count), but new entries are not written there',()=>{
  const c=Date.parse(COUNTED);
  const {G,store}=guard(goal(),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items:{'r:41':{k:'r',t:c+60e3}}})});
  G.reserve('r','42');
  assert.equal(G.status().spent,1000);
  assert.deepEqual(Object.keys(JSON.parse(store['unpa-claude-ledger-v1']).items),['r:41']);
});

test('near the target, reservations queue behind a cross-tab lock and wait for other tabs\' writes to arrive; far from it they go straight through',async()=>{
  const near=guard(goal({won:1429000}),NOW), far=guard(goal(),NOW);
  const calls=[]; near.ctx.navigator={locks:{request:(name,fn)=>{ calls.push(name); return fn(); }}}; far.ctx.navigator={locks:{request:(name,fn)=>{ calls.push('far'); return fn(); }}};
  const a=await near.G.reserveSafe('r','1'); assert.equal(a.ok,true); assert.deepEqual(calls,['unpa-guard-reserve']);
  const b=await far.G.reserveSafe('r','2'); assert.equal(b.ok,true); assert.deepEqual(calls,['unpa-guard-reserve'],'멀면 잠금 없이');
  const c=await near.G.reserveSafe('r','3'); assert.equal(c.ok,true);
  const d=await near.G.reserveSafe('r','4'); assert.equal(d.ok,false,'잠금 안에서도 목표는 그대로 지킨다');
});

/* ── 실제 흐름: 가짜 CMS 리뷰 상세 화면에서 UnpaOps.approve 를 돌린다 ── */
function cms(g, reviews, nowIso){
  const store={'unpa-console-goal-v3':JSON.stringify(g)}, sess={};
  const st={cur:null, modal:false, clicks:{approve:[],confirm:[]}};
  const R=()=>reviews[st.cur];
  const el=(o)=>Object.assign({getAttribute:()=>null,querySelectorAll:()=>[],querySelector:()=>null},o);
  const approveBtn=()=>el({innerText:'검수 완료',get disabled(){ return !!(R()&&R().done); },
    click(){ st.clicks.approve.push(st.cur); if(R().modal!==false) st.modal=true; }});
  const confirmBtn=el({innerText:'확인',click(){ st.clicks.confirm.push(st.cur); st.modal=false; if(R().finish!==false) R().done=true; }});
  const document={
    querySelectorAll(sel){
      const r=R(); if(!r) return [];
      if(sel==='th') return [el({innerText:'리뷰 ID',nextElementSibling:{innerText:st.cur}}),el({innerText:'최초 작성일',nextElementSibling:{innerText:r.created||'2026-10-16 09:00:00'}}),el({innerText:'최근 수정일',nextElementSibling:{innerText:r.upd}})];
      if(sel==='button') return [approveBtn()];
      if(sel==='button.ant-switch') return [el({innerText:'노출',getAttribute:()=>r.hidden?'false':'true'})];
      if(sel==='img') return [el({src:'https://images.unpa.me/'+(r.xbox?'null':'123'),alt:'p'})];
      if(sel==='.ant-modal, .ant-modal-confirm') return st.modal ? [el({innerText:'리뷰 검수를 완료하시겠습니까?',querySelectorAll:()=>[confirmBtn]})] : [];
      return [];
    },
    querySelector(){ return null; },
  };
  const clock={now:Date.parse(nowIso||NOW)};
  const ctx={document,localStorage:lsOf(store),
    sessionStorage:{getItem:k=>sess[k]===undefined?null:sess[k],setItem:(k,v)=>{sess[k]=String(v);},removeItem:k=>{delete sess[k];}},
    location:{get pathname(){ return '/review/detail/'+st.cur; },search:''},
    next:{router:{push(p){ st.cur=p.split('/').pop(); }}},
    MessageChannel,Promise,Date,JSON,Math,Object,String,Array,isFinite,Set,setTimeout};
  ctx.__unpaNow=()=>clock.now;
  vm.createContext(ctx); vm.runInContext(code,ctx);
  return {ctx,st,store,ledger:()=>plain(ctx.UnpaGuard.ledger())};
}
const rv=(o)=>Object.assign({upd:'2026-10-16 10:00:00'},o||{});

test('UnpaOps.approve clicks only after the guard says yes and stops the whole run at the first refusal',async()=>{
  const {ctx,st,ledger}=cms(goal({won:1429000}),{'1':rv(),'2':rv(),'3':rv(),'4':rv()});
  const out=await ctx.UnpaOps.approve(['1','2','3','4']);
  assert.match(out,/^1 OK ; 2 OK ; 3 ⛔ 목표 초과/);
  assert.match(out,/NOT DONE 3,4/);
  assert.deepEqual(plain(st.clicks.approve),['1','2'],'3번째부터는 버튼을 누르지도 않는다');
  assert.deepEqual(Object.keys(ledger().items).sort(),['r:1','r:2']);
  assert.match(out,/이번 달은 목표 직전에서 멈춘 상태/);
});

test('UnpaOps.approve with no usable goal approves nothing',async()=>{
  const {ctx,st}=cms(goal({partial:true}),{'1':rv()});
  const out=await ctx.UnpaOps.approve(['1']);
  assert.match(out,/^STOP 🎯 .*집계가 일부 실패/);
  assert.equal(st.clicks.approve.length,0);
});

test('checks before reserving: changed review, unlinked product, hidden review → skipped, nothing counted',async()=>{
  const {ctx,st,ledger}=cms(goal(),{'1':rv({upd:'2026-10-17 09:00:00'}),'2':rv({xbox:true}),'3':rv({hidden:true})});
  const out=await ctx.UnpaOps.approve(['1','2','3'],{data:{'1':{upd:'2026-10-16 10:00:00'}}});
  assert.match(out,/1 STOP upd/); assert.match(out,/2 STOP xbox/); assert.match(out,/3 STOP hidden/);
  assert.equal(st.clicks.approve.length,0); assert.equal(Object.keys(ledger().items).length,0);
});

test('no confirm dialog → not approved → taken back out of the ledger',async()=>{
  const {ctx,ledger}=cms(goal(),{'1':rv({modal:false})});
  const out=await ctx.UnpaOps.approve(['1']);
  assert.match(out,/1 STOP nomodal/); assert.equal(Object.keys(ledger().items).length,0);
});

test('no confirm dialog on a retry of an earlier (maybe done) approval → the earlier entry is kept',async()=>{
  const c=Date.parse(COUNTED);
  const {ctx,store,ledger}=cms(goal(),{'1':rv({modal:false})});
  store['unpa-claude-ledger-v1']=JSON.stringify({v:1,items:{'r:1':{k:'r',t:c+60e3}}});
  const out=await ctx.UnpaOps.approve(['1']);
  assert.match(out,/1 STOP nomodal/); assert.deepEqual(Object.keys(ledger().items),['r:1'],'이번에 만든 예약이 아니면 지우지 않는다');
});

test('confirm clicked but no result seen → stays counted (it may have gone through)',async()=>{
  const {ctx,st,ledger}=cms(goal(),{'1':rv({finish:false})});
  const out=await ctx.UnpaOps.approve(['1']);
  assert.match(out,/1 UNSURE/); assert.deepEqual(plain(st.clicks.confirm),['1']);
  assert.deepEqual(Object.keys(ledger().items),['r:1'],'애매하면 센 채로 둔다');
});

/* ── 제품 등록 폼 ── */
function form(g, search){
  const {ctx,ledger}=cms(g,{});
  const clicks=[];
  ctx.document.querySelectorAll=sel=>sel==='button[type=submit]'?[{innerText:'등록',click(){ clicks.push(1); }}]:[];
  ctx.location.search=search||'';
  const d={name:'무드',brand:'다비치',cat:'미용소품',sub:'미용도구/잡화',unit:'개',amount:2,price:20000,options:['블랙','초코']};
  ctx.UnpaForm.state=()=>({name:'무드',brand:'다비치',cat:'미용소품',sub:'미용도구/잡화',unit:'개',amount:'2',price:'20,000',img:1,options:['블랙','초코']});
  return {F:ctx.UnpaForm,d,clicks,ledger};
}

test('UnpaForm.submit registers a new product only through the guard; each submit counts separately',async()=>{
  const {F,d,clicks,ledger}=form(goal());
  const r1=await F.submit(d); assert.match(r1,/^SUBMIT 무드 · key /);
  const r2=await F.submit(d); assert.match(r2,/^SUBMIT/);
  assert.equal(clicks.length,2);
  assert.equal(Object.values(ledger().items).filter(x=>x.k==='p').length,2,'다시 눌러도 따로 센다 (늦게 멈추지 않게)');
  const k1=/key (\S+)/.exec(r1)[1], k2=/key (\S+)/.exec(r2)[1];
  assert.equal(F.undo(k1),false,'예전 등록(이미 된 것)은 되돌릴 수 없다');
  assert.equal(F.undo(),false,'키 없이 되돌리지 않는다');
  assert.equal(F.undo(k2),true,'방금 이 탭에서 예약한 그 키만, 목록에서 안 된 걸 확인했을 때');
  assert.equal(Object.values(ledger().items).filter(x=>x.k==='p').length,1);
  assert.equal(F.undo(k2),false,'두 번 되돌리지 않는다');
});

test('UnpaForm.submit refuses (no click) when 600 does not fit, and when form values differ',async()=>{
  let f=form(goal({won:1429500}));
  assert.match(await f.F.submit(f.d),/^⛔ 목표 초과/); assert.equal(f.clicks.length,0);
  f=form(goal());
  assert.match(await f.F.submit(Object.assign({},f.d,{price:25000})),/^HOLD 폼 값이 다름/); assert.equal(f.clicks.length,0);
});

test('editing an existing product (/product/edit?id=…) is not income and is not blocked',async()=>{
  const {F,d,clicks,ledger}=form(goal({won:1430000}),'?id=150336');
  assert.match(await F.submit(d),/^SUBMIT 무드$/); assert.equal(clicks.length,1);
  assert.equal(Object.keys(ledger().items).length,0);
});

test('the review console no longer approves without a known goal',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','cms-console.js'),'utf8');
  assert.doesNotMatch(src,/목표 금액 제한 없이 승인합니다/);
});

test('after a CMS count, approval reservations made before it for reviews the count saw as not approved by me are dropped (they never happened)',()=>{
  const c=Date.parse(COUNTED);
  const items={'r:555':{k:'r',t:c-3600e3,src:'c',u:1},'r:556':{k:'r',t:c-3600e3,u:1},'r:557':{k:'r',t:c+60e3,u:1},'r:558':{k:'r',t:c-3600e3},'p:x|y|1':{k:'p',t:c-3600e3}};
  const {G,ledger}=guard(goal(),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  assert.equal(G.prune({'555':1,'557':1,'558':1},c-5*60e3),1,'555 만 — 556 은 집계가 못 본 리뷰라, 557 은 집계 뒤 예약이라, 558 은 확인된 승인이라 남긴다');
  assert.deepEqual(Object.keys(ledger().items).sort(),['p:x|y|1','r:556','r:557','r:558']);
});

test('prune keeps a reservation that was used again (joined) after the count started — that later use may be the real approval',()=>{
  const c=Date.parse(COUNTED);
  const items={'r:500':{k:'r',t:c-3600e3,u:1,j:c+60e3},'r:501':{k:'r',t:c-3600e3,u:1}};
  const {G,ledger}=guard(goal(),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  assert.equal(G.prune({'500':1,'501':1},c-5*60e3),1);
  assert.deepEqual(Object.keys(ledger().items),['r:500']);
  assert.equal(G.settled('r','500'),true,'함께 써서 실제 승인이 확인되면 애매 표시를 지운다');
  assert.equal(G.forget('500'),false,'그 뒤에는 수정요청이 나가도 지우지 않는다');
});

test('the old snapshot key is not read any more (a stale tab with an older guard cannot use it)',()=>{
  const {G}=guard(null,NOW,{'unpa-console-goal-v1':JSON.stringify(goal())});
  assert.equal(G.status().ok,false); assert.match(G.status().why,/목표 정보가 없습니다/);
});

test('with the worklog cloud on, only the device holding this month\'s work right (lease) may approve or register, and only until it expires',()=>{
  const later=new Date(Date.parse(NOW)+30*60e3).toISOString(), past=new Date(Date.parse(NOW)-60e3).toISOString();
  const W={written:'2026-10-17'};
  let r=guard(goal({lease:{ok:false,why:'other',until:later}}),NOW).G.reserve('r','1',W);
  assert.equal(r.ok,false); assert.match(r.why,/다른 컴퓨터\(또는 브라우저\)가 이번 달 작업 권한/);
  r=guard(goal({lease:{ok:true,until:past}}),NOW).G.reserve('r','1',W); assert.equal(r.ok,false); assert.match(r.why,/작업 권한 시간이 지났습니다/);
  r=guard(goal({lease:{ok:false,why:'version'}}),NOW).G.reserve('r','1',W); assert.match(r.why,/예전 버전/);
  assert.equal(guard(goal({lease:{ok:true,until:later}}),NOW).G.reserve('r','1',W).ok,true);
  /* 권한을 쓰는 동안은 작성일을 알아야 하고, 70일 넘은 리뷰는 도구로 승인하지 않는다(다음 기기의 집계에 안 잡힐 수 있어서) */
  let q=guard(goal({lease:{ok:true,until:later}}),NOW).G.reserve('r','1'); assert.equal(q.ok,false); assert.equal(q.stop,undefined); assert.match(q.why,/작성일을 몰라/);
  q=guard(goal({lease:{ok:true,until:later}}),NOW).G.reserve('r','1',{written:'2026-08-01'}); assert.equal(q.ok,false); assert.match(q.why,/70일이 넘은/);
  assert.equal(guard(goal({lease:{ok:true,until:later}}),NOW).G.reserve('p','x|y|1').ok,true,'제품은 작성일과 무관');
  assert.equal(guard(goal({lease:undefined}),NOW).G.reserve('r','1').ok,false,'권한 정보가 아예 없으면 막는다');
  assert.equal(guard(goal({lease:null}),NOW).G.reserve('r','1').ok,true,'서버 로그인 안 함(한 기기)');
});

test('a stop written by an older counting rule (no version) is re-evaluated once; a current one holds',()=>{
  const old={'unpa-claude-ledger-v1|!halt':JSON.stringify({month:'2026-10',target:1430000,t:Date.parse(NOW)-60e3,won:1430000})};
  assert.equal(guard(goal(),NOW,old).G.status().ok,true);
  const cur={'unpa-claude-ledger-v1|!halt':JSON.stringify({v:7,month:'2026-10',target:1430000,t:Date.parse(NOW)-60e3,won:1430000})};
  assert.equal(guard(goal(),NOW,cur).G.status().halted,true);
});

test('products count after the later of this device\'s count and the merged count of the same account (a future one is ignored)',()=>{
  const c=Date.parse(COUNTED), items={'p:a':{k:'p',t:c+10*60e3},'p:b':{k:'p',t:c+30*60e3}};
  let G=guard(goal({prodBase:new Date(c+20*60e3).toISOString()}),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})}).G;
  assert.equal(G.status().spent,600,'a 는 더 나중 집계(20분 뒤)에 이미 들어 있다');
  G=guard(goal({prodBase:new Date(Date.parse(NOW)+3*3600e3).toISOString()}),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})}).G;
  assert.equal(G.status().spent,1200,'미래 시각은 버린다');
});

test('a confirmed approval is also put in the console outbox so the next sync records it even outside the 60-day count window',async()=>{
  const {ctx,store}=cms(goal(),{'1':rv(),'2':rv({finish:false})});
  await ctx.UnpaOps.approve(['1','2']);
  const o=JSON.parse(store['unpa-console-outbox-v1']);
  assert.deepEqual(o.reviews.map(x=>x[0]),['1'],'결과를 못 본 2번은 넣지 않는다'); assert.match(o.reviews[0][1],/^\d{4}-\d\d-\d\d$/); assert.equal(o.seq,1);
});

test('lease refusal messages say what to do (other device: from when; clock; old console)',()=>{
  let r=guard(goal({lease:{ok:false,why:'other',after:'2026-10-18T13:07:00Z'}}),NOW).G.reserve('r','1'); assert.match(r.why,/22:07 이후에 시작한 CMS 집계/);
  r=guard(goal({lease:{ok:false,why:'clock',skew:95}}),NOW).G.reserve('r','1'); assert.match(r.why,/시계가 서버 시각과 95초/);
  r=guard(goal({lease:{ok:false,why:'device'}}),NOW).G.reserve('r','1'); assert.match(r.why,/콘솔이 예전 버전/);
  r=guard(goal({lease:{ok:false,why:'cloud'}}),NOW).G.reserve('r','1'); assert.match(r.why,/서버 연결/);
});

test('with a work right in use, UnpaOps.approve skips (does not stop at) a review written more than 70 days ago and goes on',async()=>{
  const later=new Date(Date.parse(NOW)+30*60e3).toISOString();
  const {ctx,st}=cms(goal({lease:{ok:true,until:later}}),{'1':rv({created:'2026-07-20 10:00:00'}),'2':rv({created:'2026-10-17 10:00:00'})});
  const out=await ctx.UnpaOps.approve(['1','2']);
  assert.match(out,/1 SKIP 작성 70일이 넘은/); assert.match(out,/2 OK/); assert.deepEqual(plain(st.clicks.approve),['2']);
  assert.equal(ctx.UnpaGuard.VERSION,8);
});
