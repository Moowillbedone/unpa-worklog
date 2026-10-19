/* Claude 용 CMS 도구(cms-claude.js)의 월 목표 가드 — 승인 500원 · 새 제품 등록 600원, 목표를 넘기는 한 건은 실행하지 않는다 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','cms-claude.js'),'utf8');

const COUNTED='2026-10-18T11:50:00Z';                 /* CMS 집계를 시작한 시각 */
const NOW='2026-10-18T12:30:00Z';                     /* 40분 뒤 (KST 21:30) */
const goal=(over)=>Object.assign({at:'2026-10-18T11:54:29Z',countedAt:COUNTED,partial:false,month:'2026-10',target:1430000,r:1646,p:120,won:895000},over||{});
const plain=x=>JSON.parse(JSON.stringify(x));

/* 가드만 (DOM 없음) */
function guard(g, nowIso, extra){
  const store={};
  if(g) store['unpa-console-goal-v1']=JSON.stringify(g);
  Object.assign(store, extra||{});
  const clock={now:Date.parse(nowIso)};
  const ctx={localStorage:{getItem:k=>store[k]===undefined?null:store[k],setItem:(k,v)=>{store[k]=String(v);}},Date,JSON,Math,Object,String,isFinite};
  ctx.__unpaNow=()=>clock.now;
  vm.createContext(ctx); vm.runInContext(code,ctx);
  return {G:ctx.UnpaGuard,store,clock,ledger:()=>JSON.parse(store['unpa-claude-ledger-v1']||'{"items":{}}')};
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
  store['unpa-console-goal-v1']=JSON.stringify(goal({won:1429700,countedAt:'2026-10-18T13:00:00Z'})); clock.now=Date.parse('2026-10-18T13:10:00Z');
  assert.equal(G.reserve('r','2').ok,false,'같은 목표로 다시 동기화해도 정지');
  store['unpa-console-goal-v1']=JSON.stringify(goal({won:1429700,target:1500000,countedAt:'2026-10-18T13:20:00Z'})); clock.now=Date.parse('2026-10-18T13:25:00Z');
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
  ];
  for(const [g,re] of cases){ const {G}=guard(g,NOW); assert.equal(G.status().ok,false); assert.match(G.reserve('r','1').why,re); }
});

test('month boundary is Korean time: 10/31 15:30 UTC is already 11/1 in Korea',()=>{
  const {G}=guard(goal({countedAt:'2026-10-31T15:00:00Z'}),'2026-10-31T15:30:00Z');
  assert.equal(G.kstMonth(Date.parse('2026-10-31T15:30:00Z')),'2026-11');
  assert.match(G.status().why,/이번 달\(2026-11\)/);
});

