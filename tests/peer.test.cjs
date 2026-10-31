/* 동료 검수 칸 — 동료에게 맡긴 작성일([맡김] 표시)과 CMS 기준 다른 계정 승인 (2026-10-31) */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const W=require('../worklog-core.js');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const clone=o=>JSON.parse(JSON.stringify(o));
/* 콘솔과 같은 계정 해시 — 기록에는 이것만 남는다 */
const hkey=e=>{ const s=String(e).trim().toLowerCase(); let h=5381; for(let i=0;i<s.length;i++) h=(Math.imul(h,33)^s.charCodeAt(i))>>>0; return h.toString(36); };
const blank=(m,n)=>{ const days={}; for(let i=1;i<=n;i++) days[String(i).padStart(2,'0')]={r:0,p:0,memo:'',unreg:''}; return {month:m,target:1430000,days}; };

/* ── 합치기 규칙 (worklog-core.js) ───────────────────────── */
test('other accounts\' approvals land on the 작성일, my own count rides along, and nothing touches my income',()=>{
  const out={'2026-10':blank('2026-10',31)};
  const touched=W.applyPeer(out,{at:'2026-10-31T12:00:00Z',from:'2026-10-20',to:'2026-10-31',failed:[],
    days:{'2026-10-28':{me:2,by:{'colleague':240,'Admin.X':1}},'2026-10-30':{me:0,by:{'colleague':180}}}});
  assert.deepEqual(touched,['2026-10']);
  assert.deepEqual(out['2026-10'].days['28'].peerCms,{me:2,ot:241,by:{colleague:240,'admin.x':1},at:'2026-10-31T12:00:00Z'},'계정 이름은 소문자 앞부분만');
  assert.deepEqual(out['2026-10'].days['30'].peerCms,{me:0,ot:180,by:{colleague:180},at:'2026-10-31T12:00:00Z'});
  assert.equal(out['2026-10'].days['26'].peerCms,undefined,'다른 계정 승인이 없는 날은 아무것도 적지 않는다');
  const d=out['2026-10'].days['28'];
  assert.equal(d.r,0); assert.equal(d.p,0,'내 리뷰·제품 수는 그대로');
});

test('a re-count with the same numbers does not mark the month changed; a later count updates it',()=>{
  const out={'2026-10':blank('2026-10',31)};
  const p={at:'2026-10-31T12:00:00Z',from:'2026-10-28',to:'2026-10-31',days:{'2026-10-28':{me:0,by:{colleague:10}}}};
  W.applyPeer(out,p);
  assert.deepEqual(W.applyPeer(out,Object.assign({},p,{at:'2026-10-31T13:00:00Z'})),[],'같은 값이면 서버에 다시 올릴 일 없다');
  assert.equal(out['2026-10'].days['28'].peerCms.at,'2026-10-31T12:00:00Z');
  assert.deepEqual(W.applyPeer(out,Object.assign({},p,{at:'2026-10-31T14:00:00Z',days:{'2026-10-28':{me:0,by:{colleague:25}}}})),['2026-10']);
  assert.equal(out['2026-10'].days['28'].peerCms.ot,25);
  assert.deepEqual(W.applyPeer(out,Object.assign({},p,{at:'2026-10-31T10:00:00Z',days:{'2026-10-28':{me:0,by:{colleague:3}}}})),[],'더 옛날에 센 값으로는 되돌리지 않는다');
  assert.equal(out['2026-10'].days['28'].peerCms.ot,25);
});

test('a day that failed to count keeps its old value; a day that now shows no other approver is zeroed, not deleted',()=>{
  const out={'2026-10':blank('2026-10',31)};
  out['2026-10'].days['28'].peerCms={me:0,ot:40,by:{colleague:40},at:'2026-10-30T00:00:00Z'};
  out['2026-10'].days['30'].peerCms={me:0,ot:9,by:{colleague:9},at:'2026-10-30T00:00:00Z'};
  const t=W.applyPeer(out,{at:'2026-10-31T12:00:00Z',from:'2026-10-20',to:'2026-10-31',failed:['2026-10-28','products'],days:{}});
  assert.deepEqual(t,['2026-10']);
  assert.equal(out['2026-10'].days['28'].peerCms.ot,40,'못 센 날은 그대로');
  assert.deepEqual(out['2026-10'].days['30'].peerCms,{me:0,ot:0,by:{},at:'2026-10-31T12:00:00Z'},'0 으로 덮고 시각을 남긴다 — 다른 기기 옛 값이 되살아나지 않게');
});

