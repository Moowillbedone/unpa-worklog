/* ============================================================
 * 리뷰 검수 콘솔 — cms-console.js   (수집→자동판정→실행 통합)
 *
 *  하나의 도구로: 그날 리뷰를 모으고, 각 건을 자동 판정하고,
 *  대기열을 보여준 뒤, 골라서 실제 처리(수정요청/미노출)까지.
 *
 *  자동으로 하는 것
 *   - 엑박 판별(productPrice 없음)
 *   - 브랜드 유무(/admin/brands?q=) · 제품 유무(/admin/products)
 *   - 본문 도배 · 비화장품 의심(키워드)
 *   - 사진 포렌식: 해상도·비율로 화면캡처/도용/직접촬영 구분
 *
 *  자동으로 "실행"하는 것 (사용자가 대기열 보고 승인해야)
 *   - 수정요청(revise) · 미노출(hide)
 *  사람이 최종 판단 (자동 실행 안 함)
 *   - 승인(approve) : 사진 의미확인 필요 → "👀 확인"
 *   - 상품등록(register) : 데이터 입력 필요
 *
 *  안전장치: 로드 시 아무것도 안 보냄. 대기열에서 골라 [실행]+확인창.
 *            건별 로그 · 에러 시 중단 · 개수 상한 · 처리 로그 저장.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }
  try { var old = document.getElementById('cmsConsoleBox'); if (old) old.remove(); } catch (e) {}
  if (window.__CONSOLE_RUNNING) { alert('이미 실행 중입니다.'); return; }

  var API = 'https://api-v2.unpa.me';
  var TPL_URL = 'https://moowillbedone.github.io/unpa-worklog/templates.json';
  var MAX_EXEC = 100;
  var AUTH = window.__COLLECT_AUTH || window.__BRAND_AUTH || window.__PROD_AUTH || window.__APPLY_AUTH || window.__CONSOLE_AUTH || null;

  /* 화면캡처 판별용 알려진 폰 해상도 */
  var SCREENS = [[1170,2532],[1179,2556],[1290,2796],[1284,2778],[1125,2436],[1206,2622],[1320,2868],
                 [750,1334],[828,1792],[1080,2340],[1080,2400],[1080,1920],[1440,3040],[1440,3200],[1080,2280],[720,1280]];
  /* 비화장품 의심 키워드 */
  var NONCOSMETIC = ['오메가','프로바이오틱','유산균','낙산균','식이섬유','영양제','비타민','루테인','밀크씨슬',
                     '락스','세제','섬유유연','청결티슈','물티슈','칫솔','치약','건강기능','다이어트','효소','콜라겐젤리','젤리스틱'];

  /* ── 인증 가로채기 ── */
  function grab(h){ try{ if(!h) return; var o={};
    if(h.forEach) h.forEach(function(v,k){o[k.toLowerCase()]=v;});
    else if(typeof h==='object') Object.keys(h).forEach(function(k){o[k.toLowerCase()]=h[k];});
    if(o.authorization){AUTH=o.authorization;window.__CONSOLE_AUTH=AUTH;window.__COLLECT_AUTH=AUTH;} }catch(e){} }
  var oF = window.__COLLECT_OF || window.fetch;
  window.__COLLECT_OF = oF;
  window.fetch = function(){ var a=arguments;
    try{ var u=String((a[0]&&a[0].url)||a[0]||'');
      if(u.indexOf('/admin/')>=0){ if(a[0]&&a[0].headers) grab(a[0].headers); if(a[1]&&a[1].headers) grab(a[1].headers);} }catch(e){}
    return oF.apply(this,a); };
  if(!window.__COLLECT_XHOOK){ window.__COLLECT_XHOOK=true;
    var OSH=XMLHttpRequest.prototype.setRequestHeader, OX=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return OX.apply(this,arguments);};
    XMLHttpRequest.prototype.setRequestHeader=function(k,v){
      try{ if(String(k).toLowerCase()==='authorization'&&String(this.__u).indexOf('/admin/')>=0){AUTH=v;window.__CONSOLE_AUTH=v;window.__COLLECT_AUTH=v;} }catch(e){}
      return OSH.apply(this,arguments); }; }

  function H(){ var h={'Accept':'application/json'}; if(AUTH) h['Authorization']=AUTH; return h; }
  function Hj(){ var h=H(); h['Content-Type']='application/json'; return h; }
  function get(url){ return oF.call(window,url,{headers:H(),credentials:'include'})
    .then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t);}catch(e){}return{status:r.status,json:j,text:t.slice(0,200)};});})
    .catch(function(e){return{status:0,json:null,text:String(e&&e.message||e)};}); }
  function send(method,url,body){ return oF.call(window,url,{method:method,headers:Hj(),credentials:'include',body:body?JSON.stringify(body):undefined})
    .then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t);}catch(e){}return{status:r.status,json:j,text:t.slice(0,300)};});})
    .catch(function(e){return{status:0,json:null,text:String(e&&e.message||e)};}); }
  function listOf(j){ if(!j) return null;
    return Array.isArray(j.results)?j.results:Array.isArray(j.result)?j.result:Array.isArray(j.data)?j.data:Array.isArray(j.content)?j.content:Array.isArray(j)?j:null; }
  function totalOf(j){ return (j&&(j.totalCount||j.total||j.count))||0; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
  function norm(s){ return String(s||'').replace(/[\s()\[\]/·.,-]/g,'').toLowerCase(); }
  function delay(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

  /* ── 사진 포렌식 ── */
  function imgDims(url){ return new Promise(function(res){ var im=new Image();
    var done=false; var to=setTimeout(function(){if(!done){done=true;res({w:0,h:0});}},8000);
    im.onload=function(){if(!done){done=true;clearTimeout(to);res({w:im.naturalWidth,h:im.naturalHeight});}};
    im.onerror=function(){if(!done){done=true;clearTimeout(to);res({w:0,h:0});}};
    im.src=url; }); }
  function near(a,b,t){ return Math.abs(a-b)<=t; }
  function classifyImg(w,h){
    if(!w||!h) return 'broken';
    var mx=Math.max(w,h);
    for(var i=0;i<SCREENS.length;i++){ var a=SCREENS[i][0],b=SCREENS[i][1];
      if((near(w,a,4)&&near(h,b,4))||(near(w,b,4)&&near(h,a,4))) return 'screenshot'; }
    if(mx>=2000) return 'camera';
    if(mx<=1000) return 'web';
    return 'unknown';
  }
  function photoVerdict(cls){
    if(!cls.length) return {v:'none',label:'사진 없음'};
    var has=function(x){return cls.indexOf(x)>=0;};
    if(has('screenshot')) return {v:'suspect',label:'화면캡처 의심'};
    if(has('web')) return {v:'suspect',label:'저해상/도용 의심'};
    if(has('camera')) return {v:'camera',label:'직접촬영'};
    return {v:'unknown',label:'판별 애매'};
  }

  /* ── 본문 도배 / 비화장품 ── */
  function isSpam(text){
    var t=String(text||'').trim(); if(t.length<20) return false;
    var lines=t.split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
    if(lines.length>=3){ var uniq={}; lines.forEach(function(l){uniq[l]=(uniq[l]||0)+1;});
      var u=Object.keys(uniq).length; if(u/lines.length<=0.5) return true;
      var mx=0; Object.keys(uniq).forEach(function(k){if(uniq[k]>mx)mx=uniq[k];}); if(mx>=3) return true; }
    /* 문장 반복 */
    var sents=t.split(/[.!?\n]/).map(function(s){return s.trim();}).filter(function(s){return s.length>=8;});
    if(sents.length>=3){ var us={}; sents.forEach(function(s){us[s]=(us[s]||0)+1;});
      if(Object.keys(us).length/sents.length<=0.5) return true; }
    return false;
  }
  function nonCosmetic(name){ var n=String(name||''); for(var i=0;i<NONCOSMETIC.length;i++){ if(n.indexOf(NONCOSMETIC[i])>=0) return NONCOSMETIC[i]; } return null; }

  /* ── 브랜드/제품 검색 ── */
  var brandCache={};
  async function findBrand(name){
    var key=norm(name); if(brandCache[key]!==undefined) return brandCache[key];
    var r=await get(API+'/admin/brands?approved=true&page=1&pageSize=50&q='+encodeURIComponent(name));
    var rows=listOf(r.json)||[];
    var exact=rows.filter(function(b){return norm(b.name)===key;});
    var appr=exact.filter(function(b){return b.approved;});
    var pick = appr.length?appr.sort(function(a,b){return a.id-b.id;})[0] : null;
    var res={ approvedBrand:pick, anyExact:exact.length>0, exact:exact };
    brandCache[key]=res; return res;
  }
  function tokenize(name){
    var clean=String(name).replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ').replace(/[0-9]+/g,' ');
    var words=clean.split(/\s+/).filter(function(w){return w.length>=2;}); var set={};
    words.forEach(function(w){set[w]=1;});
    words.forEach(function(w){ if(w.length>=6) set[w.slice(0,Math.ceil(w.length/2))]=1; });
    var t=Object.keys(set).slice(0,5); if(!t.length) t=[String(name).slice(0,4)]; return t;
  }
  async function findProduct(brandId, productName){
    var toks=tokenize(productName); var seen={}, cand=[];
    for(var i=0;i<toks.length;i++){
      var r=await get(API+'/admin/products?approved=true&brandApproved=true&page=1&pageSize=20&brandId='+brandId+'&q='+encodeURIComponent(toks[i]));
      var rows=listOf(r.json)||[];
      rows.forEach(function(p){ if(p&&p.id!=null&&!seen[p.id]){seen[p.id]=1;cand.push({id:p.id,name:p.name||p.productName||''});} });
      await delay(80);
    }
    var target=norm(productName.replace(/\[[^\]]*\]/g,''));
    var exact=cand.filter(function(p){ var pn=norm(p.name); return pn===target || target.indexOf(pn)>=0 || pn.indexOf(target)>=0; });
    return { exact: exact[0]||null, candidates: cand };
  }

  /* ── 판정 ── */
  async function classify(item, detail){
    var pid=detail.productId, price=detail.productPrice, content=detail.contentText||detail.content||'';
    var atts=(detail.attachments||[]).filter(Boolean);
    var exbak = !!pid && (price===null||price===''||price===0||price===undefined);
    var out={ id:item.id, brand:item.brandName, product:item.productName, user:item.userNickname,
              visible:item.visible, exbak:exbak, reasons:[], photo:null, action:null, exec:false, msg:null, product_exact:null };

    /* 사진 포렌식 (첨부 최대 4장) */
    var cls=[]; for(var i=0;i<Math.min(atts.length,4);i++){ var d=await imgDims(atts[i]); cls.push(classifyImg(d.w,d.h)); }
    out.photo=photoVerdict(cls); out.photoCls=cls;

    /* 1) 본문 도배 */
    if(isSpam(content)){ out.action='hide'; out.exec=true; out.reasons.push('본문 도배'); return out; }
    /* 2) 비화장품 의심 → 확인(hold) */
    var nc=nonCosmetic(item.productName+' '+item.brandName);
    if(nc){ out.action='hold'; out.reasons.push('화장품 아님 의심('+nc+')'); /* fall through 아님 */ return out; }

    if(exbak){
      var b=await findBrand(item.brandName);
      if(b.approvedBrand){
        var pr=await findProduct(b.approvedBrand.id, item.productName);
        if(pr.exact){ out.action='revise'; out.exec=true; out.product_exact=pr.exact.name;
          out.reasons.push('브랜드○ 제품○ → 재선택 요청'); }
        else { out.action='register'; out.reasons.push('브랜드○ 제품✗ → 상품등록 필요'); }
      } else {
        out.action='register';
        out.reasons.push(b.anyExact?'브랜드 미검수만 → 등록 필요':'브랜드 미등록 → 브랜드+상품 등록');
      }
      return out;
    }

    /* 3) 정상 매칭 리뷰 → 사진으로 판단 */
    if(out.photo.v==='suspect'){ out.action='hide'; out.exec=true; out.reasons.push('사진 '+out.photo.label); return out; }
    if(out.photo.v==='camera'){ out.action='hold'; out.reasons.push('직접촬영 → 사진 의미확인 후 승인'); return out; }
    if(out.photo.v==='none'){ out.action='hold'; out.reasons.push('첨부 없음 → 확인'); return out; }
    out.action='hold'; out.reasons.push('사진 판별 애매 → 확인'); return out;
  }

  /* ── 패널 ── */
  var box=document.createElement('div'); box.id='cmsConsoleBox';
  box.style.cssText='position:fixed;top:12px;right:12px;z-index:2147483647;background:#0d1512;color:#e8f1ed;'
    +'border:1px solid #2fb87f;border-radius:14px;padding:15px 17px;'
    +'font:12.5px/1.55 -apple-system,BlinkMacSystemFont,sans-serif;'
    +'box-shadow:0 14px 48px rgba(0,0,0,.55);max-width:420px;max-height:90vh;overflow:auto';
  document.body.appendChild(box);

  var tplMap={}, results=[], logLines=[];
  function log(h){ logLines.push(h); var el=document.getElementById('csLog'); if(el) el.innerHTML=logLines.join('<br>'); }

  var ACT={ revise:{t:'수정요청',c:'#3ddc97'}, hide:{t:'미노출',c:'#ff8f6b'}, register:{t:'상품등록 필요',c:'#f5c451'},
            hold:{t:'👀 확인',c:'#8fb8ff'}, approve:{t:'승인',c:'#3ddc97'} };

  function head(html){ return '<b style="color:#3ddc97">🧭 리뷰 검수 콘솔</b>'+html; }

  function renderStart(sd){
    box.innerHTML=head(
      '<div style="margin-top:9px;color:#9fb4ab">날짜별 검수대기 리뷰를 모아 자동 판정합니다.</div>'
      +'<div style="margin-top:10px">날짜 <input id="csDate" value="'+esc(sd)+'" style="width:120px;background:#132019;color:#e8f1ed;border:1px solid #2c4a3c;border-radius:7px;padding:5px 8px;font:inherit"></div>'
      +'<button id="csScan" style="margin-top:11px;width:100%;background:#3ddc97;color:#04130c;border:0;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">스캔 시작 (읽기만)</button>'
      +'<div style="margin-top:8px;font-size:11px;color:#6b7f77">스캔은 조회만 합니다. 실제 처리는 이후 대기열에서 승인해야 합니다.</div>');
    document.getElementById('csScan').onclick=function(){ var d=document.getElementById('csDate').value.trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)){alert('YYYY-MM-DD 형식으로 입력해주세요.');return;} scan(d); };
  }

  function listUrl(sd,page,size){ return API+'/admin/reviews?pageSize='+size+'&startDate='+sd+'&endDate='+sd+'&beforeApproval=true&page='+page+'&field=CREATED_AT&direction=desc'; }

  async function scan(sd){
    box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">인증 확인 중…</div>');
    var chk=await get(listUrl(sd,1,1));
    if(chk.status!==200||!chk.json){ box.innerHTML=head('<div style="margin-top:9px;color:#ff8f6b">인증/조회 실패 (HTTP '+chk.status+')<br>관리 화면에서 목록을 한 번 불러온 뒤 다시 실행해주세요.</div>'); return; }

    var page=1, all=[], total=0;
    while(page<=30){ box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">목록 수집… <b>'+all.length+'</b>건</div>');
      var r=await get(listUrl(sd,page,100)); var rows=listOf(r.json)||[]; total=totalOf(r.json)||total;
      all=all.concat(rows); if(rows.length<100||all.length>=total) break; page++; }

    /* 이미 처리된(비노출/승인완료) 건은 건너뜀 후보로만 */
    var pending=all;
    results=[];
    for(var i=0;i<pending.length;i++){
      box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">판정 중… <b>'+(i+1)+' / '+pending.length+'</b><br>'
        +esc(pending[i].brandName||'')+' — '+esc(pending[i].productName||'')+'</div>');
      var dr=await get(API+'/admin/reviews/'+pending[i].id);
      var detail=(dr.status===200&&dr.json)?dr.json:{productId:pending[i].productId,productPrice:null,attachments:[],contentText:''};
      var c=await classify(pending[i], detail);
      results.push(c);
      await delay(60);
    }
    renderQueue(sd);
  }

  function renderQueue(sd){
    var groups={revise:[],hide:[],register:[],hold:[]};
    results.forEach(function(r){ (groups[r.action]||(groups[r.action]=[])).push(r); });
    var order=['revise','hide','register','hold'];

    var html='<div style="margin-top:8px;color:#9fb4ab">'+esc(sd)+' · 총 <b style="color:#fff">'+results.length+'</b>건 판정 완료</div>';
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
    order.forEach(function(k){ if(!groups[k]||!groups[k].length) return;
      html+='<span style="font-size:11px;background:#132019;border:1px solid #2c4a3c;border-radius:20px;padding:3px 9px;color:'+ACT[k].c+'">'+ACT[k].t+' <b>'+groups[k].length+'</b></span>'; });
    html+='</div>';

    order.forEach(function(k){ var g=groups[k]; if(!g||!g.length) return;
      var exec = (k==='revise'||k==='hide');
      html+='<div style="margin-top:12px;border-top:1px solid #22392e;padding-top:9px">'
        +'<div style="font-weight:800;color:'+ACT[k].c+'">'+ACT[k].t+' · '+g.length+'건'
        +(exec?' <span style="font-size:10.5px;color:#6b7f77">(자동 실행 가능)</span>':' <span style="font-size:10.5px;color:#6b7f77">(사람 확인)</span>')+'</div>';
      g.forEach(function(r,idx){
        var gid=k+'_'+idx;
        html+='<div style="margin-top:7px;background:#111d18;border:1px solid #22392e;border-radius:8px;padding:8px 10px">'
          +(exec?'<label style="display:flex;gap:7px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="csChk" data-id="'+r.id+'" checked style="margin-top:3px">':'<div>')
          +'<div><b style="color:#cfe">#'+r.id+'</b> <span style="color:#9fb4ab">'+esc(r.brand||'')+' / '+esc(r.product||'')+'</span>'
          +'<div style="font-size:11px;color:#7f948b;margin-top:2px">'+esc(r.reasons.join(' · '))
          + (r.photo&&r.photo.v!=='none'?' · 사진:'+esc(r.photo.label):'')
          + (r.product_exact?' · <span style="color:#3ddc97">→ '+esc(r.product_exact)+'</span>':'')+'</div>'
          +'</div>'+(exec?'</label>':'</div>')
          +'</div>';
      });
      html+='</div>';
    });

    var nExec = (groups.revise.length+groups.hide.length);
    html+='<div style="display:flex;gap:7px;margin-top:14px;flex-wrap:wrap">'
      +'<button id="csRescan" style="flex:1;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">다시</button>'
      +'<button id="csRun" style="flex:2;background:'+(nExec?'#3ddc97':'#22392e')+';color:'+(nExec?'#04130c':'#6b7f77')+';border:0;border-radius:8px;padding:9px;font-weight:800;cursor:'+(nExec?'pointer':'default')+'">체크한 것 실행 ('+nExec+')</button>'
      +'</div>'
      +'<div id="csLog" style="margin-top:10px;font-size:11.5px;color:#9fb4ab"></div>'
      +'<div style="margin-top:7px;font-size:10.5px;color:#6b7f77">실행 = 수정요청·미노출만. 승인·상품등록은 사람이 직접. 에러 시 즉시 중단.</div>';

    box.innerHTML=head(html);
    document.getElementById('csRescan').onclick=function(){ renderStart(sd); };
    if(nExec) document.getElementById('csRun').onclick=function(){ runExec(); };
  }

  async function runExec(){
    if(window.__CONSOLE_RUNNING) return;
    var checks=[].slice.call(document.querySelectorAll('.csChk')).filter(function(c){return c.checked;});
    var ids={}; checks.forEach(function(c){ids[c.dataset.id]=1;});
    var jobs=results.filter(function(r){ return ids[r.id] && (r.action==='revise'||r.action==='hide'); });
    if(!jobs.length){ alert('체크된 실행 대상이 없습니다.'); return; }
    if(jobs.length>MAX_EXEC){ alert('상한('+MAX_EXEC+') 초과. 실행 거부.'); return; }
    var summ=jobs.map(function(r){return '#'+r.id+' '+ACT[r.action].t+(r.product_exact?' ('+r.product_exact+')':'');}).join('\n');
    if(!confirm('실제로 다음 '+jobs.length+'건을 처리합니다. 되돌릴 수 없습니다.\n\n'+summ+'\n\n진행할까요?')) return;

    window.__CONSOLE_RUNNING=true;
    var run=document.getElementById('csRun'); if(run){run.disabled=true;run.textContent='실행 중…';}
    var logs=[];
    for(var i=0;i<jobs.length;i++){ var r=jobs[i]; var req;
      if(r.action==='revise'){ var tpl=tplMap['product_match']; var body=tpl?tpl.body.replace(/\{제품명\}/g,r.product_exact||r.product):null;
        req={method:'POST',url:API+'/admin/reviews/'+r.id+'/revise',body:{content:[body]}}; }
      else { req={method:'PUT',url:API+'/admin/reviews/'+r.id,body:{visible:false}}; }
      log('▶ #'+r.id+' '+ACT[r.action].t+'…');
      var res=await send(req.method,req.url,req.body); var ok=(res.status>=200&&res.status<300);
      logs.push({id:r.id,action:r.action,status:res.status,ok:ok,response:res.json||res.text});
      if(ok){ log('&nbsp;&nbsp;<span style="color:#3ddc97">✓ '+res.status+'</span>'); }
      else { log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ '+res.status+' — 중단</span>'); log('&nbsp;&nbsp;<span style="font-size:11px">'+esc((res.text||'').slice(0,140))+'</span>'); break; }
      await delay(300);
    }
    var out={at:new Date().toISOString(),logs:logs};
    var blob=new Blob([JSON.stringify(out,null,1)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cms-console-log-'+Date.now()+'.json'; document.body.appendChild(a); a.click(); a.remove();
    var okN=logs.filter(function(x){return x.ok;}).length;
    log('<b style="color:'+(okN===logs.length?'#3ddc97':'#ff8f6b')+'">완료 '+okN+'/'+logs.length+' · 로그 저장</b>');
    window.__CONSOLE_RUNNING=false;
  }

  /* ── 시작 ── */
  var qs=new URLSearchParams(location.search); var sd=qs.get('startDate')||new Date().toISOString().slice(0,10);
  box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">템플릿 불러오는 중…</div>');
  oF.call(window,TPL_URL+'?t='+Date.now()).then(function(r){return r.json();}).then(function(d){
    (d.templates||[]).forEach(function(t){tplMap[t.key]=t;}); renderStart(sd);
  }).catch(function(){ renderStart(sd); });
})();
