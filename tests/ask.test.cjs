/* 📋 요청 문구 — 채팅에 붙여 넣을 '언파 검수' 한 줄 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function askWork(o,ex,peer){
  const fn=html.split('function askWork(o,ex,peer){')[1].split('\nfunction askLoad')[0];
  const ctx={JSON,Object,String,Array};
  vm.createContext(ctx); vm.runInContext('function askWork(o,ex,peer){'+fn+';globalThis.f=askWork;',ctx);
  return JSON.parse(JSON.stringify(ctx.f(o,ex,peer)));
}
const row=(id,d,status,extra)=>Object.assign({id,d,brand:'b',product:'p',status},extra||{});

test('new reviews are counted per 작성일 and 수정완료 ids are listed, behind the 언파 검수 keyword',()=>{
  const w=askWork({at:'2026-10-18T09:00:00Z',backlog:[
    row('483700','2026-10-18','WAITING'),row('483701','2026-10-18','WAITING'),row('483650','2026-10-16','WAITING'),
    row('482796','2026-10-14','UPDATED'),row('480343','2026-10-08','UPDATED'),
  ]},null);
  assert.deepEqual(w.dates,[{d:'2026-10-16',n:1},{d:'2026-10-18',n:2}],'날짜는 오래된 순');
  assert.equal(w.n,3);
  assert.deepEqual(w.upd,['482796','480343']);
  assert.equal(w.text,'언파 검수 — 10/16 1건 · 10/18 2건 전체 진행해줘 (승인·수정요청·미노출·제품/브랜드 등록까지) / 수정완료 2건 검토해줘: 482796, 480343');
  assert.equal(w.at,'2026-10-18T09:00:00Z');
});

test('suspended users and reviews already parked in 검수 예외 stay out of the request',()=>{
  const ex={v:1,items:{
    '482494':{id:'482494',status:'hold'},                 /* 보류 — 컨펌 기다리는 건은 새 리뷰가 아니다 */
    '478039':{id:'478039',status:'hold',ign:true},       /* 무시 — 수정완료여도 뺀다 */
    '470186':{id:'470186',status:'done'},                 /* 예외지만 무시는 아님 — 수정완료면 ✏️ 배지처럼 남긴다 */
  }};
  const w=askWork({backlog:[
    row('482494','2026-10-14','WAITING'),row('482665','2026-10-14','WAITING',{blocked:true}),
    row('478039','2026-09-30','UPDATED'),row('470186','2026-09-11','UPDATED'),row('481000','2026-10-10','UPDATED',{blocked:true}),
  ]},ex);
  assert.deepEqual(w.dates,[]);
  assert.deepEqual(w.upd,['470186']);
  assert.equal(w.text,'언파 검수 — 수정완료 1건 검토해줘: 470186');
});

test('only new reviews → no 수정완료 part; nothing left → empty text so the copy button turns off',()=>{
  assert.equal(askWork({backlog:[row('483700','2026-10-18','WAITING')]},null).text,
    '언파 검수 — 10/18 1건 전체 진행해줘 (승인·수정요청·미노출·제품/브랜드 등록까지)');
  const none=askWork({backlog:[]},{v:1,items:{}});
  assert.equal(none.text,''); assert.equal(none.n,0); assert.deepEqual(none.upd,[]);
  assert.equal(askWork(null,null).text,'','동기화 전(목록 없음)에도 깨지지 않는다');
  assert.equal(askWork({backlog:[row('1','bad-date','WAITING'),null,{d:'2026-10-18'}]},null).text,'','날짜·번호가 이상한 줄은 버린다');
});