test('odd days (the other reviewer\'s by default) are written only when handed off, and days before the auto-count start are left alone',()=>{
  const out={'2026-10':blank('2026-10',31)};
  out['2026-10'].days['29'].peer={on:true,t:1};
  W.applyPeer(out,{at:'2026-10-31T12:00:00Z',from:'2026-08-20',to:'2026-10-31',days:{
    '2026-10-27':{me:0,by:{k1:50}},'2026-10-29':{me:0,by:{k1:7}},'2026-10-28':{me:0,by:{k1:3}},'2026-08-24':{me:0,by:{k1:9}}}},'2026-09-01');
  assert.equal(out['2026-10'].days['27'].peerCms,undefined,'맡기지 않은 홀수일은 적지 않는다');
  assert.equal(out['2026-10'].days['29'].peerCms.ot,7,'맡긴 홀수일은 적는다');
  assert.equal(out['2026-10'].days['28'].peerCms.ot,3);
  assert.equal(out['2026-08'],undefined,'자동 집계 시작(9/1) 앞 달은 새로 만들지 않는다');
});

test('bad input is ignored, odd keys are cleaned, and a month the worklog does not have is never created',()=>{
  const out={'2026-10':Object.assign(blank('2026-10',31),{target:1500000})};
  assert.deepEqual(W.applyPeer(out,null),[]);
  assert.deepEqual(W.applyPeer(out,{at:'nope',from:'2026-10-01',to:'2026-10-02',days:{}}),[]);
  assert.deepEqual(W.applyPeer(out,{at:'2026-11-02T00:00:00Z',from:'2026-11-02',to:'2026-11-01',days:{}}),[],'거꾸로 된 기간');
  assert.deepEqual(W.applyPeer(out,{at:'2026-11-02T00:00:00Z',from:'2026-10-30',to:'2026-11-02',days:{'2026-11-02':{me:0,by:{k1:5}}}}),[]);
  assert.equal(out['2026-11'],undefined,'표시만 하는 값이라 없는 달을 새로 만들지 않는다 — 빈 달이 서버 기록을 덮지 않게');
  W.applyPeer(out,{at:'2026-10-31T00:00:00Z',from:'2026-10-30',to:'2026-10-31',days:{'2026-10-30':{me:'x',by:{'A.B':-1,k1:3,'':2}}}});
  assert.deepEqual(out['2026-10'].days['30'].peerCms.by,{k1:3,'?':2},'음수·이상한 값은 버리고 빈 이름은 ?');
  assert.equal(out['2026-10'].days['30'].peerCms.me,0);
  W.months(out);
});

test('merging computers: the later 맡김 toggle wins and the later CMS count wins, whichever day record won',()=>{
  const a=blank('2026-10',31), b=blank('2026-10',31);
  a.days['28']={r:5,p:0,memo:'',unreg:'',_t:500,peer:{on:true,t:100}};          /* A: 맡김을 먼저 켜고 나중에 다른 칸을 고침 */
  b.days['28']={r:5,p:0,memo:'x',unreg:'',_t:200,peer:{on:false,t:300}};       /* B: 그 뒤에 맡김을 껐다 */
  a.days['30']={r:0,p:0,memo:'',unreg:'',peerCms:{me:0,ot:5,by:{c:5},at:'2026-10-31T01:00:00Z'}};
  b.days['30']={r:0,p:0,memo:'',unreg:'',_t:900,peerCms:{me:0,ot:0,by:{},at:'2026-10-31T02:00:00Z'}};
  const m=W.mergeMonth(a,b);
  assert.deepEqual(m.days['28'].peer,{on:false,t:300},'나중에 바꾼 맡김 표시가 이긴다');
  assert.equal(m.days['28']._t,500,'그날 기록은 여전히 나중에 고친 A 것');
  assert.deepEqual(m.days['30'].peerCms,{me:0,ot:0,by:{},at:'2026-10-31T02:00:00Z'},'0 으로 덮은 최근 값이 옛 값을 이긴다');
  const m2=W.mergeMonth(b,a);
  assert.deepEqual(m2.days['28'].peer,{on:false,t:300}); assert.equal(m2.days['30'].peerCms.ot,0,'순서를 바꿔도 같다');
  const only=W.mergeMonth(blank('2026-10',31),a);
  assert.deepEqual(only.days['28'].peer,{on:true,t:100},'한쪽에만 있으면 그대로 가져온다');
});

