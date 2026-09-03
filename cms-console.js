/* ============================================================
 * 리뷰 검수 콘솔 — cms-console.js   (수집→자동판정→실행 통합)
 *
 *  하나의 도구로: 그날 리뷰를 모으고, 각 건을 자동 판정하고,
 *  대기열을 보여준 뒤, 골라서 실제 처리(승인/수정요청/미노출)까지.
 *
 *  자동으로 판정하는 것
 *   - 엑박 판별(productPrice 없음)
 *   - 브랜드 유무(/admin/brands?q=) · 제품 유무(/admin/products)
 *   - 본문 도배 · 비화장품 의심(키워드)
 *   - 사진 포렌식: 해상도·비율로 화면캡처/도용/직접촬영 구분
 *     (파일 크기는 보지 않는다 — naturalWidth/Height 만 읽는다)
 *
 *  실행 (전부 사람이 승인해야 나간다)
 *   - 미노출(hide)    : 사진이 "전량" 캡처·저해상일 때만 후보. 상한 30
 *   - 수정요청(revise) : 상품명이 정확히 일치할 때만 후보. 상한 60
 *   - 승인(approve)   : 썸네일 그리드에서 눈으로 훑어 일괄. 상한 300
 *  사람이 CMS에서 직접
 *   - 상품등록(register) : 데이터 입력이 필요해 자동화 대상이 아님
 *
 *  안전장치: 로드 시 아무것도 안 보냄. 대기열/그리드에서 골라 [실행]+확인창.
 *            건별 로그 · 에러 시 즉시 중단 · 액션별 상한 · 처리 로그 저장.
 *            이미 처리된 건은 체크박스가 잠겨 재전송되지 않는다.
 *
 *  업무일지 연동
 *   - [검수기록 JSON] → 업무일지 [검수 기록] 탭에서 불러오기
 *   - [업무일지 반영] → 처리 건수를 해시로 넘겨 확인 카드 표시
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }
  try { var old = document.getElementById('cmsConsoleBox'); if (old) old.remove(); } catch (e) {}
  if (window.__CONSOLE_RUNNING) { alert('이미 실행 중입니다.'); return; }

  var API = 'https://api-v2.unpa.me';
  var TPL_URL = 'https://moowillbedone.github.io/unpa-worklog/templates.json';
  var WORKLOG_URL = 'https://moowillbedone.github.io/unpa-worklog/';
  var SCAN_DATE = null;
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
  /* 사진 종합 판정.
     예전에는 의심 사진이 한 장만 섞여도 리뷰 전체를 미노출로 보냈다.
     공식컷 1장 + 본인 사진 2장 같은 정상 패턴이 통째로 날아가므로,
     전량이 의심일 때만 미노출하고 직접촬영이 섞이면 사람이 보게 넘긴다. */
  function photoVerdict(cls){
    if(!cls.length) return {v:'none',label:'사진 없음'};
    var n=cls.length, cnt=function(x){ var k=0; for(var i=0;i<n;i++) if(cls[i]===x) k++; return k; };
    var cam=cnt('camera'), web=cnt('web'), shot=cnt('screenshot');
    if(shot===n)            return {v:'suspect',label:'전부 화면캡처'};
    if(web===n)             return {v:'suspect',label:'전부 저해상/도용 의심'};
    if(web+shot===n)        return {v:'suspect',label:'전부 캡처·저해상'};
    if(cam>0 && web+shot>0) return {v:'mixed',  label:'직접촬영 '+cam+'/'+n+' · 의심 '+(web+shot)+'장 혼재'};
    if(cam>0)               return {v:'camera', label:'직접촬영'};
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
  /* 상품명 매칭.
     예전에는 부분 문자열만 겹쳐도 매칭으로 쳐서
     "참 틴트 스무디 에디션 라즈베리 믹스" → "참 틴트" 같은 오매칭이 나왔다.
     그 문구를 유저에게 보내면 검색해도 본인 제품이 안 나와 수정요청이 무한 반복된다.
     이제 정확히 일치할 때만 자동 발송하고, 유사할 뿐이면 사람 확인으로 보낸다. */
  var SIM_MIN = 0.8;
  async function findProduct(brandId, productName){
    var toks=tokenize(productName); var seen={}, cand=[];
    for(var i=0;i<toks.length;i++){
      var r=await get(API+'/admin/products?approved=true&brandApproved=true&page=1&pageSize=20&brandId='+brandId+'&q='+encodeURIComponent(toks[i]));
      var rows=listOf(r.json)||[];
      rows.forEach(function(p){ if(p&&p.id!=null&&!seen[p.id]){seen[p.id]=1;cand.push({id:p.id,name:p.name||p.productName||''});} });
      await delay(80);
    }
    var target=norm(productName.replace(/\[[^\]]*\]/g,''));

    var exact=cand.filter(function(p){ return norm(p.name)===target; });
    if(exact.length===1) return { pick:exact[0], confident:true,  why:'상품명 정확히 일치', candidates:cand };
    if(exact.length>1)   return { pick:null,     confident:false, why:'동일 상품명 '+exact.length+'건 — 사람이 선택', candidates:cand };

    /* 포함 관계이되 길이가 충분히 비슷할 때만 후보로 본다 */
    var near=cand.filter(function(p){
      var pn=norm(p.name); if(!pn) return false;
      if(target.indexOf(pn)<0 && pn.indexOf(target)<0) return false;
      var mn=Math.min(pn.length,target.length), mx=Math.max(pn.length,target.length);
      return mx>0 && mn/mx>=SIM_MIN;
    });
    if(near.length===1) return { pick:near[0], confident:false, why:'유사 상품명 「'+near[0].name+'」', candidates:cand };
    if(near.length>1)   return { pick:null,    confident:false, why:'유사 후보 '+near.length+'건', candidates:cand };
    return { pick:null, confident:false, why:'브랜드 안에 해당 제품 없음', candidates:cand };
  }

  /* ── 판정 ── */
  async function classify(item, detail){
    var pid=detail.productId, price=detail.productPrice, content=detail.contentText||detail.content||'';
    var atts=(detail.attachments||[]).filter(Boolean);
    var exbak = !!pid && (price===null||price===''||price===0||price===undefined);
    var out={ id:item.id, brand:item.brandName, product:item.productName, user:item.userNickname,
              visible:item.visible, exbak:exbak, reasons:[], photo:null, action:null, exec:false, msg:null,
              product_exact:null, product_id:null,
              attachments:atts.slice(0,6),   /* 썸네일 그리드에서 눈으로 볼 사진 */
              approvable:false };            /* 그리드에서 일괄 승인해도 되는 건인지 */

    /* 사진 포렌식 (첨부 최대 4장) */
    var cls=[]; for(var i=0;i<Math.min(atts.length,4);i++){ var d=await imgDims(atts[i]); cls.push(classifyImg(d.w,d.h)); }
    out.photo=photoVerdict(cls); out.photoCls=cls;

    /* 1) 본문 도배 */
    if(isSpam(content)){ out.action='hide'; out.exec=true; out.reasons.push('본문 도배'); return out; }
    /* 2) 비화장품 의심 → 확인(hold) */
    var nc=nonCosmetic(item.productName+' '+item.brandName);
    if(nc){ out.action='hold'; out.reasons.push('화장품 아님 의심('+nc+')'); return out; }   /* 품목 판단이라 일괄승인 제외 */

    if(exbak){
      var b=await findBrand(item.brandName);
      if(b.approvedBrand){
        var pr=await findProduct(b.approvedBrand.id, item.productName);
        if(pr.pick && pr.confident){
          out.action='revise'; out.exec=true;
          out.product_exact=pr.pick.name; out.product_id=pr.pick.id;
          out.reasons.push('브랜드○ 제품○ → 재선택 요청');
        } else if(pr.pick){
          out.action='hold';
          out.product_exact=pr.pick.name; out.product_id=pr.pick.id;
          out.reasons.push(pr.why+' → 제품명 확인 후 수정요청');
        } else {
          out.action='register'; out.reasons.push('브랜드○ · '+pr.why);
        }
      } else {
        out.action='register';
        out.reasons.push(b.anyExact?'브랜드 미검수만 → 등록 필요':'브랜드 미등록 → 브랜드+상품 등록');
      }
      return out;
    }

    /* 3) 정상 매칭 리뷰 → 사진으로 판단.
          approvable 인 것들만 썸네일 그리드에서 눈으로 훑어 일괄 승인한다. */
    if(out.photo.v==='suspect'){ out.action='hide'; out.exec=true; out.reasons.push('사진 '+out.photo.label); return out; }
    out.action='hold'; out.approvable=true;
    if(out.photo.v==='mixed')       out.reasons.push('사진 '+out.photo.label+' → 눈으로 확인');
    else if(out.photo.v==='camera') out.reasons.push('직접촬영 → 사진 의미확인 후 승인');
    else if(out.photo.v==='none')   out.reasons.push('첨부 없음 → 확인');
    else                            out.reasons.push('사진 판별 애매 → 확인');
    return out;
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
    SCAN_DATE=sd;
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
    var order=['revise','hide','register','hold','approve'];

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
          +(exec?'<label style="display:flex;gap:7px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="csChk" data-id="'+r.id+'" '+(r.applied?'disabled':'checked')+' style="margin-top:3px">':'<div>')
          +'<div><b style="color:#cfe">#'+r.id+'</b> '+(r.applied?'<span style="color:#3ddc97;font-weight:800">✓ 처리됨</span> ':'')
          +'<span style="color:#9fb4ab">'+esc(r.brand||'')+' / '+esc(r.product||'')+'</span>'
          +'<div style="font-size:11px;color:#7f948b;margin-top:2px">'+esc(r.reasons.join(' · '))
          + (r.photo&&r.photo.v!=='none'?' · 사진:'+esc(r.photo.label):'')
          + (r.product_exact?' · <span style="color:#3ddc97">→ '+esc(r.product_exact)+'</span>':'')+'</div>'
          +'</div>'+(exec?'</label>':'</div>')
          +'</div>';
      });
      html+='</div>';
    });

    var nExec = results.filter(function(r){ return !r.applied && (r.action==='revise'||r.action==='hide'); }).length;
    var nGrid = results.filter(function(r){ return r.action==='hold' && r.approvable; }).length;

    if(nGrid) html+='<button id="csGridBtn" style="width:100%;margin-top:14px;background:#8fb8ff;color:#06121f;'
      +'border:0;border-radius:9px;padding:11px;font:inherit;font-weight:800;cursor:pointer">'
      +'👀 사진 보고 일괄 승인 ('+nGrid+'건)</button>';

    html+='<div style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap">'
      +'<button id="csRescan" style="flex:1;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">다시</button>'
      +'<button id="csDl" style="flex:1.3;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">검수기록 JSON</button>'
      +'<button id="csRun" style="flex:2;background:'+(nExec?'#3ddc97':'#22392e')+';color:'+(nExec?'#04130c':'#6b7f77')+';border:0;border-radius:8px;padding:9px;font-weight:800;cursor:'+(nExec?'pointer':'default')+'">체크한 것 실행 ('+nExec+')</button>'
      +'</div>'
      +'<div id="csLog" style="margin-top:10px;font-size:11.5px;color:#9fb4ab"></div>'
      +'<div style="margin-top:7px;font-size:10.5px;color:#6b7f77">미노출 상한 '+CAP.hide+' · 수정요청 '+CAP.revise+' · 승인 '+CAP.approve+' · 에러 시 즉시 중단.</div>';

    box.innerHTML=head(html);
    document.getElementById('csRescan').onclick=function(){ renderStart(sd); };
    document.getElementById('csDl').onclick=function(){ dl(auditPayload(),'unpa-audit-'+sd+'.json'); };
    if(nGrid) document.getElementById('csGridBtn').onclick=function(){ openGrid(); };
    if(nExec) document.getElementById('csRun').onclick=function(){ runExec(); };
  }

  /* ── 공통 다운로드 ── */
  function dl(obj,name){
    var blob=new Blob([JSON.stringify(obj,null,1)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ── 실행 ─────────────────────────────────────────────
     대기열의 [실행]과 썸네일 그리드의 [승인]이 같은 경로를 쓴다.
     상한은 액션별로 다르다 — 되돌리기 어려운 미노출은 좁게,
     되돌리기 쉬운 승인은 넓게. */
  var CAP={ hide:30, revise:60, approve:300 };

  function buildReq(r){
    if(r.action==='revise'){
      var tpl=tplMap['product_match'];
      var body=tpl?tpl.body.replace(/\{제품명\}/g, r.product_exact||r.product):null;
      return body ? {method:'POST',url:API+'/admin/reviews/'+r.id+'/revise',body:{content:[body]}} : null;
    }
    if(r.action==='hide')    return {method:'PUT', url:API+'/admin/reviews/'+r.id, body:{visible:false}};
    if(r.action==='approve') return {method:'POST',url:API+'/admin/reviews/'+r.id+'/approve', body:{}};
    return null;
  }

  async function runJobs(jobs){
    if(window.__CONSOLE_RUNNING){ alert('이미 실행 중입니다.'); return; }
    if(!jobs.length){ alert('실행할 대상이 없습니다.'); return; }

    var byAct={}; jobs.forEach(function(r){ byAct[r.action]=(byAct[r.action]||0)+1; });
    var over=Object.keys(byAct).filter(function(k){ return byAct[k] > (CAP[k]||0); });
    if(over.length){
      alert(over.map(function(k){ return ACT[k].t+' '+byAct[k]+'건 (상한 '+(CAP[k]||0)+')'; }).join('\n')
            + '\n\n상한을 초과해 실행을 거부합니다.');
      return;
    }
    var summ=Object.keys(byAct).map(function(k){ return ACT[k].t+' '+byAct[k]+'건'; }).join(' · ');
    if(!confirm('실제로 '+jobs.length+'건을 처리합니다.\n\n'+summ+'\n\n진행할까요?')) return;

    window.__CONSOLE_RUNNING=true;
    var run=document.getElementById('csRun'); if(run){ run.disabled=true; run.textContent='실행 중…'; }
    var logs=[];
    for(var i=0;i<jobs.length;i++){
      var r=jobs[i], req=buildReq(r);
      if(!req){ log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ #'+r.id+' 요청 생성 실패 — 건너뜀</span>'); continue; }
      log('▶ #'+r.id+' '+ACT[r.action].t+' <span style="color:#6b7f77">('+(i+1)+'/'+jobs.length+')</span>');
      var res=await send(req.method,req.url,req.body);
      var ok=(res.status>=200&&res.status<300);
      r.applied=ok;
      logs.push({id:r.id,action:r.action,status:res.status,ok:ok,response:res.json||res.text});
      if(ok){ log('&nbsp;&nbsp;<span style="color:#3ddc97">✓ '+res.status+'</span>'); }
      else {
        log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ '+res.status+' — 중단</span>');
        log('&nbsp;&nbsp;<span style="font-size:11px">'+esc((res.text||'').slice(0,140))+'</span>');
        break;
      }
      await delay(300);
    }
    dl({at:new Date().toISOString(),date:SCAN_DATE,logs:logs},'cms-console-log-'+Date.now()+'.json');
    var okN=logs.filter(function(x){return x.ok;}).length;
    log('<b style="color:'+(okN===logs.length?'#3ddc97':'#ff8f6b')+'">완료 '+okN+'/'+logs.length+' · 로그 저장</b>');
    window.__CONSOLE_RUNNING=false;
    renderQueue(SCAN_DATE);
    offerWorklog();
  }

  /* 대기열 체크박스 → 실행 */
  function runExec(){
    var ids={};
    [].slice.call(document.querySelectorAll('.csChk')).forEach(function(c){ if(c.checked) ids[c.dataset.id]=1; });
    runJobs(results.filter(function(r){ return ids[r.id] && (r.action==='revise'||r.action==='hide'); }));
  }

  /* ── 업무일지 연동 ────────────────────────────────────
     검수 기록 탭은 verdict / reason / applied 를 읽는데
     콘솔 내부는 action / reasons 를 쓴다. 여기서 맞춰 내보낸다. */
  var VMAP={ approve:'approve', hide:'hide', revise:'revise_product', register:'register', hold:'hold' };
  function auditPayload(){
    var summary={}; results.forEach(function(r){ summary[r.action]=(summary[r.action]||0)+1; });
    return {
      v:1, date:SCAN_DATE, at:new Date().toISOString(), total:results.length, summary:summary,
      items: results.map(function(r){
        return { id:r.id, brand:r.brand, product:r.product, user:r.user,
                 verdict: VMAP[r.action]||'hold', action:r.action,
                 reason: r.reasons.join(' · '), reasons:r.reasons,
                 applied: !!r.applied,
                 photo: r.photo?r.photo.label:'', photoCls:r.photoCls||[],
                 product_exact:r.product_exact, attachments:r.attachments||[] };
      })
    };
  }

  function offerWorklog(){
    var done=results.filter(function(r){ return r.applied; });
    if(!done.length) return;
    var n=function(a){ return done.filter(function(r){return r.action===a;}).length; };
    var payload={ d:SCAN_DATE, r:done.length, p:0,
                  note:'콘솔 처리 · 승인 '+n('approve')+' · 수정요청 '+n('revise')+' · 미노출 '+n('hide') };
    var wl=WORKLOG_URL+'#sync='+encodeURIComponent(JSON.stringify(payload));
    var el=document.getElementById('csLog'); if(!el) return;
    var wrap=document.createElement('div');
    wrap.style.cssText='display:flex;gap:7px;margin-top:10px';
    var b1=document.createElement('button');
    b1.textContent='📒 업무일지 반영 ('+done.length+')';
    b1.style.cssText='flex:1.4;background:#2c4a3c;color:#cfe;border:1px solid #3ddc97;border-radius:8px;padding:9px;font:inherit;font-weight:800;cursor:pointer';
    b1.onclick=function(){ window.open(wl,'_blank'); };
    var b2=document.createElement('button');
    b2.textContent='검수기록 JSON';
    b2.style.cssText='flex:1;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font:inherit;font-weight:700;cursor:pointer';
    b2.onclick=function(){ dl(auditPayload(),'unpa-audit-'+SCAN_DATE+'.json'); };
    wrap.appendChild(b1); wrap.appendChild(b2);
    el.parentNode.insertBefore(wrap, el.nextSibling);
  }

  /* ── 썸네일 그리드 일괄 승인 ──────────────────────────
     "직접촬영"까지는 기계가 가려내지만, 그 사진이 제품과 맞는지는
     눈으로 봐야 한다. 한 화면에 깔아놓고 이상한 것만 체크를 풀어
     나머지를 한 번에 승인한다. */
  function openGrid(){
    var pool=results.filter(function(r){ return r.action==='hold' && r.approvable; });
    if(!pool.length){ alert('일괄 승인 대상이 없습니다.'); return; }
    var pick={}, node={};
    pool.forEach(function(r){ pick[r.id]=true; });

    var ov=document.createElement('div'); ov.id='csGrid';
    ov.style.cssText='position:fixed;inset:0;z-index:2147483646;background:#0a1310;color:#e8f1ed;'
      +'font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;display:flex;flex-direction:column';
    var bar=document.createElement('div');
    bar.style.cssText='flex:0 0 auto;padding:12px 18px;border-bottom:1px solid #22392e;display:flex;'
      +'gap:9px;align-items:center;flex-wrap:wrap;background:#0d1512';
    /* 스크롤은 래퍼가 맡고 그리드는 그 안에 둔다.
       그리드를 flex 아이템으로 직접 두면 행 높이가 0에 가깝게 잡혀 카드가 납작해진다. */
    var scroll=document.createElement('div');
    scroll.style.cssText='flex:1 1 0;overflow:auto;padding:14px 18px';
    var grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));'
      +'gap:12px;align-content:start';
    scroll.appendChild(grid);
    ov.appendChild(bar); ov.appendChild(scroll);
    document.body.appendChild(ov);
    box.style.display='none';                       /* 그리드를 보는 동안 콘솔 패널은 접어둔다 */
    var closeGrid=function(){ ov.remove(); box.style.display=''; };

    function nSel(){ var k=0; for(var i=0;i<pool.length;i++) if(pick[pool[i].id]) k++; return k; }
    function syncGo(){ var g=document.getElementById('gGo'); if(g) g.textContent='선택 '+nSel()+'건 승인'; }
    function paintOne(r){
      var el=node[r.id]; if(!el) return;
      var sel=pick[r.id];
      el.style.borderColor=sel?'#3ddc97':'#22392e';
      el.style.opacity=sel?'1':'.4';
      var c=el.querySelector('.gchk'); if(c) c.style.display=sel?'flex':'none';
    }

    var BTN='background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:8px 13px;font:inherit;cursor:pointer';
    bar.innerHTML='<b style="color:#3ddc97;font-size:14px">👀 사진 확인 후 일괄 승인</b>'
      +'<span style="color:#9fb4ab">제품과 <b>무관한 사진</b>만 눌러서 해제 · 🔍로 전체 사진 보기</span>'
      +'<span style="flex:1"></span>'
      +'<button id="gAll" style="'+BTN+'">전체 선택</button>'
      +'<button id="gNone" style="'+BTN+'">전체 해제</button>'
      +'<button id="gGo" style="background:#3ddc97;color:#04130c;border:0;border-radius:8px;padding:8px 17px;font:inherit;font-weight:800;cursor:pointer">선택 '+nSel()+'건 승인</button>'
      +'<button id="gX" style="'+BTN+'">닫기</button>';

    pool.forEach(function(r){
      var src=(r.attachments&&r.attachments[0])||'';
      var extra=(r.attachments||[]).length;
      var el=document.createElement('div');
      el.style.cssText='cursor:pointer;border:2px solid #3ddc97;border-radius:10px;overflow:hidden;background:#111d18';
      el.innerHTML='<div style="position:relative;aspect-ratio:1/1;background:#0a1310">'
        +(src?'<img src="'+esc(src)+'" loading="lazy" style="width:100%;height:100%;object-fit:cover">'
             :'<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#4d6158;font-size:11px">사진 없음</div>')
        +(extra>1?'<span style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.7);border-radius:11px;padding:1px 7px;font-size:11px">+'+(extra-1)+'</span>':'')
        +'<span class="gchk" style="position:absolute;left:6px;top:6px;background:#3ddc97;color:#04130c;border-radius:50%;width:21px;height:21px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px">✓</span>'
        +(extra?'<span class="gzoom" style="position:absolute;right:6px;top:6px;background:rgba(0,0,0,.7);border-radius:50%;width:23px;height:23px;display:flex;align-items:center;justify-content:center;font-size:12px">🔍</span>':'')
        +'</div>'
        +'<div style="padding:7px 8px">'
        +'<div style="font-size:11px;color:#9fb4ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.brand||'')+'</div>'
        +'<div style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.product||'')+'</div>'
        +(r.photo&&r.photo.v==='mixed'?'<div style="font-size:10px;color:#f5c451;margin-top:2px">⚠ '+esc(r.photo.label)+'</div>':'')
        +'</div>';
      el.onclick=function(ev){
        if(ev.target && ev.target.classList.contains('gzoom')){ ev.stopPropagation(); lightbox(r); return; }
        pick[r.id]=!pick[r.id]; paintOne(r); syncGo();
      };
      node[r.id]=el; grid.appendChild(el);
    });

    function lightbox(r){
      var lb=document.createElement('div');
      lb.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(4,10,8,.94);overflow:auto;padding:24px;'
        +'display:flex;flex-wrap:wrap;gap:14px;align-content:center;justify-content:center';
      lb.innerHTML='<div style="width:100%;text-align:center;color:#9fb4ab;font:13px -apple-system,sans-serif">'
        +'<b style="color:#cfe">#'+r.id+'</b> '+esc(r.brand||'')+' / '+esc(r.product||'')
        +' <span style="color:#6b7f77">— 아무 곳이나 클릭하면 닫힙니다</span></div>'
        +(r.attachments||[]).map(function(u){
          return '<img src="'+esc(u)+'" style="max-width:44%;max-height:74vh;object-fit:contain;border-radius:10px">'; }).join('');
      lb.onclick=function(){ lb.remove(); };
      document.body.appendChild(lb);
    }

    document.getElementById('gAll').onclick =function(){ pool.forEach(function(r){pick[r.id]=true; paintOne(r);}); syncGo(); };
    document.getElementById('gNone').onclick=function(){ pool.forEach(function(r){pick[r.id]=false;paintOne(r);}); syncGo(); };
    document.getElementById('gX').onclick   =function(){ closeGrid(); };
    document.getElementById('gGo').onclick  =function(){
      var jobs=pool.filter(function(r){ return pick[r.id]; });
      if(!jobs.length){ alert('선택된 건이 없습니다.'); return; }
      jobs.forEach(function(r){ r.action='approve'; });
      closeGrid();
      runJobs(jobs);
    };
  }

  /* ── 시작 ── */
  var qs=new URLSearchParams(location.search); var sd=qs.get('startDate')||new Date().toISOString().slice(0,10);
  box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">템플릿 불러오는 중…</div>');
  oF.call(window,TPL_URL+'?t='+Date.now()).then(function(r){return r.json();}).then(function(d){
    (d.templates||[]).forEach(function(t){tplMap[t.key]=t;}); renderStart(sd);
  }).catch(function(){ renderStart(sd); });
})();