test('counts everything done after the CMS count started (5-minute safety margin), not after the sync finished',()=>{
  const c=Date.parse(COUNTED);
  const items={'r:old':{k:'r',t:c-60*60e3},'r:edge':{k:'r',t:c-3*60e3},'p:after':{k:'p',t:c+20*60e3}};
  const {G}=guard(goal(),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  assert.equal(G.status().spent,1100,'집계 1시간 전 것은 이미 won 에 들어 있어 빼고, 집계 3분 전·뒤 것은 센다');
});

test('approvals sent by the review console after the count are counted too (even if its sync never finished), without double counting',()=>{
  const c=Date.parse(COUNTED);
  const sent={ '900':{action:'approve',at:new Date(c+60e3).toISOString()},
               '901':{action:'revise_swatch',at:new Date(c+60e3).toISOString()},
               '902':{action:'approve',at:new Date(c-3600e3).toISOString()},       /* 집계 전 — 이미 won 에 있음 */
               '903':{action:'approve',at:new Date(c+120e3).toISOString()} };
  const items={'r:903':{k:'r',t:c+120e3}};                                          /* 같은 리뷰를 Claude 원장도 가짐 */
  const {G}=guard(goal(),NOW,{'unpa-console-sent-v1':JSON.stringify(sent),'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  const s=G.status();
  assert.equal(s.spent,1000); assert.deepEqual(plain(s.n),{r:1,p:0,c:1});
});

test('a retry of an old reservation that is no longer counted goes through the budget check again',()=>{
  const c=Date.parse(COUNTED);
  const items={'r:7':{k:'r',t:c-3*3600e3}};                    /* 지난 집계 전 기록 → 지금 셈에 없음 */
  const {G,ledger}=guard(goal({won:1430000}),NOW,{'unpa-claude-ledger-v1':JSON.stringify({v:1,items})});
  const r=G.reserve('r','7');
  assert.equal(r.ok,false,'예전 기록이 있다고 그냥 통과시키지 않는다'); assert.equal(r.again,undefined);
  assert.ok(ledger().halt);
});

/* ── 실제 흐름: 가짜 CMS 리뷰 상세 화면에서 UnpaOps.approve 를 돌린다 ── */
function cms(g, reviews, nowIso){
  const store={'unpa-console-goal-v1':JSON.stringify(g)}, sess={};
  const st={cur:null, modal:false, clicks:{approve:[],confirm:[]}};
  const R=()=>reviews[st.cur];
  const el=(o)=>Object.assign({getAttribute:()=>null,querySelectorAll:()=>[],querySelector:()=>null},o);
  const approveBtn=()=>el({innerText:'검수 완료',get disabled(){ return !!(R()&&R().done); },
    click(){ st.clicks.approve.push(st.cur); if(R().modal!==false) st.modal=true; }});
  const confirmBtn=el({innerText:'확인',click(){ st.clicks.confirm.push(st.cur); st.modal=false; if(R().finish!==false) R().done=true; }});
  const document={
    querySelectorAll(sel){
      const r=R(); if(!r) return [];
      if(sel==='th') return [el({innerText:'리뷰 ID',nextElementSibling:{innerText:st.cur}}),el({innerText:'최근 수정일',nextElementSibling:{innerText:r.upd}})];
      if(sel==='button') return [approveBtn()];
      if(sel==='button.ant-switch') return [el({innerText:'노출',getAttribute:()=>r.hidden?'false':'true'})];
      if(sel==='img') return [el({src:'https://images.unpa.me/'+(r.xbox?'null':'123'),alt:'p'})];
      if(sel==='.ant-modal, .ant-modal-confirm') return st.modal ? [el({innerText:'리뷰 검수를 완료하시겠습니까?',querySelectorAll:()=>[confirmBtn]})] : [];
      return [];
    },
    querySelector(){ return null; },
  };
  const clock={now:Date.parse(nowIso||NOW)};
  const ctx={document,localStorage:{getItem:k=>store[k]===undefined?null:store[k],setItem:(k,v)=>{store[k]=String(v);}},
    sessionStorage:{getItem:k=>sess[k]===undefined?null:sess[k],setItem:(k,v)=>{sess[k]=String(v);},removeItem:k=>{delete sess[k];}},
    location:{get pathname(){ return '/review/detail/'+st.cur; },search:''},
    next:{router:{push(p){ st.cur=p.split('/').pop(); }}},
    MessageChannel,Promise,Date,JSON,Math,Object,String,Array,isFinite};
  ctx.__unpaNow=()=>clock.now;
  vm.createContext(ctx); vm.runInContext(code,ctx);
  return {ctx,st,store,ledger:()=>JSON.parse(store['unpa-claude-ledger-v1']||'{"items":{}}')};
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

test('UnpaForm.submit registers a new product only through the guard; each submit counts separately',()=>{
  const {F,d,clicks,ledger}=form(goal());
  const r1=F.submit(d); assert.match(r1,/^SUBMIT 무드 · key /);
  const r2=F.submit(d); assert.match(r2,/^SUBMIT/);
  assert.equal(clicks.length,2);
  assert.equal(Object.values(ledger().items).filter(x=>x.k==='p').length,2,'다시 눌러도 따로 센다 (늦게 멈추지 않게)');
  const k1=/key (\S+)/.exec(r1)[1], k2=/key (\S+)/.exec(r2)[1];
  assert.equal(F.undo(k1),false,'예전 등록(이미 된 것)은 되돌릴 수 없다');
  assert.equal(F.undo(),false,'키 없이 되돌리지 않는다');
  assert.equal(F.undo(k2),true,'방금 이 탭에서 예약한 그 키만, 목록에서 안 된 걸 확인했을 때');
  assert.equal(Object.values(ledger().items).filter(x=>x.k==='p').length,1);
  assert.equal(F.undo(k2),false,'두 번 되돌리지 않는다');
});

test('UnpaForm.submit refuses (no click) when 600 does not fit, and when form values differ',()=>{
  let f=form(goal({won:1429500}));
  assert.match(f.F.submit(f.d),/^⛔ 목표 초과/); assert.equal(f.clicks.length,0);
  f=form(goal());
  assert.match(f.F.submit(Object.assign({},f.d,{price:25000})),/^HOLD 폼 값이 다름/); assert.equal(f.clicks.length,0);
});

test('editing an existing product (/product/edit?id=…) is not income and is not blocked',()=>{
  const {F,d,clicks,ledger}=form(goal({won:1430000}),'?id=150336');
  assert.match(F.submit(d),/^SUBMIT 무드$/); assert.equal(clicks.length,1);
  assert.equal(Object.keys(ledger().items).length,0);
});

test('the review console no longer approves without a known goal',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','cms-console.js'),'utf8');
  assert.doesNotMatch(src,/목표 금액 제한 없이 승인합니다/);
});
