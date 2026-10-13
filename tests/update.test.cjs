/* 업무일지 [🔄 업데이트] — 북마클릿 주소와 콘솔의 업데이트 전용 모드 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const WL_ORIGIN='https://moowillbedone.github.io';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,ms=8000){ const t=Date.now(); while(!f()){ if(Date.now()-t>ms) throw Error('timeout'); await sleep(10); } }

/* index.html 의 북마클릿 주소 만들기만 떼어 실행한다 */
function bookmarklet(){
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const src=html.split("const WL_BASE=")[1].split('function updCmsUrl')[0];
  const ctx={}; vm.createContext(ctx);
  vm.runInContext("const WL_BASE="+src+";globalThis.bm=updBookmarklet();",ctx);
  return ctx.bm;
}

test('the update bookmarklet is plain ASCII and only runs on the CMS',()=>{
  const bm=bookmarklet();
  assert.match(bm,/^javascript:\(function\(\)\{/);
  assert.equal(/[^\x00-\x7f]/.test(bm),false,'즐겨찾기 주소에 한글이 그대로 들어가면 안 된다');
  assert.equal(bm.indexOf('%'),-1,'주소창이 % 를 풀어 버리므로 쓰지 않는다');
  const body=bm.slice('javascript:'.length);
  /* 업무일지 화면에서 누르면 안내만 하고 아무것도 열지 않는다 */
  const off={location:{hostname:'moowillbedone.github.io'},alert:m=>{off.msg=m;},open:()=>{ off.opened=true; }};
  off.window=off; vm.createContext(off); vm.runInContext(body,off);
  assert.match(off.msg,/cms\.unpa\.me/); assert.equal(off.opened,undefined);
  /* CMS 에서 누르면 동기화 창을 먼저 열고(팝업 차단 회피) 콘솔을 업데이트 전용으로 부른다 */
  const win={document:{title:'',body:{style:{},textContent:''}},close(){}};
  const scripts=[];
  const on={location:{hostname:'cms.unpa.me'},Date,alert:()=>{},open:(...a)=>{ on.openArgs=a; return win; },
    document:{createElement:()=>({}),body:{appendChild:s=>scripts.push(s)}}};
  on.window=on; vm.createContext(on); vm.runInContext(body,on);
  assert.equal(on.openArgs[1],'unpa-worklog-sync');
  assert.equal(on.__UNPA_SYNC_ONLY,1); assert.equal(on.__UNPA_SYNC_WIN,win);
  assert.match(win.document.body.textContent,/업무일지 집계/);
  assert.match(scripts[0].src,/^https:\/\/moowillbedone\.github\.io\/unpa-worklog\/cms-console\.js\?t=\d+$/);
});

/* cms-console.js 를 업데이트 전용으로 실행한다 — 네트워크는 전부 가짜 */
function syncOnlyHarness(hash){
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const store={}, posted=[];
  const win={closed:false,location:{href:''},postMessage:(m,o)=>posted.push({m,o}),close(){ win.closed=true; }};
  const el=()=>({style:{},appendChild(){},remove(){},addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,
                 set innerHTML(v){},get innerHTML(){return '';}});
  const today=new Date(), ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const ctx={
    location:{hostname:'cms.unpa.me',origin:'https://cms.unpa.me',search:'',hash:hash||'',pathname:'/review/list/all'},
    history:{replaceState(){}},
    document:{getElementById:()=>null,createElement:el,body:{appendChild(){}},head:{appendChild(){}},querySelectorAll:()=>[],querySelector:()=>null},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{get(){return null;}},URL,AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    WorklogCore:require('../worklog-core.js'),crypto:globalThis.crypto,alert:m=>{ctx.__alert=m;},
    __listeners:[],addEventListener(t,f){ if(t==='message') ctx.__listeners.push(f); },
    removeEventListener(t,f){ ctx.__listeners=ctx.__listeners.filter(x=>x!==f); },
    open:(...a)=>{ ctx.__opened=a; return null; }, close:()=>{ ctx.__closed=true; },
    fetch:async url=>{
      url=String(url); let body={};
      if(url.indexOf('/users/profile')>=0) body={email:'me@example.com'};
      else if(url.indexOf('/admin/reviews?')>=0)
        body={results: url.indexOf('startDate='+ymd(today))>=0
          ? [{id:777,status:'APPROVED',approvedAt:today.toISOString(),revisedBy:['me@example.com'],brandName:'B',productName:'P',createdAt:today.toISOString()}] : []};
      else if(url.indexOf('/admin/products?')>=0) body={results:[]};
      const t=JSON.stringify(body); return {status:200,text:async()=>t,json:async()=>JSON.parse(t)};
    },
    __UNPA_SYNC_ONLY:1,__UNPA_SYNC_WIN:win,
  };
  ctx.window=ctx; ctx.XMLHttpRequest=function(){}; ctx.XMLHttpRequest.prototype={open(){},setRequestHeader(){}};
  vm.createContext(ctx); vm.runInContext(code,ctx);
  const send=data=>ctx.__listeners.slice().forEach(f=>f({origin:WL_ORIGIN,source:win,data}));
  return {ctx,win,posted,send,store};
}

test('update-only mode reuses the pre-opened window and leaves the backlog untouched',async()=>{
  const {ctx,win,posted,send}=syncOnlyHarness('#unpa-wl-update');
  await until(()=>/sync\.html#n=/.test(win.location.href));
  const nonce=win.location.href.split('#n=')[1];
  send({type:'unpa-sync-ready',nonce});                         /* 동기화 창이 먼저 준비된 경우 */
  await until(()=>posted.some(p=>p.m.type==='unpa-sync-data'));
  const data=posted.find(p=>p.m.type==='unpa-sync-data');
  assert.equal(data.o,WL_ORIGIN); assert.equal(data.m.nonce,nonce);
  assert.equal(ctx.__opened,undefined,'새 팝업을 열지 않는다');
  const p=data.m.payload;
  assert.equal(p.pending,null,'남은 일 목록을 스캔하지 않았으니 비우지 않는다');
  assert.equal(p.backlog,null); assert.equal(p.remain,null);
  assert.equal(JSON.stringify(p.work.reviews.map(r=>r[0])),'["777"]');
  send({type:'unpa-sync-done',nonce,ok:true,today:{r:1,p:0},nChanges:1,cloud:'off'});
  /* 업무일지 버튼이 연 탭이면 5초 뒤 닫는다 */
  await until(()=>ctx.__closed===true,7000);
});

test('update-only mode posts as soon as the window is ready even if it was slower than the CMS',async()=>{
  const {win,posted,send}=syncOnlyHarness('');
  await until(()=>/sync\.html#n=/.test(win.location.href));
  await sleep(300);                                              /* 집계가 먼저 끝나고 창이 늦게 준비된 경우 */
  const nonce=win.location.href.split('#n=')[1];
  send({type:'unpa-sync-ready',nonce:'wrong'});                  /* 다른 번호는 무시 */
  await sleep(50);
  assert.equal(posted.some(p=>p.m.type==='unpa-sync-data'),false);
  send({type:'unpa-sync-ready',nonce});
  await until(()=>posted.some(p=>p.m.type==='unpa-sync-data'));
  assert.equal(posted.filter(p=>p.m.type==='unpa-sync-data').length,1,'한 번만 보낸다');
  send({type:'unpa-sync-done',nonce,ok:true,today:{r:1,p:0}});   /* 응답 대기 타이머 정리 — 업무일지 버튼이 연 탭이 아니면 닫지 않는다 */
  await sleep(50);
});
