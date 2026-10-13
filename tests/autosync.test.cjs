/* Tampermonkey 자동 동기화 — CMS 탭(콘솔 자동 모드) ↔ GM 저장소 ↔ 업무일지 탭 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const CMS='https://cms.unpa.me', WL_ORIGIN='https://moowillbedone.github.io';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f,ms=10000){ const t=Date.now(); while(!f()){ if(Date.now()-t>ms) throw Error('timeout'); await sleep(10); } }

/* 탭끼리 공유하는 가짜 Tampermonkey 저장소 */
function gmStore(){
  const v={}, ls=[];
  return { v,
    api(tab){ return {
      GM_getValue:(k,d)=>k in v?JSON.parse(JSON.stringify(v[k])):d,
      GM_setValue:(k,x)=>{ const o=v[k]; v[k]=x; ls.filter(l=>l.k===k).forEach(l=>setTimeout(()=>l.f(k,o,x,l.tab!==tab),0)); },
      GM_addValueChangeListener:(k,f)=>{ ls.push({k,f,tab}); },
    }; } };
}
/* 한 탭 = 가짜 window. postMessage 는 같은 창의 message 리스너 모두에게 간다 */
function makeTab(origin,pathname,body){
  const attrs={}, listeners=[], scripts=[];
  const el=()=>({style:{},appendChild(){},remove(){},addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,set innerHTML(v){},get innerHTML(){return '';}});
  const w={
    location:{hostname:new URL(origin).hostname,origin,pathname,search:'',hash:''},
    document:{documentElement:{getAttribute:k=>k in attrs?attrs[k]:null,setAttribute:(k,x)=>{attrs[k]=String(x);},removeAttribute:k=>{delete attrs[k];}},
              body:{innerText:body||'',appendChild:s=>scripts.push(s)},head:{appendChild:s=>scripts.push(s)},
              getElementById:()=>null,createElement:el,querySelectorAll:()=>[],querySelector:()=>null,visibilityState:'visible'},
    addEventListener(t,f){ if(t==='message') listeners.push(f); },
    removeEventListener(t,f){ const i=listeners.indexOf(f); if(i>=0) listeners.splice(i,1); },
    postMessage(data,target){ const d=JSON.parse(JSON.stringify(data)); setTimeout(()=>listeners.slice().forEach(f=>f({origin,source:w,data:d})),0); },
    setTimeout,clearTimeout,setInterval:()=>0,crypto:globalThis.crypto,Uint8Array,Date,JSON,Math,
  };
  w.window=w; w.__attrs=attrs; w.__scripts=scripts;
  return w;
}
function loadUserscript(tab,gm){
  const code=fs.readFileSync(path.join(root,'unpa-autosync.user.js'),'utf8');
  Object.assign(tab,gm);
  vm.createContext(tab); vm.runInContext(code,tab);
}
/* CMS 탭에 콘솔을 "주입된 script" 대신 직접 실행한다 — 네트워크는 가짜 */
function runConsole(tab){
  const code=fs.readFileSync(path.join(root,'cms-console.js'),'utf8');
  const store={};
  const today=new Date(), ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const ctx=Object.assign(Object.create(null),{
    location:tab.location, document:tab.document, history:{replaceState(){}},
    localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;},removeItem:k=>{delete store[k];}},
    URLSearchParams:class{get(){return null;}},URL,AbortController,setTimeout,clearTimeout,Set,Date,JSON,Math,
    WorklogCore:require('../worklog-core.js'),crypto:globalThis.crypto,alert:m=>{ctx.__alert=m;},
    addEventListener:(t,f)=>tab.addEventListener(t,f), removeEventListener:(t,f)=>tab.removeEventListener(t,f),
    postMessage:(d,o)=>tab.postMessage(d,o), open:(...a)=>{ ctx.__opened=a; return null; }, close:()=>{ ctx.__closed=true; },
    fetch:async url=>{
      url=String(url); let body={};
      if(url.indexOf('/users/profile')>=0) body={email:'me@example.com'};
      else if(url.indexOf('/admin/reviews?')>=0 && url.indexOf('beforeApproval=true')>=0) body={results:[]};
      else if(url.indexOf('/admin/reviews?')>=0)
        body={results: url.indexOf('startDate='+ymd(today))>=0
          ? [{id:555,status:'APPROVED',approvedAt:today.toISOString(),revisedBy:['me@example.com'],brandName:'B',productName:'P',createdAt:today.toISOString()}] : []};
      else if(url.indexOf('/admin/products?')>=0) body={results:[]};
      const t=JSON.stringify(body); return {status:200,text:async()=>t,json:async()=>JSON.parse(t)};
    },
  });
  ctx.window=ctx; ctx.XMLHttpRequest=function(){}; ctx.XMLHttpRequest.prototype={open(){},setRequestHeader(){}};
  vm.createContext(ctx); vm.runInContext(code,ctx);
  return ctx;
}