test('the sync window applies the console\'s peer counts to the stored worklog and keeps the names in this browser only',async()=>{
  const today=new Date(), ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const back=n=>new Date(today.getFullYear(),today.getMonth(),today.getDate()-n);
  const t=ymd(today), from=ymd(back(8));
  let e=1; while(back(e).getDate()%2) e++;                           /* 창 안의 짝수일 하나 */
  const y=ymd(back(e)), K=hkey('colleague@example.com');
  const st={};
  const store={getItem:k=>st[k]===undefined?null:st[k],setItem:(k,v)=>{st[k]=String(v);},removeItem:k=>{delete st[k];}};
  const p={v:1,work:{v:1,from,to:t,reviews:[],products:[],partial:false},audit:{},remain:null,
    peer:{v:1,at:new Date().toISOString(),from,to:t,failed:[],days:{[y]:{me:1,by:{[K]:7}}}},peerNames:{[K]:'colleague','bad key!':'x'}};
  const res=await W.syncWindow(store,p,null,{});
  assert.equal(res.ok,true);
  const saved=JSON.parse(st['unpa-worklog-v1']);
  assert.deepEqual(saved.months[y.slice(0,7)].days[y.slice(8)].peerCms.by,{[K]:7},'기록에는 계정 해시만');
  assert.equal(saved.months[y.slice(0,7)].days[y.slice(8)].r,0,'내 리뷰 수에는 안 들어간다');
  assert.doesNotMatch(st['unpa-worklog-v1'],/colleague/,'이름은 업무일지 기록(서버·내보내기)에 안 들어간다');
  assert.deepEqual(JSON.parse(st['unpa-peer-names-v1']),{[K]:'colleague'},'이름은 이 브라우저에만, 이상한 키는 버린다');
});