test('the header button, the modal and its copy button are wired to the same text',()=>{
  assert.match(html,/id="askBtn"[^>]*>📋 요청 문구<b id="askN"><\/b><\/button>/);
  assert.match(html,/id="askMask" hidden/);
  assert.match(html,/\$\('#askCopy'\)\.onclick=async\(\)=>\{\s*const \{text\}=askLoad\(\);/);
  /* 예외를 바꾸거나 동기화가 끝나 ✏️ 배지를 다시 셀 때 📋 숫자도 함께 바뀐다 */
  const badge=html.split('function renderUpdBadge(){')[1].split('\n}')[0];
  assert.match(badge,/renderAsk\(\);/);
});

test('the 컨펌 대기 hint counts 보류 and 도용 separately, matching the 검수 예외 tabs',()=>{
  const fn=html.split('function askWaiting(ex){')[1].split('\nfunction askLoad')[0];
  const ctx={Object}; vm.createContext(ctx); vm.runInContext('function askWaiting(ex){'+fn+';globalThis.f=askWaiting;',ctx);
  const n=ex=>JSON.parse(JSON.stringify(ctx.f(ex)));
  assert.deepEqual(n({items:{
    '483314':{id:'483314',kind:'plagiarism',status:'hold'},      /* 도용인데 아직 컨펌 대기 → 도용 탭 */
    '482750':{id:'482750',kind:'plagiarism',status:'sent'},      /* 수정요청 보냄 → 대기 아님 */
    '483589':{id:'483589',kind:'medicine',status:'hold'},
    '483418':{id:'483418',kind:'no_price',status:'listed'},
    '478039':{id:'478039',kind:'other',status:'hold',ign:true},  /* 무시 → 안 셈 */
  }}),{hold:2,plag:1});
  assert.deepEqual(n(null),{hold:0,plag:0});
  assert.match(html,/검수 예외의 '\+waitTabs\+' 탭에서/,'안내 문구가 보류·도용 탭 이름을 함께 말한다');
});

/* 동료에게 맡긴 작성일 (업무일지 동료 검수 칸의 [맡김]) — 2026-10-31 */
test('dates handed to the colleague stay out of the request, new reviews and 수정완료 alike, and are counted apart',()=>{
  const o={at:'2026-10-31T09:00:00Z',backlog:[
    row('487500','2026-10-28','PENDING'),row('487501','2026-10-28','PENDING'),row('487502','2026-10-28','UPDATED'),
    row('487900','2026-10-30','PENDING'),row('488000','2026-10-31','PENDING'),row('486600','2026-10-26','UPDATED'),
    row('487503','2026-10-28','PENDING',{blocked:true}),
  ]};
  const w=askWork(o,null,new Set(['2026-10-28','2026-10-30']));
  assert.deepEqual(w.dates,[{d:'2026-10-31',n:1}],'맡긴 10/28·10/30 은 새 리뷰에서 빠진다');
  assert.deepEqual(w.upd,['486600'],'맡긴 날의 수정완료(487502)도 내 요청에서 빠진다');
  assert.deepEqual(w.peer,[{d:'2026-10-28',n:3},{d:'2026-10-30',n:1}],'맡긴 날 남은 건수는 따로 — 정지 사용자 건은 세지 않는다');
  assert.equal(w.text,'언파 검수 — 10/31 1건 전체 진행해줘 (승인·수정요청·미노출·제품/브랜드 등록까지) / 수정완료 1건 검토해줘: 486600');
  /* 배열로 넘겨도, 안 넘겨도 된다 */
  assert.deepEqual(askWork(o,null,['2026-10-30']).peer,[{d:'2026-10-30',n:1}]);
  const none=askWork(o,null);
  assert.deepEqual(none.peer,[]); assert.equal(none.n,4,'맡긴 날을 안 넘기면 10/28·10/30 도 내 새 리뷰로 센다');
  /* 전부 맡긴 날이면 보낼 문구가 없다 */
  assert.equal(askWork({backlog:[row('1','2026-10-28','PENDING')]},null,new Set(['2026-10-28'])).text,'');
});

test('the request modal, the ✏️ badge and the update summary all read the same handed-off dates',()=>{
  assert.match(html,/return askWork\(o,ex,peerDaySet\(\)\);/,'📋 요청 문구는 업무일지에 표시한 맡긴 날을 쓴다');
  const upd=html.split('function updatedReviews(){')[1].split('\nfunction renderUpdList')[0];
  assert.match(upd,/peerDaySet\(\)/,'✏️ 수정완료 배지도');
  assert.match(html,/\+\(info\.remain\?updRemainHtml\(info\.remain\):''\)/,'업데이트 결과의 남은 검수도');
});