test('the userscript header installs from the worklog site and only touches CMS and the worklog',()=>{
  const code=fs.readFileSync(path.join(root,'unpa-autosync.user.js'),'utf8');
  const head=code.split('// ==/UserScript==')[0];
  assert.match(head,/@match\s+https:\/\/cms\.unpa\.me\/\*/);
  assert.match(head,/@match\s+https:\/\/moowillbedone\.github\.io\/unpa-worklog\/\*/);
  assert.equal((head.match(/@match/g)||[]).length,2);
  assert.match(head,/@updateURL\s+https:\/\/moowillbedone\.github\.io\/unpa-worklog\/unpa-autosync\.user\.js/);
  assert.doesNotMatch(head,/@grant\s+(unsafeWindow|GM_xmlhttpRequest|GM_download)/,'페이지 권한·외부 요청 권한은 쓰지 않는다');
});

test('CMS tab collects automatically and the worklog tab applies it — no popup, result comes back',async()=>{
  const gm=gmStore();
  const cms=makeTab(CMS,'/review/list/all','CMS MENU 리뷰 관리');
  const wl=makeTab(WL_ORIGIN,'/unpa-worklog/','');
  loadUserscript(cms,gm.api('cms')); loadUserscript(wl,gm.api('wl'));
  assert.equal(wl.__attrs['data-unpa-autosync'],'1.0.0','업무일지 화면이 설치 여부를 알 수 있다');

  /* 업무일지 화면 쪽: 받을 준비 + 반영 흉내 */
  const applied=[];
  wl.addEventListener('message',ev=>{
    if(ev.data.type!=='unpa-autosync-apply') return;
    applied.push(ev.data.payload);
    wl.postMessage({type:'unpa-autosync-applied',id:ev.data.id,res:{ok:true,today:{r:1,p:0},nChanges:1,cloud:'off'}},WL_ORIGIN);
  });
  wl.__attrs['data-unpa-autosync-ready']='1';

  /* CMS 탭: 1.5초 뒤 처음 시도 → 콘솔 스크립트를 넣는다 */
  await until(()=>cms.__scripts.length===1,4000);
  assert.match(cms.__scripts[0].src,/^https:\/\/moowillbedone\.github\.io\/unpa-worklog\/cms-console\.js\?t=\d+$/);
  const nonce=cms.__attrs['data-unpa-autosync-run'];
  assert.match(nonce,/^[a-f0-9]{32}$/);
  const con=runConsole(cms);                      /* 브라우저라면 넣은 script 가 실행된다 */
  assert.equal(cms.__attrs['data-unpa-autosync-run'],undefined,'번호는 한 번만 쓴다');

  await until(()=>applied.length===1);
  assert.equal(con.__opened,undefined,'팝업을 열지 않는다');
  assert.equal(JSON.stringify(applied[0].work.reviews.map(r=>r[0])),'["555"]');
  assert.equal(typeof gm.v.lastRun,'number');
  assert.equal(gm.v.lock,null,'끝나면 다른 탭도 돌 수 있게 푼다');
  await until(()=>gm.v.result && gm.v.result.res.ok===true);
  assert.equal(gm.v.appliedAt,gm.v.payload.at);
});

test('a worklog [update] request runs right away even inside the 30-minute window',async()=>{
  const gm=gmStore();
  gm.v.lastRun=Date.now();                       /* 방금 돌았다 — 평소라면 30분 기다린다 */
  const cms=makeTab(CMS,'/review/list/all','CMS MENU');
  const wl=makeTab(WL_ORIGIN,'/unpa-worklog/index.html','');
  loadUserscript(cms,gm.api('cms')); loadUserscript(wl,gm.api('wl'));
  await sleep(2200);
  assert.equal(cms.__scripts.length,0,'30분 안에는 저절로 돌지 않는다');
  const acks=[];
  wl.addEventListener('message',ev=>{ if(ev.data.type==='unpa-autosync-ack') acks.push(ev.data); });
  wl.postMessage({type:'unpa-autosync-request'},WL_ORIGIN);   /* 업무일지 [🔄 업데이트] */
  await until(()=>cms.__scripts.length===1,4000);
  await until(()=>acks.length===1);
  /* 다음 테스트에 남지 않게 실행 잠금을 푼다 */
  cms.postMessage({type:'unpa-auto-fail',nonce:cms.__attrs['data-unpa-autosync-run'],error:'test end'},CMS);
});

test('nothing runs on the CMS login screen or on other worklog pages',async()=>{
  const gm=gmStore();
  const login=makeTab(CMS,'/login','이메일 비밀번호 로그인');
  const tools=makeTab(WL_ORIGIN,'/unpa-worklog/tools.html','');
  loadUserscript(login,gm.api('a')); loadUserscript(tools,gm.api('b'));
  await sleep(2200);
  assert.equal(login.__scripts.length,0);
  assert.equal(tools.__attrs['data-unpa-autosync'],undefined);
});