/* ── 업무일지 화면 (index.html) ─────────────────────────── */
function peerCellFn(names){
  const src=html.split('const isPeerDay = ')[1].split('\n/* 동료에게 맡긴 작성일')[0];
  const ctx={num:n=>String(n),htmlEscape:s=>String(s).replace(/"/g,'&quot;')};
  if(names) ctx.localStorage={getItem:k=>k==='unpa-peer-names-v1'?JSON.stringify(names):null};
  vm.createContext(ctx); vm.runInContext('const isPeerDay = '+src+';globalThis.f=peerCell;',ctx);
  return ctx.f;
}
test('the 동료 검수 cell: [맡김] on 담당 짝수일, ✓ 전부 when the colleague cleared the day, nothing on odd days',()=>{
  const cell=peerCellFn();
  assert.equal(cell({r:0,p:0},'27'),'','홀수일은 원래 다른 담당자 날 — 아무것도 안 그린다');
  const off=cell({r:0,p:0},'26');
  assert.match(off,/class="peerb" data-pd="26" aria-pressed="false"/); assert.match(off,/>맡김<\/button>/);
  const full=cell({peer:{on:true,t:1},peerCms:{me:0,ot:245,by:{k1:243,'?':2},at:'2026-10-31T12:00:00Z'},pend:{n:0}},'28');
  assert.match(full,/class="peerb on"[^>]*aria-pressed="true"/); assert.match(full,/🤝 맡김/);
  assert.match(full,/<span class="peerc full"[^>]*>✓ 전부 245건<\/span>/);
  assert.match(full,/다른 계정 1 243건 · 승인자 모름 2건/,'이 브라우저에 이름이 없으면 계정 번호로');
  const named=peerCellFn({k1:'colleague'})({peerCms:{me:0,ot:3,by:{k1:3},at:'2026-10-31T12:00:00Z'}},'28');
  assert.match(named,/colleague 3건/,'이름을 아는 브라우저에서는 이메일 앞부분');
  const part=cell({peer:{on:true,t:1},peerCms:{me:3,ot:100,by:{colleague:100},at:'2026-10-31T12:00:00Z'},pend:{n:12}},'30');
  assert.match(part,/<span class="peerc"[^>]*>동료 100 · 나 3 · 남은 12<\/span>/);
  assert.match(cell({peer:{on:true,t:1}},'29'),/🤝 맡김/,'홀수일이라도 맡겼으면 보인다');
  assert.doesNotMatch(cell({peerCms:{me:0,ot:0,by:{},at:'x'}},'28'),/peerc/,'0 건이면 숫자를 안 붙인다');
});

test('the table has the narrower memo columns and the new 동료 검수 column, wired to the toggle',()=>{
  assert.match(html,/<table class="daytbl">/); assert.match(html,/table\.daytbl\{min-width:900px\}/,'넓은 최소 폭은 일별 표에만');
  assert.match(html,/<th style="width:140px">리뷰 수정여부<\/th>\s*<th style="width:160px">미등록 제품수<\/th>\s*<th title="[^"]+">동료 검수<\/th>/);
  assert.match(html,/`<td>\$\{peerCell\(d, dd\)\}<\/td>`/);
  assert.match(html,/<td colspan="3"><\/td><\/tr>`;/,'합계 줄도 칸 수를 맞춘다');
  assert.match(html,/querySelectorAll\('\.peerb'\)\.forEach\(b => \{ b\.onclick = \(\) => setPeer\(cur, b\.dataset\.pd\); \}\);/);
  const sp=html.split('function setPeer(m, dd){')[1].split('\n}')[0];
  assert.match(sp,/day\.peer = \{ on, t \}; day\._t = t;/,'예전 업무일지가 합쳐도 지워지지 않게 그날 수정 시각도 바꾼다');
  assert.match(sp,/\.focus\(\)/,'다시 그린 뒤에도 키보드 위치 유지');
  const ra=html.split('function renderAll(charts){')[1].split('\n}')[0];
  assert.match(ra,/renderUpdBadge\(\)/,'다시 그릴 때마다(불러오기·가져오기·계정 전환·서버 합치기) 배지도 다시 센다');
});

test('the ✏️ badge and the update summary leave handed-off dates out of my count and say so',()=>{
  const fn=html.split('function updatedReviews(){')[1].split('\nfunction renderUpdList')[0];
  const store={'unpa-pending-v1':JSON.stringify({at:'x',items:[],backlog:[
    {id:'1',d:'2026-10-28',status:'UPDATED'},{id:'2',d:'2026-10-26',status:'UPDATED'},{id:'3',d:'2026-10-28',status:'PENDING'}]})};
  const ctx={localStorage:{getItem:k=>store[k]===undefined?null:store[k]},peerDaySet:()=>new Set(['2026-10-28'])};
  vm.createContext(ctx); vm.runInContext('function updatedReviews(){'+fn+';globalThis.f=updatedReviews;',ctx);
  const r=ctx.f();
  assert.equal(JSON.stringify(r.list.map(x=>x.id)),'["2"]'); assert.equal(r.peer,1);
  const rf=html.split('function updRemainHtml(rm){')[1].split('\n}')[0];
  const c2={peerDaySet:()=>new Set(['2026-10-28','2026-10-30'])};
  vm.createContext(c2); vm.runInContext('function updRemainHtml(rm){'+rf+'\n}\nglobalThis.f=updRemainHtml;',c2);
  const h=c2.f({n:20,days:{'2026-10-26':4,'2026-10-28':10,'2026-10-30':6}});
  assert.match(h,/📋 남은 검수 <b>4<\/b>건 · 10\/26 4 · 🤝 동료 맡김 10\/28 10, 10\/30 6/);
  assert.match(c2.f({n:6,days:{'2026-10-30':6}}),/<b>0<\/b>건 — 짝수일 모두 끝 · 🤝 동료 맡김 10\/30 6/);
});

/* ── 동기화 창 (sync.html) ─────────────────────────────── */
test('the sync window reads the handed-off dates from the active worklog and sends them in both messages',()=>{
  const s=fs.readFileSync(path.join(root,'sync.html'),'utf8');
  const fn=s.split('function peerDays(){')[1].split('\n  }\n')[0];
  const st={};
  const ctx={localStorage:{getItem:k=>st[k]===undefined?null:st[k]},JSON,Object,String};
  vm.createContext(ctx); vm.runInContext('function peerDays(){'+fn+'\n  }\nglobalThis.f=peerDays;',ctx);
  assert.equal(JSON.stringify(ctx.f()),'[]');
  st['unpa-worklog-active']='unpa-worklog-v2:u1';
  st['unpa-worklog-v2:u1']=JSON.stringify({v:1,months:{'2026-10':{days:{'28':{peer:{on:true,t:1}},'30':{peer:{on:true,t:2}},'26':{peer:{on:false,t:3}},'24':{}}},
                                                     'x':{days:{'01':{peer:{on:true}}}}}});
  assert.equal(JSON.stringify(ctx.f()),'["2026-10-28","2026-10-30"]','로그인한 계정 기록에서, 켜진 날만');
  st['unpa-worklog-v2:u1']='{broken';
  assert.equal(ctx.f(),null,'기록이 깨졌으면 모름(null) — 콘솔은 적어 둔 것을 그대로 쓴다');
  assert.match(s,/type:'unpa-sync-ready',nonce:nonce,ignored:ignoredIds\(\),peerDays:peerDays\(\)/);
  assert.match(s,/\{ignored:ignoredIds\(\),peerDays:peerDays\(\)\}/);
  assert.match(s,/worklog-core\.js\?v=16/);
});

/* ── 검수 콘솔 (cms-console.js) ─────────────────────────── */
function consoleApi(route){
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
    fetch:async(url)=>{ const r=route&&route(String(url)); const t=JSON.stringify(r?r.body:{results:[],templates:[]});
                        return {status:r?r.status:200,text:async()=>t,json:async()=>JSON.parse(t)}; },
  };
  ctx.window=ctx; ctx.XMLHttpRequest=function(){}; ctx.XMLHttpRequest.prototype={open(){},setRequestHeader(){}};
  vm.createContext(ctx);
  vm.runInContext(code.replace('  /* ── 시작 ── */',
    '  globalThis.api={peerSet,isPeerDate,peerApply,peerLabel,collectWork,workPayload,remainList,syncNow,setBacklog:b=>{BACKLOG=b;},'
    +'setMe:m=>{ME=m;},setWork:w=>{WORK=w;},scanAll,updatedRows,runJobs,setResults:r=>{results=r;},getResults:()=>results,setDate:d=>{SCAN_DATE=d;}};\n  /* ── 시작 ── */'),ctx);
  return {ctx,store,listeners,opened};
}
const localYmd=d=>{const p=n=>(n<10?'0':'')+n;return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};

test('the console counts, per 작성일, who approved — mine apart from each other account — and hands it to the worklog',async()=>{
  const now=new Date(); let e3=3; while(new Date(now.getFullYear(),now.getMonth(),now.getDate()-e3).getDate()%2) e3++;
  const d3=localYmd(new Date(now.getFullYear(),now.getMonth(),now.getDate()-e3));   /* 담당 짝수일 */
  const at=h=>new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,0).toISOString();
  const ME='me@example.com', OT='colleague@example.com';
  const {ctx}=consoleApi(url=>{
    if(url.includes('/admin/reviews?')){
      if(!url.includes('startDate='+d3+'&')) return {status:200,body:{totalCount:0,result:[]}};
      return {status:200,body:{totalCount:6,result:[
        {id:1,approvedAt:at(9),revisedBy:[ME],status:'APPROVED'},
        {id:2,approvedAt:at(9),revisedBy:[OT],status:'APPROVED'},
        {id:3,approvedAt:at(9),revisedBy:[ME,'Colleague@Example.com'],status:'APPROVED'},   /* 내가 요청하고 동료가 승인 */
        {id:4,approvedAt:at(9),revisedBy:['admin@example.com'],status:'APPROVED'},
        {id:5,approvedAt:null,revisedBy:[OT],status:'REVISED'},                               /* 수정요청만 — 세지 않는다 */
        {id:6,approvedAt:at(9),revisedBy:[],status:'APPROVED'},                               /* 승인자를 모름 */
      ]}};
    }
    if(url.includes('/admin/products?')) return {status:200,body:{totalCount:0,results:[]}};
    return {status:404,body:{}};
  });
  const w=await ctx.api.collectWork(ME);
  const KC=hkey(OT), KA=hkey('admin@example.com');
  assert.deepEqual(clone(w.peer),{[d3]:{me:1,by:{[KC]:2,[KA]:1,'?':1}}},'동료 2 · 관리자 1 · 모름 1 — 기록에는 계정 해시만');
  assert.deepEqual(clone(w.peerNames),{[KC]:'colleague',[KA]:'admin'},'이름(이메일 앞부분)은 따로 — 이 브라우저 업무일지에만 간다');
  assert.equal(Object.keys(w.reviews).length,1,'내 수입에 드는 것은 내 승인 1건뿐 그대로');
  assert.equal(w.countTo,localYmd(now));
  ctx.api.setWork(w);
  const p=ctx.api.workPayload();
  assert.deepEqual(clone(p.peer),{v:1,at:w.at,from:w.countFrom>'2026-09-01'?w.countFrom:'2026-09-01',to:w.countTo,failed:[],days:{[d3]:{me:1,by:{[KC]:2,[KA]:1,'?':1}}}});
  assert.deepEqual(clone(p.peerNames),{[KC]:'colleague',[KA]:'admin'});
  /* 업무일지가 그대로 받는다 */
  const mk=d3.slice(0,7), out={[mk]:blank(mk,new Date(+mk.slice(0,4),+mk.slice(5,7),0).getDate())}; W.applyPeer(out,p.peer);
  assert.equal(out[d3.slice(0,7)].days[d3.slice(8)].peerCms.ot,4);
  assert.equal(ctx.api.peerLabel(''),'?');
  /* 맡기지 않은 홀수일은 세지 않는다(원래 다른 담당자 날) */
  let o3=3; while(new Date(now.getFullYear(),now.getMonth(),now.getDate()-o3).getDate()%2===0) o3++;
  const dOdd=localYmd(new Date(now.getFullYear(),now.getMonth(),now.getDate()-o3));
  const c2=consoleApi(url=>{
    if(url.includes('/admin/reviews?')) return url.includes('startDate='+dOdd+'&') ? {status:200,body:{totalCount:1,result:[{id:9,approvedAt:at(9),revisedBy:[OT],status:'APPROVED'}]}} : {status:200,body:{totalCount:0,result:[]}};
    if(url.includes('/admin/products?')) return {status:200,body:{totalCount:0,results:[]}};
    return {status:404,body:{}};
  }).ctx;
  assert.deepEqual(clone((await c2.api.collectWork(ME)).peer),{});
  c2.api.peerSet([dOdd]);
  assert.equal(Object.keys(clone((await c2.api.collectWork(ME)).peer)).join(),dOdd,'맡긴 홀수일은 센다');
});

test('the console remembers handed-off dates and keeps them out of 전체 스캔 and 수정완료 검토, but still counts what is left',async()=>{
  const {ctx,store}=consoleApi();
  assert.equal(ctx.api.peerSet(['2026-10-28','2026-10-30','bad']),true);
  assert.equal(ctx.api.isPeerDate('2026-10-28'),true); assert.equal(ctx.api.isPeerDate('2026-10-26'),false);
  assert.equal(ctx.api.peerSet(['2026-10-30','2026-10-28']),false,'순서만 다르면 바뀐 게 아니다');
  assert.equal(JSON.stringify(Object.keys(JSON.parse(store['unpa-console-peerdays-v1']).days).sort()),'["2026-10-28","2026-10-30"]');
  ctx.api.peerApply(null);
  assert.equal(ctx.api.isPeerDate('2026-10-28'),true,'목록이 안 오면(예전 업무일지) 적어 둔 것을 그대로 쓴다');
  const b=[{date:'2026-10-28',rows:[{id:1,status:'PENDING'},{id:2,status:'UPDATED'}]},{date:'2026-10-26',rows:[{id:3,status:'UPDATED'}]}];
  b.all=b; b.at='2026-10-31T00:00:00Z';
  ctx.api.setBacklog(b);
  const rm=ctx.api.remainList();
  assert.equal(rm.days['2026-10-28'].n,2,'동료 진행 상황을 보려고 남은 건수는 그대로 넘긴다');
  const src=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const ps=src.split('function paintStart(allBacklog, sd){')[1].split('\n  }\n')[0];
  assert.match(ps,/var backlog=allBacklog\.filter\(function\(b\)\{ return !isPeerDate\(b\.date\); \}\)/,'시작 화면의 개수·스캔 버튼은 맡긴 날을 뺀 목록으로');
  assert.match(ps,/scanAll\(backlog\)/); assert.match(ps,/scanUpdated\(backlog\)/);
  assert.match(ps,/🤝 동료에게 맡긴 날 — 스캔하지 않습니다/);
});

test('reviews of a handed-off date that were scanned before the list arrived are dropped and never sent',async()=>{
  const {ctx}=consoleApi();
  ctx.api.setDate('2026-10-26_2026-10-28');
  ctx.api.setResults([{id:1,action:'approve',date:'2026-10-28'},{id:2,action:'approve',date:'2026-10-26'},{id:3,action:'hide',date:'2026-10-28',applied:true}]);
  ctx.api.peerApply(['2026-10-28']);
  assert.equal(JSON.stringify(ctx.api.getResults().map(r=>r.id)),'[2,3]','이미 처리한 건은 기록으로 남긴다');
  await ctx.api.runJobs([{id:1,action:'approve',date:'2026-10-28'}]);
  assert.match(ctx.__alert,/모두 동료에게 맡긴 날의 리뷰/,'실행 직전에도 한 번 더 거른다');
  const src=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  assert.match(src,/\(nPeer\?'\\n\\n동료에게 맡긴 날의 '\+nPeer\+'건은 뺐습니다\.':''\)/,'섞여 있으면 확인 창에 뺀 건수를 알린다');
});

test('the start screen still warns about days that failed to load, and 📌 아직 안 끝난 일 leaves handed-off dates out',()=>{
  const src=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const ps=src.split('function paintStart(allBacklog, sd){')[1].split('\n  }\n')[0];
  assert.match(ps,/if\(allBacklog\.failed && allBacklog\.failed\.length\)/,'조회 실패 경고는 전체 목록 기준');
  const rp=html.split('function renderPending(){')[1].split('\n  }\n')[0];
  assert.match(rp,/if\(pd\.has\(b\.d\)\)\{ nPeer\+\+; return; \}/);
  assert.match(rp,/🤝 동료에게 맡긴 날 '\+nPeer\+'건 제외/);
});

test('a date handed off on another computer reaches the console in the ready message, before the payload is built',()=>{
  const {ctx,listeners,opened}=consoleApi();
  const b=[{date:'2026-10-28',rows:[{id:1,status:'PENDING'}]}]; b.all=b; b.at='2026-10-31T00:00:00Z';
  ctx.api.setBacklog(b); ctx.api.setMe('me@example.com');
  ctx.api.setWork({reviews:{},products:{},failed:[],watch:{},mine:[],notMine:{},at:new Date().toISOString(),startedAt:new Date().toISOString(),
                   countFrom:'2026-08-18',countTo:'2026-10-31',peer:{'2026-10-28':{me:0,by:{colleague:5}}}});
  assert.equal(ctx.api.syncNow(),true);
  const w=opened.at(-1), nonce=w.url.split('#n=')[1];
  listeners.forEach(f=>f({origin:'https://moowillbedone.github.io',source:w,data:{type:'unpa-sync-ready',nonce,ignored:[],peerDays:['2026-10-28']}}));
  assert.equal(ctx.api.isPeerDate('2026-10-28'),true);
  const p=w.posted[0].payload;
  assert.equal(p.peer.days['2026-10-28'].by.colleague,5,'집계도 함께 간다');
  listeners.forEach(f=>f({origin:'https://moowillbedone.github.io',source:w,data:{type:'unpa-sync-done',nonce,ok:true,peerDays:[]}}));
  assert.equal(ctx.api.isPeerDate('2026-10-28'),false,'업무일지에서 해제하면 완료 신호로 풀린다');
});

test('no personal e-mail address is written into the code, the page or the tests',()=>{
  const files=['index.html','sync.html','cms-console.js','worklog-core.js','cms-claude.js',...fs.readdirSync(path.join(root,'tests')).map(f=>'tests/'+f)];
  for(const f of files){
    const s=fs.readFileSync(path.join(root,f),'utf8');
    const hits=[...s.matchAll(/([0-9a-z._-]+)@(gmail|naver|daum|hanmail|kakao|nate|outlook|icloud)\.(com|net)/gi)].map(m=>m[0]);
    const fake=/^(abc|test|user|me|other|colleague|admin|example)@/i;          /* 테스트용 가짜 주소만 허용 */
    assert.deepEqual(hits.filter(x=>!fake.test(x)),[],f+' 에 개인 메일 주소가 없다(공개 레포)');
  }
});
