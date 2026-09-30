/* ============================================================
 * 리뷰 검수 콘솔 — cms-console.js   (수집→자동판정→실행 통합)
 *
 *  검수 대상 규칙
 *   1) 브랜드 안에 CMS 에 존재하는 상품이 매칭돼 있어야 한다
 *   2) 상세 좌상단 제품 이미지가 엑박이 아니어야 한다
 *   3) 무의미한 본문("ㅁㄴㅇㄹ", "가가가거거")만 있으면 검수 대상이 아니다 → 미노출
 *   4) 발색 있는 제품인데 발색샷이 없으면 → 발색샷 요청
 *
 *  판정 결과 7종
 *   approve          검수완료          그리드에서 사진 보고 일괄 실행
 *   revise_swatch    발색샷 요청        그리드에서 💄 눌러 선택 후 실행
 *   revise_product   제품 재선택 요청    상품명 정확일치 시 일괄 실행
 *   hide             미노출            무의미 본문 / 사진 전량 캡처·저해상
 *   register_product 상품등록 필요      브랜드○ 제품✗ — 사람이 직접 (실행 없음)
 *   register_brand   브랜드+상품 등록   브랜드✗       — 사람이 직접 (실행 없음)
 *   hold             확인 필요         비화장품·애매  — 사람이 직접 (실행 없음)
 *
 *  기계가 못 하는 것
 *   - 사진이 그 제품이 맞는지, 발색샷이 실제로 있는지는 픽셀을 봐야 안다.
 *     그래서 그리드에 깔아 사람이 눈으로 고른다.
 *   - 사진 판별은 해상도만 본다. 파일 크기는 보지 않는다.
 *
 *  안전장치: 로드 시 아무것도 안 보냄. 그리드/대기열에서 골라 [실행]+확인창.
 *            건별 로그 · 에러 시 즉시 중단 · 액션별 상한 · 처리 결과는 검수기록에 남김.
 *            이미 처리된 건은 다시 대상이 되지 않는다.
 *
 *  업무일지 연동 (자동)
 *   - 콘솔을 열면 CMS 최근 60일에서 "내 계정이 그날 승인한 리뷰·등록한 제품"을 모아
 *     업무일지 동기화 창(sync.html)에 넘긴다. 작성일이 아니라 실제로 일한 날 기준.
 *   - 스캔·실행 결과(검수기록)도 함께 넘긴다. 파일은 내려받지 않는다.
 * ============================================================ */
(function () {
  'use strict';
  if (location.hostname !== 'cms.unpa.me') { alert('cms.unpa.me 에서 실행해주세요.'); return; }
  try { var old = document.getElementById('cmsConsoleBox'); if (old) old.remove(); } catch (e) {}
  if (window.__CONSOLE_RUNNING) { alert('이미 실행 중입니다.'); return; }

  var API = 'https://api-v2.unpa.me';
  var TPL_URL = 'https://moowillbedone.github.io/unpa-worklog/templates.json';
  var WORKLOG_URL = 'https://moowillbedone.github.io/unpa-worklog/';
  var SCAN_DATE = null;
  var MAX_EXEC = 100;
  var AUTH = window.__COLLECT_AUTH || window.__BRAND_AUTH || window.__PROD_AUTH || window.__APPLY_AUTH || window.__CONSOLE_AUTH || null;
  /* 토큰을 가로챌 대상을 오리진까지 확인한다 — '/admin/' 문자열만 보면 남의 주소도 걸린다 */
  function isAdmin(u){
    try { var x=new URL(u, location.origin);
      return x.origin==='https://api-v2.unpa.me' && x.pathname.indexOf('/admin/')===0;
    } catch(e){ return false; }
  }

  /* 화면캡처 판별용 알려진 폰 해상도 */
  var SCREENS = [[1170,2532],[1179,2556],[1290,2796],[1284,2778],[1125,2436],[1206,2622],[1320,2868],
                 [750,1334],[828,1792],[1080,2340],[1080,2400],[1080,1920],[1440,3040],[1440,3200],[1080,2280],[720,1280]];
  /* ── 언니의파우치 취급 품목 ──────────────────────────
     화장품·뷰티 제품은 당연히 대상이고, 여기에 더해
     이너뷰티(다이어트·영양제)와 뷰티 관련 도구까지 취급한다.
     예전 목록은 오메가3·유산균·비타민·콜라겐 같은 이너뷰티를 전부
     "화장품 아님"으로 막고 있었다. */
  var BEAUTY_OK = [
    /* 이너뷰티 — 다이어트 */
    '다이어트','효소','부스터샷','체지방','슬리밍','식이섬유','가르시니아','카르니틴',
    /* 이너뷰티 — 영양제 */
    '콜라겐','글루타치온','글루타티온','비타민','종합비타민','멀티비타민',
    '유산균','프로바이오틱','프리바이오틱','락토','낙산균','이노시톨',
    '오메가','마그네슘','루테인','밀크씨슬','비오틴','엽산','아연','철분',
    '히알루론','세라마이드','플라센타','이너뷰티','건강기능','영양제',
    /* 뷰티 관련 도구 */
    '뷰러','드라이기','고데기','에어랩','헤어롤','헤어아이론','미용기기','괄사','마사지기',
    '클렌징기','클렌징브러시','눈썹칼','면도기','제모기','네일기','퍼프','브러시','스펀지',
    '헤어핀','헤어밴드','샤워기','족욕기','마스크기기',
    /* 구강 제품 */
    '치약','칫솔','가글','구강','치실','워터픽','치아미백','잇몸',
    /* 여성 위생 */
    '여성청결','청결제','청결티슈','이너케어','여성위생','생리대'
  ];
  /* 취급하지 않는 품목 — 리뷰 검수 대상이 아니다 */
  var NOT_BEAUTY = [
    '콤부차','꼼부차',
    '세제','락스','섬유유연','표백','세탁','주방세제','살균소독',
    '관절','혈압','혈당','소화제','진통제','감기약','파스'
  ];
  /* 짧은 키워드는 다른 낱말 속에 우연히 들어간다.
     "링링 파스텔 네일"의 «파스», "릴락스 크림"의 «락스» 처럼.
     그 낱말이 보이면 해당 키워드 판정을 건너뛴다. */
  var NB_EXCEPT = {
    '파스': /파스텔|파스타|파스텔톤/,
    '락스': /릴락스|릴렉스|블락스|플락스|락스타/,
    '세제': /세제거|각질세제/,
    '관절': /관절염크림|무릎관절보호대/
  };

  /* ── 인증 가로채기 ── */
  function grab(h){ try{ if(!h) return; var o={};
    if(h.forEach) h.forEach(function(v,k){o[k.toLowerCase()]=v;});
    else if(typeof h==='object') Object.keys(h).forEach(function(k){o[k.toLowerCase()]=h[k];});
    if(o.authorization){AUTH=o.authorization;window.__CONSOLE_AUTH=AUTH;window.__COLLECT_AUTH=AUTH;} }catch(e){} }
  var oF = window.__COLLECT_OF || window.fetch;
  window.__COLLECT_OF = oF;
  window.fetch = function(){ var a=arguments;
    try{ var u=String((a[0]&&a[0].url)||a[0]||'');
      if(isAdmin(u)){ if(a[0]&&a[0].headers) grab(a[0].headers); if(a[1]&&a[1].headers) grab(a[1].headers);} }catch(e){}
    return oF.apply(this,a); };
  if(!window.__COLLECT_XHOOK){ window.__COLLECT_XHOOK=true;
    var OSH=XMLHttpRequest.prototype.setRequestHeader, OX=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return OX.apply(this,arguments);};
    XMLHttpRequest.prototype.setRequestHeader=function(k,v){
      try{ if(String(k).toLowerCase()==='authorization'&&isAdmin(this.__u)){AUTH=v;window.__CONSOLE_AUTH=v;window.__COLLECT_AUTH=v;} }catch(e){}
      return OSH.apply(this,arguments); }; }

  function H(){ var h={'Accept':'application/json'};
    AUTH = window.__COLLECT_AUTH || window.__CONSOLE_AUTH || AUTH;   /* 다른 도구가 새로 잡은 토큰을 이어 쓴다 */
    if(AUTH) h['Authorization']=AUTH; return h; }
  /* 응답이 안 오면 20초에 끊는다. 없으면 스캔이 한 건에서 영원히 멈춘다 */
  async function timedFetch(url, init){
    var ac=new AbortController(), timer=setTimeout(function(){ ac.abort(); }, 20000);
    try {
      var r=await oF.call(window, url, Object.assign({}, init, {signal:ac.signal}));
      var t=await r.text();
      return { status:r.status, text:function(){ return Promise.resolve(t); } };
    } finally { clearTimeout(timer); }
  }
  function Hj(){ var h=H(); h['Content-Type']='application/json'; return h; }
  function get(url){ return timedFetch(url,{headers:H(),credentials:'include'})
    .then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t);}catch(e){}return{status:r.status,json:j,text:t.slice(0,200)};});})
    .catch(function(e){return{status:0,json:null,text:String(e&&e.message||e)};}); }
  function send(method,url,body){ return timedFetch(url,{method:method,headers:Hj(),credentials:'include',body:body?JSON.stringify(body):undefined})
    .then(function(r){return r.text().then(function(t){var j=null;try{j=JSON.parse(t);}catch(e){}return{status:r.status,json:j,text:t.slice(0,300)};});})
    .catch(function(e){return{status:0,json:null,text:String(e&&e.message||e)};}); }
  function listOf(j){ if(!j) return null;
    return Array.isArray(j.results)?j.results:Array.isArray(j.result)?j.result:Array.isArray(j.data)?j.data:Array.isArray(j.content)?j.content:Array.isArray(j)?j:null; }
  function totalOf(j){ return (j&&(j.totalCount||j.total||j.totalElements||j.count))||0; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  /* 2026-02-31 같은 없는 날짜를 걸러낸다 */
  function validDate(d){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var t=Date.parse(d+'T00:00:00Z');
    return isFinite(t) && new Date(t).toISOString().slice(0,10)===d;
  }
  /* CMS 리뷰 상세 — 목록 페이지네이션을 넘기지 않고 바로 열기 위한 주소 */
  function reviewUrl(id){ return location.origin+'/review/detail/'+id; }
  function norm(s){ return String(s||'').replace(/[\s()\[\]/·.,-]/g,'').toLowerCase(); }
  function delay(ms){ return new Promise(function(r){setTimeout(r,ms);}); }

  /* ── 사진 포렌식 ── */
  function imgDims(url){ return new Promise(function(res){
    if(typeof url!=='string' || !/^https?:\/\//i.test(url)){ res({w:0,h:0}); return; }
    var im=new Image();
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
  /* 취급 품목이면 null, 아니면 걸린 키워드를 돌려준다.
     불허 품목이 허용 키워드로 무력화되면 안 된다 — "다이어트 콤부차"는 콤부차다.
     허용 목록이 앞서야 했던 이유(«비타민» 세럼이 막히던 것)는
     그 낱말들을 불허 목록에서 빼면서 사라졌다. BEAUTY_OK 는 취급 범위 문서로 남긴다. */
  function notBeauty(name){
    var n=String(name||'');
    /* 물티슈는 화장·클렌징·여성청결용만 취급한다 */
    if(n.indexOf('물티슈')>=0)
      return /클렌징|메이크업|화장|리무버|페이셜|아이리무버|립리무버|선케어|여성청결/.test(n) ? null : '뷰티용 아닌 물티슈';
    for(var j=0;j<NOT_BEAUTY.length;j++){
      var kw=NOT_BEAUTY[j];
      if(n.indexOf(kw)<0) continue;
      var ex=NB_EXCEPT[kw];
      /* 예외 낱말을 지우고도 키워드가 남으면 진짜 차단 대상이다 ("파스텔 동전파스") */
      if(ex && n.replace(new RegExp(ex.source,'g'),'').indexOf(kw)<0) continue;
      return kw;
    }
    return null;
  }

  /* ── 이용 정지 사용자 ──────────────────────────────────
     정지된 사용자의 리뷰는 검수 대상이 아니라 미노출 대상이다.
     목록과 상세가 어긋나면 확정하지 않고 사람에게 넘긴다. */
  /* 경고는 덮어쓰지 않고 이어 붙인다 — 브랜드 경고와 정지 이력이 함께 뜰 수 있다 */
  function addWarn(out, msg){ out.warn = out.warn ? (out.warn+' · '+msg) : msg; }

  function suspensionOf(item, detail){
    var a=detail&&detail.userBlocked, b=item&&item.userBlocked;
    if(typeof a==='boolean' && typeof b==='boolean' && a!==b)
      return { blocked:null, count:null, label:'정지 상태 불일치 — 재스캔 필요' };
    var blocked = typeof a==='boolean' ? a : typeof b==='boolean' ? b : null;
    var count = (detail&&detail.userBlockedCount);
    if(count==null) count = item&&item.userBlockedCount;
    if(!(typeof count==='number' && count>=0 && count===Math.floor(count))) count=null;
    return { blocked:blocked, count:count,
             label: blocked===true ? '정지' : blocked===false ? '정지 아님' : '정지 상태 확인 불가' };
  }

  /* ── 리뷰 본문 모으기 ──────────────────────────────────
     자유 서술형은 contentText 에 들어오지만, 간편 리뷰(easy review)는
     비어 있고 내용이 easyReview* / reviewAnswers 에 흩어져 있다.
     contentText 만 읽으면 간편 리뷰가 통째로 "본문 없음"이 된다. */
  var EASY_KEYS=['easyReviewFeedback','easyReviewReason','easyReviewReuse','easyReviewTiming','easyReviewTip'];
  function reviewText(detail){
    var parts=[];
    function push(v, depth){
      if(v==null || depth>4) return;
      if(typeof v==='string'){ var t=v.replace(/<[^>]*>/g,' ').trim(); if(t) parts.push(t); return; }
      if(typeof v==='number'){ return; }                 /* 별점 등 숫자는 본문이 아니다 */
      if(Array.isArray(v)){ v.forEach(function(x){ push(x,depth+1); }); return; }
      if(typeof v==='object'){
        /* 답변 객체는 질문이 아니라 답변만 본문으로 친다 */
        var keys=Object.keys(v).filter(function(k){ return /answer|content|text|value|body/i.test(k); });
        (keys.length?keys:Object.keys(v)).forEach(function(k){
          if(/question|title|label|type|id$/i.test(k)) return;
          push(v[k], depth+1);
        });
      }
    }
    push(detail&&detail.contentText, 0);
    if(!parts.length) push(detail&&detail.content, 0);
    EASY_KEYS.forEach(function(k){ push(detail&&detail[k], 0); });
    push(detail&&detail.reviewAnswers, 0);
    /* 같은 문장이 contentText 와 easyReview* 에 중복돼 들어오면
       "같은 줄 반복" 으로 보여 도배로 오판된다. 중복을 걷어낸다. */
    var seen={}, uniq=[];
    parts.forEach(function(t){ if(!seen[t]){ seen[t]=1; uniq.push(t); } });
    return uniq.join('\n');
  }

  /* ── 무의미한 언어 판별 ────────────────────────────────
     "ㅁㄴㅇㅁ냗ㅂㅈㄷ", "가가가가거거거" 처럼 내용이 없는 리뷰를 잡는다.
     isSpam() 은 "같은 문장 반복"만 봐서 이런 건 통과시켰다.
     "ㅋㅋㅋ 잘 쓸게요" 같은 정상 리뷰는 걸리지 않도록 실질 음절 수를 함께 본다. */
  function gibberish(text){
    var t=String(text||'').trim();
    if(!t) return null;        /* 빈 본문은 미노출 사유가 아니다 — 뒤에서 따로 다룬다 */
    var syll=t.match(/[가-힣]/g)||[];            /* 완성형 한글 */
    var jamo=t.match(/[ㄱ-ㅎㅏ-ㅣ]/g)||[];        /* 자모만 (ㅁㄴㅇㄹ) */
    var alnum=t.match(/[a-zA-Z0-9]/g)||[];
    var body=syll.length+alnum.length;           /* 실질 내용 분량 */

    if(jamo.length>=4 && jamo.length>body) return '자모 나열 («'+jamo.slice(0,8).join('')+'»)';
    /* 문장부호·자모 연속("좋아요!!!", "촉촉해요ㅎㅎㅎ")은 반복으로 세지 않는다 */
    var rep=t.match(/([가-힣a-zA-Z0-9])\1{2,}/g);
    if(rep){
      var left=(t.replace(/([가-힣a-zA-Z0-9])\1{2,}/g,'').match(/[가-힣a-zA-Z0-9]/g)||[]).length;
      if(left===0) return '같은 글자 반복 («'+rep[0].slice(0,6)+'»)';
    }
    /* 키보드 배열을 그대로 두드린 것 */
    if(/^(?:asdf|qwer|zxcv|ㅁㄴㅇㄹ|1234){2,}$/i.test(t.replace(/\s/g,''))) return '키보드 배열 반복';
    if(syll.length>=8){
      var u={}; syll.forEach(function(c){ u[c]=1; });
      if(Object.keys(u).length/syll.length<=0.3) return '동일 음절 반복';
    }
    if(syll.length===0 && alnum.length<=2 && t.length<=6) return '내용 없음 («'+t.slice(0,8)+'»)';
    return null;
  }

  /* ── 무성의한 리뷰 ────────────────────────────────────
     "좋아요", "굿", "잘 쓸게요" 처럼 상투어만 있고 제품에 대한 내용이 없는 것.
     되돌리기 어려운 처리라 기준을 좁게 잡는다 —
     상투어를 걷어낸 뒤 남는 글자가 하나도 없고, 전체가 짧을 때만 본다.
     "촉촉하고 좋아요"처럼 한 마디라도 붙으면 정상으로 둔다. */
  var FILLER_RE = /좋아요|좋아용|좋아여|조아요|좋네요|좋음|좋다|굿굿|굿|good|나이스|최고|짱|대박|만족|괜찮아요|괜찮네요|무난|보통|추천|강추|잘\s*쓸게요|잘\s*쓰겠습니다|잘\s*쓸께요|잘\s*사용할게요|감사합니다|감사해요|고마워요|재구매|또\s*살게요|ㅎ+|ㅋ+|ㅠ+|ㅜ+|입니다|이에요|예요|네요|해요|어요|합니다|했어요|하네요/gi;
  function lowEffort(text){
    var t=String(text||'').trim();
    var body=(t.match(/[가-힣a-zA-Z0-9]/g)||[]).length;
    if(body===0 || body>=12) return null;          /* 어느 정도 길면 성의 있는 것으로 본다 */
    var left=t.replace(FILLER_RE,'').replace(/[^가-힣a-zA-Z0-9]/g,'');
    if(left.length===0) return '상투어만 있음 («'+t.slice(0,14)+'»)';
    return null;
  }

  /* ── 발색 제품 판별 ────────────────────────────────────
     색조 제품인데 발색샷이 없으면 "발색샷 요청" 대상이다.
     사진에 발색샷이 있는지는 기계가 알 수 없으므로,
     여기서는 "발색이 있는 제품인가"까지만 가리고 판단은 그리드에서 사람이 한다. */
  var SWATCH_KW = ['립스틱','틴트','립글로스','글로스','립라이너','립펜슬',
                   '섀도우','쉐도우','아이섀도','아이쉐도','팔레트',
                   '블러셔','블러쉬','치크','하이라이터','쉐딩','셰딩','컨투어',
                   '쿠션','파운데이션','파데','컨실러','비비크림','씨씨크림','톤업',
                   '아이라이너','마스카라','네일','매니큐어','틴트밤','립틴트','립스테인',
                   /* 자동 승인 도입 뒤 빠지면 발색샷을 아무도 안 보게 되는 것들 (2026-09-27 보강) */
                   '아이브로우','브로우','눈썹','셰이딩','브론저','헤어컬러','헤어 컬러','염색','새치',
                   '파우더팩트','파우더 팩트','커버팩트','립오일','립 오일','컬러립','립앤치크','립 앤 치크'];
  /* 립밤·오일처럼 무색이 많은 품목은 색상명이 함께 있을 때만 색조로 본다 */
  var COLOR_KW  = ['핑크','레드','코랄','베이지','브라운','오렌지','퍼플','누드','로즈','피치',
                   '버건디','플럼','살구','자몽','체리','와인','모브','글리터','펄','실버','골드',
                   '레드빛','토프','카키','마젠타','라벤더','apricot','pink','red','coral'];
  /* 색조 키워드가 걸려도 발색과 무관한 품목은 뺀다 (네일 "크림"·"에센스" 등) */
  /* 색조 키워드가 걸려도 발색과 무관한 품목은 뺀다.
     "네일 에나멜 리무버"처럼 중간에 말이 끼는 경우가 있어 지우는 제품은 통째로 제외한다. */
  var SWATCH_EXCLUDE = /리무버|지우개|제거제|클렌저|세정|네일\s*(크림|에센스|오일|영양|강화|케어|트리트먼트)|핸드\s*앤\s*네일|핸드앤네일/;
  function isSwatch(productName){
    var n=String(productName||'');
    if(SWATCH_EXCLUDE.test(n)) return null;
    for(var i=0;i<SWATCH_KW.length;i++) if(n.indexOf(SWATCH_KW[i])>=0) return SWATCH_KW[i];
    /* 립밤 등 애매한 품목 + 색상명 조합 */
    if(/립밤|립케어|립세럼|립에센스/.test(n)){
      for(var j=0;j<COLOR_KW.length;j++) if(n.toLowerCase().indexOf(COLOR_KW[j].toLowerCase())>=0) return '립밤+'+COLOR_KW[j];
    }
    return null;
  }

  /* ── 엑박(제품 매칭 실패) 판별 ─────────────────────────
     좌상단 제품 이미지가 안 뜨는 상태. 응답 필드명이 환경마다 다를 수 있어
     productImageUrl / productPrice / productId 를 모두 보되,
     응답에 없는 필드는 검사에서 제외해 오탐을 막는다. */
  function exbakOf(detail){
    var why=[];
    var pid = detail.productId;
    if(!pid) why.push('productId 없음');

    var priceKey = ('productPrice' in detail) ? 'productPrice' : null;
    if(priceKey){
      var pr=detail[priceKey];
      if(pr===null||pr===''||pr===0||pr===undefined) why.push('productPrice 비어 있음');
    }

    var imgKey = ('productImageUrl' in detail) ? 'productImageUrl'
               : ('productImage' in detail)    ? 'productImage' : null;
    if(imgKey){
      var iu=String(detail[imgKey]||'');
      if(!iu || /\/?null\/?$/.test(iu)) why.push('제품 이미지 없음');
    }
    /* 제품이 연결돼 있고 이미지도 뜨는데 가격만 비어 있으면(증정품·비매품 등) 엑박이 아니다.
       엑박으로 보면 이미 제대로 고른 유저에게 "이 제품으로 다시 고르세요"가 나갈 수 있다. */
    if(why.length===1 && why[0]==='productPrice 비어 있음' && pid && imgKey) return null;
    return why.length ? why : null;
  }

  /* ── 욕설·광고·연락처 ──────────────────────────────────
     승인 그리드는 사진만 보여 주므로 본문의 욕설·광고는 원래도 사람 눈에 잘 안 띄었다.
     자동 승인까지 생긴 지금은 여기서 걸러 사람이 본문을 읽고 정하게 한다.
     정책(미노출 여부)은 사람이 정하도록 "확인"으로만 보낸다.
     부정적인 평가("돈 아까워요")는 정상 리뷰이므로 걸지 않는다. */
  /* 정상 낱말과 겹치는 것은 뺐다 — 시발점, 새끼발가락(풋크림 리뷰), "모공이 꺼져 보여요", 애비뉴 */
  var PROFANITY_RE=/씨발|시발(?!점)|ㅅㅂ|ㅆㅂ|씨바|좆|존나|졸라|ㅈㄴ|개새끼|새끼(?!\s*(?:손가락|발가락))|병신|ㅄ|ㅂㅅ|지랄|닥쳐|엿\s*먹|느금|니미|미친놈|미친년|썅/;
  var AD_RE=/https?:\/\/|www\.|bit\.ly|\.(?:com|co\.kr|kr|net|me|ly)\b|카톡|카카오톡|오픈\s*채팅|오픈톡|텔레그램|디엠\s*주|dm\s*주|문의\s*주세요|구매\s*링크|할인\s*코드|쿠폰\s*코드|0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}|@[A-Za-z0-9_.]{3,}/i;
  function badContent(text){
    var t=String(text||'');
    var m=t.match(PROFANITY_RE); if(m) return '욕설·비속어 («'+m[0]+'»)';
    m=t.match(AD_RE);            if(m) return '광고·연락처·링크 («'+m[0].slice(0,20)+'»)';
    return null;
  }

  /* ── 브랜드/제품 검색 ── */
  var brandCache={};
  /* 괄호 안 병기를 걷어낸 이름. "카밀(Kamil)" → "카밀", "넘버즈인(numbuz:n)" → "넘버즈인" */
  function bareName(x){ return norm(String(x||'').replace(/[\(\[][^\)\]]*[\)\]]/g,' ')); }

  /* ── 브랜드 찾기 ──────────────────────────────────────
     예전에는 정규화한 이름이 완전히 같을 때만 인정했다.
     그래서 영문 병기·띄어쓰기·조사 차이만 나도 "브랜드가 CMS에 없음"이 되어
     이미 있는 브랜드까지 브랜드부터 등록하라고 내보냈다.
     여러 검색어로 후보를 모으고 단계적으로 맞춰 본다. */
  async function findBrand(name){
    var key=norm(name);
    if(brandCache[key]!==undefined) return brandCache[key];

    var raw=String(name||'').trim();
    var queries=[raw];
    var bare=raw.replace(/[\(\[][^\)\]]*[\)\]]/g,' ').trim();
    if(bare && bare!==raw) queries.push(bare);
    var toks=tokensOf(raw).filter(function(t){ return t.length>=2; })
                          .sort(function(a,b){ return b.length-a.length; });
    if(toks.length) queries.push(toks[0]);

    var seen={}, rows=[], okQueries=0;
    for(var i=0;i<queries.length;i++){
      var r=await get(API+'/admin/brands?page=1&pageSize=100&q='+encodeURIComponent(queries[i]));
      var got=listOf(r.json);
      if(r.status===200 && got){ okQueries++;
        got.forEach(function(b){ if(b&&b.id!=null&&!seen[b.id]){ seen[b.id]=1; rows.push(b); } });
      }
      await delay(60);
    }
    /* 조회 실패는 캐시하지 않는다 — 한 번 끊긴 것 때문에 그 브랜드 리뷰가 스캔 내내 보류되던 문제 */
    if(!okQueries)
      return { approvedBrand:null, tier:null, anyExact:false, unapproved:null, likely:[], lookupFailed:true };
    var partial = okQueries<queries.length;

    var uBare=bareName(raw), uTok=tokensOf(raw);
    function tierOf(b){
      var n=norm(b.name);
      if(n===key) return 1;                                   /* 이름이 그대로 같다 */
      if(bareName(b.name)===uBare && uBare) return 2;         /* 괄호 병기만 다르다 */
      var bt=tokensOf(b.name);
      if(uTok.length && tokenCover(uTok,bt)>=0.999 && tokenCover(bt,uTok)>=0.6) return 3;
      if(n && key && (n.indexOf(key)>=0 || key.indexOf(n)>=0)){
        var mn=Math.min(n.length,key.length), mx=Math.max(n.length,key.length);
        if(mn/mx>=0.8) return 4;                              /* 표기 차이 수준 */
      }
      return 0;
    }
    var scored=rows.map(function(b){ return {b:b, t:tierOf(b)}; })
                   .filter(function(x){ return x.t>0; })
                   .sort(function(a,b){ return a.t-b.t || a.b.id-b.b.id; });

    var approvedHits=scored.filter(function(x){ return x.b.approved===true; });
    var best=approvedHits[0]||null;
    /* 같은 단계에 검수 완료 브랜드가 여럿이면 사람이 고르게 둔다 */
    if(best && approvedHits.length>1 && approvedHits[1].t===best.t) best=null;

    var res={
      approvedBrand: best?best.b:null,
      tier: best?best.t:null,
      anyExact: scored.some(function(x){ return x.t===1; }),
      unapproved: scored.filter(function(x){ return x.b.approved!==true; }).map(function(x){ return x.b; })[0]||null,
      likely: scored.slice(0,5).map(function(x){ return x.b; }),
      ambiguous: approvedHits.length>1 && !best,
      lookupFailed:false
    };
    /* 검색어 일부가 실패했는데 못 찾았으면 "없음"이 아니라 "확인 불가"다.
       없음으로 보내면 사람이 이미 있는 브랜드를 중복 등록하게 된다. */
    if(partial){ if(!best) res.lookupFailed=true; return res; }
    brandCache[key]=res; return res;
  }
  /* 검색어를 만든다. 후보를 못 찾으면 아무리 잘 맞춰도 소용이 없으므로
     긴 낱말(더 특징적인 것)부터 넣고, 긴 낱말은 앞 절반도 함께 넣는다. */
  function tokenize(name){
    var clean=stripSize(String(name)).replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ').replace(/[0-9]+/g,' ');
    var words=clean.split(/\s+/).filter(function(w){ return w.length>=2; })
                   .sort(function(a,b){ return b.length-a.length; });
    var set={}, order=[];
    var add=function(w){ if(w && w.length>=2 && !set[w]){ set[w]=1; order.push(w); } };
    words.forEach(add);
    words.forEach(function(w){ if(w.length>=6) add(w.slice(0, Math.ceil(w.length/2))); });
    if(!order.length) order=[String(name).slice(0,4)];
    return order.slice(0,6);
  }
  /* 상품명 매칭.
     예전에는 부분 문자열만 겹쳐도 매칭으로 쳐서
     "참 틴트 스무디 에디션 라즈베리 믹스" → "참 틴트" 같은 오매칭이 나왔다.
     그 문구를 유저에게 보내면 검색해도 본인 제품이 안 나와 수정요청이 무한 반복된다.
     이제 정확히 일치할 때만 자동 발송하고, 유사할 뿐이면 사람 확인으로 보낸다. */
  var SIM_MIN = 0.8;

  /* ── 제품 옵션(호수·색상) 조회 ────────────────────────
     CMS 는 제품명과 옵션을 나눠 저장한다.
       CMS 제품 : "에센셜 스킨 누더 쿠션"
       CMS 옵션 : 페어 / 페어핑크 / … / 엔라이트 / …
     그런데 유저는 "에센셜 스킨 누더 쿠션 엔라이트" 처럼 붙여서 쓴다.
     그래서 제품명이 안 맞아 보여도, 남는 부분이 옵션이면 같은 제품이다. */
  var PROD_EP=null, prodCache={}, prodProbeFail=0;
  function optionNames(o){
    var out=[];
    (function walk(v, key, depth){
      if(v==null || depth>5) return;
      if(typeof v==='string'){
        if(/option|variant|호수|색상|추가정보|additional/i.test(key||'')){
          /* "페어 (14g*2ea), 페어핑크 (14g*2ea)" 같은 한 줄 문자열도 받는다 */
          v.split(/[,\n·/|]/).forEach(function(t){
            t=t.replace(/\([^)]*\)/g,'').trim();
            if(t && t.length<=20) out.push(t);
          });
        }
        return;
      }
      if(Array.isArray(v)){ v.forEach(function(x){ walk(x, key, depth+1); }); return; }
      if(typeof v==='object'){
        Object.keys(v).forEach(function(k){
          var inOpt = /option|variant|호수|색상/i.test(k) || /option|variant/i.test(key||'');
          if(inOpt && /^(name|optionName|title|label|value|text)$/i.test(k) && typeof v[k]==='string'){
            var t=v[k].replace(/\([^)]*\)/g,'').trim();
            if(t && t.length<=20) out.push(t);
            return;
          }
          walk(v[k], inOpt ? (key||k) : k, depth+1);
        });
      }
    })(o, '', 0);
    var seen={}, uniq=[];
    out.forEach(function(t){ var n=norm(t); if(n && !seen[n]){ seen[n]=1; uniq.push(t); } });
    return uniq;
  }
  async function productOptions(pid){
    if(prodCache[pid]!==undefined) return prodCache[pid];
    /* 엔드포인트를 못 찾는 환경이면 매 건마다 헛되이 3번씩 찌르지 않는다 */
    if(!PROD_EP && prodProbeFail>=3){ prodCache[pid]=null; return null; }
    var eps = PROD_EP ? [PROD_EP] :
      [API+'/admin/products/{id}', API+'/admin/product/{id}', API+'/admin/products/{id}/options'];
    for(var i=0;i<eps.length;i++){
      var r=await get(eps[i].replace('{id}', pid));
      if(r.status===200 && r.json){
        if(SCHEMA && !SCHEMA.productKeys) SCHEMA.productKeys=Object.keys(r.json).sort();
        /* /options 는 배열을 그대로 주기도 한다 */
        var opts=optionNames(/\/options$/.test(eps[i]) ? {options:r.json} : r.json);
        if(opts.length){                       /* 옵션을 실제로 읽어낸 주소만 채택한다 */
          PROD_EP=eps[i];
          if(SCHEMA && !SCHEMA.productEndpoint) SCHEMA.productEndpoint=eps[i];
          prodCache[pid]=opts; return opts;
        }
      }
      await delay(60);
    }
    if(!PROD_EP) prodProbeFail++;
    prodCache[pid]=null; return null;   /* 조회 실패 — 옵션 확인 불가 */
  }

  /* ── 토큰 단위 비교 ────────────────────────────────────
     유저는 제품명을 마음대로 쓴다. 단어를 빠뜨리기도 하고 덧붙이기도 한다.
       유저 "코쿤 드 세레니떼 필로우 미스트"
       CMS  "코쿤 드 세레니떼 릴랙싱 필로우 미스트"   ← 중간에 단어가 더 있다
     문자열 포함으로는 안 잡히므로 단어 집합으로 비교한다.
     어느 쪽이 더 완전한지에 따라 뜻이 달라진다.
       유저 ⊂ CMS : 유저가 단어를 빠뜨림 → 같은 제품일 가능성이 높다
       CMS ⊂ 유저 : 유저가 옵션·에디션을 덧붙임 → 옵션인지 별개 제품인지 확인 필요 */
  /* "10 ml", "50g", "14g*2ea", "30매" 같은 용량·수량 표기는 제품명이 아니다.
     이게 남아 있으면 잔여 문자열이 «10ml라임민트» 가 되어 옵션 «라임민트» 와 안 맞는다.
     숫자 뒤에 단위가 바로 오는 것만 지운다 ("1025 독도 토너"의 1025 는 남긴다). */
  var SIZE_RE = /\d+(?:\.\d+)?\s*(?:ml|밀리리터|g|매|개입|ea)(?![a-zA-Z0-9])/gi;
  var COMBO_RE = /\d+\s*[*x×]\s*\d+\s*(?:ea|EA|개|매)?/g;
  function stripSize(str){
    return String(str||'')
      .replace(COMBO_RE,' ').replace(SIZE_RE,' ')
      .replace(/[*×]/g,' ')          /* 용량을 걷어내고 남은 곱셈 기호 (콜라보 표기의 X 는 남긴다) */
      .replace(/\s+/g,' ').trim();
  }

  /* 유저와 CMS 가 같은 종류를 다른 말로 쓴다. 비교 전에 하나로 맞춘다.
       썬크림=선크림 · 선블록=선크림 · 에멀전=로션 · 폼클렌저=클렌징폼
       마스크팩·시트마스크=마스크 · 이름 끝의 "팩"=마스크 · 이름 끝의 "스킨"=토너
     "에센셜 스킨 누더 쿠션"처럼 가운데 있는 "스킨"은 종류가 아니므로 건드리지 않는다. */
  function canonKind(str){
    return String(str||'')
      .replace(/썬/g,'선')
      .replace(/선\s*블[록럭]/g,'선크림')
      .replace(/에멀[전젼션]/g,'로션')
      .replace(/폼\s*클렌저|클렌징\s*폼/g,'클렌징폼')
      .replace(/마스크\s*팩|시트\s*마스크|마스크\s*시트/g,'마스크')
      .replace(/팩(?=\s*(?:[\[(]|$))/g,'마스크')
      .replace(/스킨(?=\s*(?:[\[(]|$))/g,'토너');
  }

  function tokensOf(name){
    return canonKind(stripSize(String(name||'')))
      .replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ')
      .split(/[\s·/,+&]+/)
      .map(function(t){ return t.replace(/[^0-9a-zA-Z가-힣]/g,'').toLowerCase(); })
      .filter(Boolean);
  }
  /* ── 글자 단위 유사도 ─────────────────────────────────
     유저와 CMS 는 같은 제품을 단어 순서도 띄어쓰기 위치도 다르게 쓴다.
       유저 "러브 라이트 하이드레이션 바디 로션"
       CMS  "바디러브 로션 라이트 하이드레이션"
     "러브" 와 "바디러브" 는 단어로는 다르고, 순서가 달라 문자열 포함도 깨진다.
     그래서 두 글자씩 잘라 겹치는 비율(Dice)을 본다. 순서에 영향을 덜 받는다.
     실측: 같은 제품 0.79~0.82 / 다른 제품 0.00~0.25 로 뚜렷하게 갈린다. */
  function bigrams(str){
    var m={}, n=0;
    for(var i=0;i<str.length-1;i++){ var g=str.substr(i,2); m[g]=(m[g]||0)+1; n++; }
    return {m:m, n:n};
  }
  function diceSim(a, b){
    if(!a || !b) return 0;
    if(a.length<2 || b.length<2) return a===b ? 1 : 0;
    var A=bigrams(a), B=bigrams(b), common=0;
    Object.keys(A.m).forEach(function(g){ if(B.m[g]) common+=Math.min(A.m[g], B.m[g]); });
    return (2*common)/(A.n+B.n);
  }
  /* 단어가 서로를 품고 있어도 겹친 것으로 본다 ("러브" ↔ "바디러브") */
  function looseCover(a, b){
    if(!a.length) return 0;
    var hit=0;
    for(var i=0;i<a.length;i++){
      var t=a[i];
      for(var j=0;j<b.length;j++){
        var o=b[j];
        if(o===t || (t.length>=2 && o.indexOf(t)>=0) || (o.length>=2 && t.indexOf(o)>=0)){ hit++; break; }
      }
    }
    return hit/a.length;
  }

  /* ── 제품 종류 ──────────────────────────────────────────
     글자 유사도만 보면 "수딩 크림"과 "수딩 토너", "수분 크림"과 "수분 선크림"이 같은 제품으로 붙는다.
     그대로 두면 크림 리뷰를 쓴 유저에게 "토너로 검색하세요"라는 틀린 안내가 나간다.
     제품명 뒤쪽 낱말에서 종류를 읽어, 종류가 다르면 자동으로 보내지 않는다.
     애매하면 다른 종류로 본다 — 틀린 자동 발송보다 사람 확인이 낫다. */
  var KIND_WORDS = ['선크림','선세럼','선스틱','선밤','선쿠션','선로션','선젤','선스프레이',
    '토너패드','클렌징폼','클렌징오일','클렌징워터','클렌징밤','클렌징젤','클렌징밀크','폼클렌저',
    '아이크림','핸드크림','풋크림','바디크림','바디로션','바디워시','바디오일','바디미스트','바디스크럽',
    '헤어오일','헤어에센스','헤어미스트','헤어팩','립밤','립오일','립틴트','립스틱','립글로스','립마스크',
    '크림','토너','스킨','로션','세럼','앰플','에센스','패드','마스크','팩','클렌저','오일','미스트',
    '밤','젤','샴푸','린스','트리트먼트','컨디셔너','틴트','쿠션','팩트','파운데이션','스크럽','워시',
    '파우더','프라이머','컨실러','섀도우','블러셔','하이라이터','마스카라','아이라이너','향수','퍼퓸','치약'];
  var KIND_SET={}; KIND_WORDS.forEach(function(k){ KIND_SET[k]=1; });
  var KIND_BY_LEN=KIND_WORDS.slice().sort(function(a,b){ return b.length-a.length; });
  function kindOf(name){
    var t=tokensOf(name);
    for(var i=t.length-1;i>=0;i--){
      if(KIND_SET[t[i]]) return t[i];
      for(var j=0;j<KIND_BY_LEN.length;j++){
        var k=KIND_BY_LEN[j];
        if(t[i].length>k.length && t[i].slice(-k.length)===k) return k;   /* "수분크림" → 크림 */
      }
    }
    return null;
  }
  /* 두 이름 모두 종류가 읽히는데 서로 다르면 true */
  /* 바디로션·핸드크림처럼 부위만 붙은 것은 기본 종류와 같은 것으로 본다
     (CMS "바디러브 로션" = 유저 "바디 로션"). 아이크림은 크림과 다른 제품이라 그대로 둔다. */
  function kindBase(k){ var m=/^(바디|핸드|풋)(.+)$/.exec(k||''); return (m && KIND_SET[m[2]]) ? m[2] : k; }
  /* 유저가 자주 섞어 쓰지만 브랜드는 따로 파는 경우도 있는 종류 — 자동 말고 버튼으로 */
  var KIND_FAMILY={ '에센스':'ESS', '세럼':'ESS', '앰플':'ESS' };
  function kindRel(a, b){
    var x=kindOf(a), y=kindOf(b);
    if(!x || !y) return 'unknown';
    if(kindBase(x)===kindBase(y)) return 'same';
    if(KIND_FAMILY[x] && KIND_FAMILY[x]===KIND_FAMILY[y]) return 'near';
    return 'clash';
  }
  function kindClash(a, b){ return kindRel(a, b)!=='same' && kindRel(a, b)!=='unknown'; }
  /* 종류 낱말만 뺀 이름 — "귤타민 비타토닝 앰플" 과 "… 세럼" 이 종류만 다른지 본다 */
  function withoutKind(name){
    var t=tokensOf(name), k=kindOf(name);
    for(var i=t.length-1;i>=0;i--){
      if(t[i]===k){ t.splice(i,1); break; }
      if(k && t[i].length>k.length && t[i].slice(-k.length)===k){ t[i]=t[i].slice(0,-k.length); break; }
    }
    return t.join('');
  }

  function tokenCover(a, b){          /* a 의 단어가 b 에 얼마나 들어 있나 (0~1) */
    if(!a.length) return 0;
    var set={}; b.forEach(function(t){ set[t]=1; });
    var hit=0; a.forEach(function(t){ if(set[t]) hit++; });
    return hit/a.length;
  }

  /* 줄여 쓴 낱말 대응 — 같은 낱말을 먼저 짝짓고, 남은 유저 낱말은 CMS 낱말의 앞부분인지 본다.
     유저 낱말이 모두 짝지어지고 CMS 낱말도 60% 이상 쓰였을 때만 인정한다. */
  function abbrMatch(uT, cT){
    if(uT.length<2 || !cT.length) return null;
    var used={}, left=[], pairs=[], exact=0;
    uT.forEach(function(t){ var j=cT.indexOf(t); while(j>=0 && used[j]) j=cT.indexOf(t, j+1);
      if(j>=0){ used[j]=1; exact++; } else left.push(t); });
    for(var i=0;i<left.length;i++){
      var t=left[i], hit=-1;
      if(t.length>=2) for(var k=0;k<cT.length;k++){ if(!used[k] && cT[k].indexOf(t)===0 && t.length/cT[k].length>=0.5){ hit=k; break; } }
      if(hit<0) return null;
      used[hit]=1; pairs.push(t+'→'+cT[hit]);
    }
    var cover=Object.keys(used).length/cT.length;
    if(cover<0.6 || !pairs.length) return null;       /* 줄인 낱말이 없으면 앞 단계들의 몫이다 */
    return { cover:cover, exact:exact, pairs:pairs };
  }

  /* 유저 입력에서 CMS 제품명을 뺀 나머지를 돌려준다 (옵션 후보) */
  function residueOf(userNorm, cmsNorm){
    if(!cmsNorm || cmsNorm.length>=userNorm.length) return null;
    if(userNorm.indexOf(cmsNorm)!==0 && userNorm.lastIndexOf(cmsNorm)!==userNorm.length-cmsNorm.length
       && userNorm.indexOf(cmsNorm)<0) return null;
    return userNorm.split(cmsNorm).join('');
  }

  /* 검색어 일부가 실패하면 후보가 빠져 있을 수 있다.
     그 상태로 "비슷한 것 중 1등"을 확정하거나 "없음"이라 하면 틀릴 수 있으므로,
     정확히 일치(또는 학습된 표기)가 아니면 사람에게 넘긴다. */
  async function findProduct(brandId, productName){
    if(!String(productName||'').trim())
      return { pick:null, confident:false, lookupFailed:true, why:'유저가 적은 제품명 없음 — 확인 필요', candidates:[] };
    var meta={ failQ:0 };
    var res=await findProductRaw(brandId, String(productName), meta);
    if(meta.failQ && !res.lookupFailed && !res.learned && res.why!=='상품명 정확히 일치'){
      if(res.confident){ res.confident=false; res.why+=' — 일부 검색 실패로 자동 확정 안 함'; }
      else if(!res.pick){ res.lookupFailed=true; res.why+=' — 일부 검색 실패, 없음으로 단정하지 않음'; }
    }
    return res;
  }
  async function findProductRaw(brandId, productName, meta){
    /* 낱말 검색 앞에 이름 전체로도 한 번 찾아본다 — 검색이 구절을 지원할 수 있다 */
    var toks=tokenize(productName);
    var whole=stripSize(String(productName).replace(/\[[^\]]*\]/g,' ')).trim();
    if(whole && toks.indexOf(whole)<0) toks.unshift(whole);
    /* 전에 배운 연결이 있으면 그 제품 이름으로 먼저 찾는다 — 검색 결과에 안 걸려 못 쓰던 것을 막는다 */
    var known=histLoad().alias[aliasKey(brandId, productName)];
    if(known && known.name && toks.indexOf(known.name)<0) toks.unshift(known.name);
    var seen={}, cand=[], okQueries=0;
    for(var i=0;i<toks.length;i++){
      var r=await get(API+'/admin/products?approved=true&brandApproved=true&page=1&pageSize=40&brandId='+brandId+'&q='+encodeURIComponent(toks[i]));
      var rows=listOf(r.json);
      if(r.status===200 && rows){ okQueries++;
        rows.forEach(function(p){ if(p&&p.id!=null&&!seen[p.id]){seen[p.id]=1;cand.push({id:p.id,name:p.name||p.productName||''});} });
      } else if(meta) meta.failQ++;
      await delay(80);
    }
    /* 조회가 하나도 성공하지 못했으면 "제품 없음"이 아니라 "확인 불가"다 */
    if(!okQueries && toks.length)
      return { pick:null, confident:false, lookupFailed:true,
               why:'제품 목록 조회 실패 — 없음으로 단정하지 않음', candidates:[] };
    /* 유저 입력과 CMS 이름 모두 용량 표기를 뺀 뒤 비교한다 */
    var nm = function(x){ return norm(canonKind(stripSize(String(x||'')))); };
    var raw=canonKind(stripSize(productName.replace(/\[[^\]]*\]/g,'')));
    var target=nm(raw);

    /* 1) 상품명이 그대로 일치 */
    var exact=cand.filter(function(p){ return nm(p.name)===target; });
    if(exact.length===1) return { pick:exact[0], confident:true,  why:'상품명 정확히 일치', candidates:cand };
    if(exact.length>1)   return { pick:null,     confident:false, why:'동일 상품명 '+exact.length+'건 — 사람이 선택', candidates:cand };

    /* 1-1) 전에 같은 브랜드에서 같은 표기를 어떤 제품으로 보냈는지 기억해 둔 것.
            사람이 한 번 맞춰 준 표기는 다음부터 자동으로 처리된다.
            제품이 지금도 검색 결과에 있을 때만 믿는다(삭제·변경 대비). */
    var learned=histLoad().alias[aliasKey(brandId, productName)];
    if(learned){
      var lp=cand.filter(function(p){ return String(p.id)===String(learned.pid); })[0];
      if(lp) return { pick:lp, confident:true, learned:true,
                      why:'이전에 같은 표기를 「'+lp.name+'」로 처리함 ('+(learned.n||1)+'회)', candidates:cand };
    }

    /* 2) 유저가 단어를 빠뜨린 경우 — CMS 이름이 더 완전하다.
          유저의 단어가 전부 CMS 이름에 있고, CMS 이름도 충분히 덮이면 같은 제품으로 본다.
          ("쿠션" 하나로 "에센셜 스킨 누더 쿠션"에 붙는 것은 덮는 비율이 낮아 걸러진다) */
    var uT=tokensOf(raw);
    var subset=cand.map(function(p){
      var cT=tokensOf(p.name);
      return { p:p, cT:cT, uInC:tokenCover(uT,cT), cInU:tokenCover(cT,uT) };
    }).filter(function(x){
      return uT.length>=2 && x.uInC>=0.999 && x.cT.length>=uT.length && x.cInU>=0.6
             && kindRel(productName, x.p.name)!=='clash' && kindRel(productName, x.p.name)!=='near';
    }).sort(function(a,b){ return b.cInU-a.cInU; });

    if(subset.length===1 || (subset.length>1 && subset[0].cInU>subset[1].cInU)){
      var w=subset[0];
      var missing=w.cT.filter(function(t){ return uT.indexOf(t)<0; });
      return { pick:w.p, confident:true,
               why: missing.length ? '유저가 «'+missing.join(' ')+'» 를 빠뜨림 — CMS 이름이 더 완전'
                                   : '단어는 같고 괄호·기호 표기만 다름',
               candidates:cand };
    }
    if(subset.length>1){
      return { pick:subset[0].p, confident:false,
               why:'단어를 빠뜨린 후보 '+subset.length+'건 ['+subset.slice(0,4).map(function(x){return x.p.name;}).join(' / ')+'] — 사람이 선택',
               candidates:cand };
    }

    /* 2-1) 낱말을 줄여 씀 — 유저 "미러 블러 멜팅 에센스" / CMS "미러링 블러 멜팅팟 에센스".
            글자 유사도(0.67)로는 기준에 못 미쳐 "제품 없음"이 되던 경우다.
            유저 낱말 하나하나가 CMS 의 서로 다른 낱말과 같거나 그 앞부분이면 같은 제품으로 본다.
            종류가 같아야 하고, 이렇게 맞는 후보가 하나뿐일 때만 확정한다. */
    var abbr=cand.map(function(p){ var m=abbrMatch(uT, tokensOf(p.name)); return { p:p, m:m }; })
      .filter(function(x){ return x.m && kindRel(productName, x.p.name)!=='clash' && kindRel(productName, x.p.name)!=='near'; })
      .sort(function(a,b){ return b.m.cover-a.m.cover || b.m.exact-a.m.exact; });
    if(abbr.length===1 || (abbr.length>1 && (abbr[0].m.cover>abbr[1].m.cover || abbr[0].m.exact>abbr[1].m.exact))){
      return { pick:abbr[0].p, confident:true,
               why:'유저가 낱말을 줄여 씀 ['+abbr[0].m.pairs.join(' · ')+'] — 「'+abbr[0].p.name+'」', candidates:cand };
    }
    if(abbr.length>1){
      return { pick:abbr[0].p, confident:false,
               why:'줄여 쓴 이름에 맞는 후보 '+abbr.length+'건 ['+abbr.slice(0,3).map(function(x){ return x.p.name; }).join(' / ')+'] — 사람이 선택',
               candidates:cand };
    }

    /* 3) 제품명 + 옵션(호수·색상) 조합인지 확인.
          남는 부분이 실제 옵션이면 같은 제품으로 본다. */
    var prefixed=cand.filter(function(p){ return residueOf(target, nm(p.name)); })
                     .sort(function(a,b){ return norm(b.name).length-norm(a.name).length; });  /* 긴 이름 우선 */
    for(var k=0;k<Math.min(prefixed.length,3);k++){
      var p=prefixed[k];
      var res=residueOf(target, nm(p.name));
      var opts=await productOptions(p.id);
      if(opts && opts.length){
        var hit=null;
        for(var j=0;j<opts.length;j++){ if(norm(opts[j])===res){ hit=opts[j]; break; } }
        if(hit) return { pick:p, confident:true, option:hit,
                         why:'제품명 일치 · 남은 «'+hit+'» 는 옵션', candidates:cand };
      }
      /* 옵션을 못 받았거나 안 맞으면 아래에서 사람 확인으로 넘긴다 */
    }
    if(prefixed.length){
      var f=prefixed[0], fr=residueOf(target, nm(f.name));
      var fo=prodCache[f.id];
      /* 왜 확정 못 했는지 구분해서 보여 준다 — 조회 실패와 "옵션에 없음"은 다른 문제다 */
      var note = (fo===null)          ? '옵션 조회 실패'
               : (!fo || !fo.length)  ? '옵션 목록 비어 있음'
               : '옵션 '+fo.length+'개와 불일치 ['+fo.slice(0,8).join(' / ')+(fo.length>8?' …':'')+']';
      return { pick:f, confident:false, options:(fo||null), residue:fr,
               why:'「'+f.name+'」 + 남은 «'+fr+'» · '+note+' → 수정요청인지 상품등록인지 사람이 판단',
               candidates:cand };
    }

    /* 4) 글자 유사도 — 단어 순서·띄어쓰기가 달라도 같은 제품을 찾아낸다 */
    var DICE_MIN=0.72, COVER_MIN=0.7, MARGIN=0.08;
    var clashed=[], nearKind=[];
    var fuzzy=cand.map(function(p){
      var pn=nm(p.name);
      return { p:p, d:diceSim(target,pn), c:looseCover(uT, tokensOf(p.name)), rel:kindRel(productName, p.name) };
    }).filter(function(x){
      if(x.d<DICE_MIN || x.c<COVER_MIN) return false;
      if(x.rel==='clash'){ clashed.push(x); return false; }
      if(x.rel==='near'){ nearKind.push(x); return false; }
      return true;
    }).sort(function(a,b){ return b.d-a.d; });

    if(fuzzy.length){
      var top=fuzzy[0];
      /* 2등과 차이가 없으면 기계가 고르지 않는다 */
      if(fuzzy.length>1 && (top.d-fuzzy[1].d)<MARGIN){
        return { pick:top.p, confident:false,
                 why:'비슷한 후보 여러 건 — 사람이 선택 ['
                     + fuzzy.slice(0,3).map(function(x){ return x.p.name+'('+x.d.toFixed(2)+')'; }).join(' / ')+']',
                 candidates:fuzzy.map(function(x){ return x.p; }) };
      }
      return { pick:top.p, confident:true,
               why:'단어 순서·띄어쓰기만 다름 (글자 유사도 '+top.d.toFixed(2)+')',
               candidates:cand };
    }

    /* 4-1) 이름은 같고 종류 표기만 다른 경우 — 유사도 기준에 못 미쳐도 여기서 본다.
            에센스·세럼·앰플은 버튼으로 사람이 한 번 확인하고 보낸다. */
    var uNoKind=norm(withoutKind(productName));
    if(uNoKind.length>=4){
      cand.forEach(function(p){
        if(norm(withoutKind(p.name))!==uNoKind) return;
        var rel=kindRel(productName, p.name);
        if(rel==='near' && !nearKind.some(function(x){ return x.p===p; })) nearKind.push({ p:p, d:1 });
        if(rel==='clash' && !clashed.some(function(x){ return x.p===p; })) clashed.push({ p:p, d:1 });
      });
    }
    if(nearKind.length){
      nearKind.sort(function(a,b){ return b.d-a.d; });
      var nk=nearKind[0];
      return { pick:nk.p, confident:false, kindNear:true,
               why:'종류 표기만 다름 ('+kindOf(productName)+' ≈ '+kindOf(nk.p.name)+') — 같은 제품이면 버튼으로 수정요청',
               candidates:cand };
    }

    if(clashed.length){
      clashed.sort(function(a,b){ return b.d-a.d; });
      var cx=clashed[0];
      return { pick:null, confident:false,
               why:'이름이 비슷한 「'+cx.p.name+'」가 있지만 종류가 다름 ('+kindOf(productName)+' ≠ '+kindOf(cx.p.name)+') — 새 제품일 가능성, 등록 전 확인',
               candidates:cand };
    }

    /* 5) 길이가 비슷한 포함 관계 */
    var near=cand.filter(function(p){
      var pn=nm(p.name); if(!pn) return false;
      if(target.indexOf(pn)<0 && pn.indexOf(target)<0) return false;
      var mn=Math.min(pn.length,target.length), mx=Math.max(pn.length,target.length);
      return mx>0 && mn/mx>=SIM_MIN;
    });
    if(near.length===1) return { pick:near[0], confident:false, why:'유사 상품명 「'+near[0].name+'」', candidates:cand };
    if(near.length>1)   return { pick:null,    confident:false, why:'유사 후보 '+near.length+'건', candidates:cand };
    return { pick:null, confident:false, why:'브랜드 안에 해당 제품 없음', candidates:cand };
  }

  /* ── 판정 ── */
  /* 응답 스키마를 한 번 기록해 둔다 — 필드명이 바뀌면 판정이 조용히 틀어지므로 */
  var SCHEMA=null;

  async function classify(item, detail){
    if(!SCHEMA) SCHEMA={ detailKeys:Object.keys(detail||{}).sort(),
                         sampleId:item.id,
                         hasImageField:('productImageUrl' in (detail||{}))||('productImage' in (detail||{})),
                         hasPriceField:('productPrice' in (detail||{})) };

    var content = reviewText(detail);
    var atts=(detail.attachments||[]).filter(Boolean);
    var exWhy = exbakOf(detail);

    var out={ id:item.id, brand:item.brandName, product:item.productName, user:item.userNickname,
              visible:item.visible, exbak:!!exWhy, reasons:[], photo:null, action:null, exec:false, msg:null,
              product_exact:null, product_id:null, product_option:null,
              product_options:null, residue:null, swatch:null, warn:null, suspension:null, brand_match:null,
              attachments:atts.slice(0,6),
              approvable:false };   /* 그리드에서 승인/발색샷요청을 고를 수 있는 건인지 */

    /* 정지 사용자는 사진·제품을 볼 필요가 없다 — 먼저 가른다 */
    if(!exWhy && 'productPrice' in detail && (detail.productPrice===null||detail.productPrice===''||detail.productPrice===0))
      addWarn(out,'CMS 제품 가격 정보 없음');            /* 엑박은 아니지만 자동 승인에서는 뺀다 */
    out.suspension = suspensionOf(item, detail);
    if(out.suspension.blocked===true){
      out.action='hide'; out.exec=true;
      out.reasons.push('정지 사용자'+(out.suspension.count!=null?' (누적 '+out.suspension.count+'회)':'')+' — 검수 제외, 미노출');
      return out;
    }
    if(out.suspension.blocked===null){
      out.action='hold';
      out.reasons.push(out.suspension.label+' — 승인/수정요청 보류');
      return out;
    }

    /* 사진 포렌식 (첨부 최대 4장) */
    var cls=[]; for(var i=0;i<Math.min(atts.length,4);i++){ var d=await imgDims(atts[i]); cls.push(classifyImg(d.w,d.h)); }
    out.photo=photoVerdict(cls); out.photoCls=cls;

    out.text = content.slice(0,120);   /* 무엇을 읽고 판정했는지 남긴다 */
    out._body = content;               /* 판정 후 비교(복붙 감지·신뢰도)에 쓰는 전체 본문 — 기록에는 안 남긴다 */

    /* ── 규칙 3: 무의미한 언어만 있으면 검수 대상이 아니다 → 미노출 ──
       단 "본문이 비어 있음"은 무의미한 언어가 아니다. 간편 리뷰일 수도 있고
       엑박 처리가 먼저일 수도 있어, 미노출로 바로 보내지 않는다. */
    var gb=gibberish(content);
    if(gb){ out.action='hide'; out.exec=true; out.reasons.push('무의미한 본문 — '+gb); return out; }
    if(isSpam(content)){ out.action='hide'; out.exec=true; out.reasons.push('본문 도배'); return out; }
    var bad=badContent(content);
    if(bad){ out.action='hold'; out.reasons.push(bad+' → 본문을 읽고 판단'); return out; }
    var le=lowEffort(content);
    if(le){ out.action='hide'; out.exec=true; out.reasons.push('무성의한 리뷰 — '+le); return out; }

    /* 취급하지 않는 품목은 검수 대상이 아니다 — 사람이 보고 미노출 여부를 정한다 */
    var nb2=notBeauty(item.productName+' '+item.brandName);
    if(nb2){ out.action='hold'; out.reasons.push('취급 품목 아님('+nb2+') → 미노출 검토'); return out; }

    /* ── 규칙 1·2: 브랜드 안에 매칭된 상품이 있고 좌상단 이미지가 떠야 검수 대상 ── */
    if(exWhy){
      out.reasons.push('엑박 — '+exWhy.join(' · '));
      var b=await findBrand(item.brandName);
      out.brand_match = b.approvedBrand ? { id:b.approvedBrand.id, name:b.approvedBrand.name, tier:b.tier } : null;
      if(!b.approvedBrand){
        /* 브랜드를 확정하지 못한 이유마다 사람이 할 일이 다르다 */
        if(b.lookupFailed){
          out.action='hold';
          out.reasons.push('브랜드 조회 실패 — 없음으로 단정하지 않음');
        } else if(b.ambiguous){
          out.action='hold';
          out.reasons.push('같은 이름의 검수 완료 브랜드 여러 건 — 사람이 선택 ['
            + b.likely.slice(0,3).map(function(x){return x.name;}).join(' / ')+']');
        } else if(b.unapproved){
          out.action='register_brand';
          out.reasons.push('브랜드 「'+b.unapproved.name+'」 미검수 — 브랜드 검수 후 상품등록');
        } else {
          out.action='register_brand';
          out.reasons.push('브랜드가 CMS에 없음 — 브랜드부터 등록');
        }
        return out;
      }
      /* 표기가 달라 유사 일치로 잡힌 경우 어떤 브랜드로 봤는지 남긴다 */
      if(b.tier>1) out.reasons.push('브랜드 「'+b.approvedBrand.name+'」 로 일치(표기 차이)');
      var pr=await findProduct(b.approvedBrand.id, item.productName);
      if(pr.pick && pr.confident){
        /* 4번: 브랜드○ 제품○ → 템플릿 수정요청 (일괄 실행 대상).
           옵션까지 확인된 건이면 유저에게는 옵션을 뺀 "제품명"으로 검색하라고 안내한다. */
        out.action='revise_product'; out.exec=true;
        out.product_exact=pr.pick.name; out.product_id=pr.pick.id;
        out.product_option=pr.option||null;
        out.reasons.push(pr.option ? '브랜드○ 제품○ (옵션 «'+pr.option+'») → 재선택 요청'
                                   : '브랜드○ 제품○ → 재선택 요청');
      } else if(pr.pick){
        out.action='hold';
        out.product_exact=pr.pick.name; out.product_id=pr.pick.id;
        out.product_options=pr.options||null; out.residue=pr.residue||null;
        out.reasons.push(pr.why);
      } else if(pr.lookupFailed){
        /* 조회가 실패한 것을 "제품 없음"으로 단정하면 안 된다 */
        out.action='hold';
        out.reasons.push('브랜드○ · '+pr.why);
      } else {
        /* 5번: 브랜드는 있는데 그 안에 제품이 없음 */
        out.action='register_product';
        out.reasons.push('브랜드○ · '+pr.why);
      }
      return out;
    }

    /* 여기부터는 규칙 1·2 를 통과한 정상 매칭 리뷰 */

    /* 사진이 전량 캡처·저해상이면 어뷰징 */
    if(out.photo.v==='suspect'){ out.action='hide'; out.exec=true; out.reasons.push('사진 '+out.photo.label); return out; }

    /* 브랜드가 CMS에 조회되는지 확인 — 액션은 바꾸지 않고 경고만 남긴다
       (브랜드 표기 차이로 조회가 빗나갈 수 있어 오탐을 만들지 않는다) */
    try {
      var nb=await findBrand(item.brandName);
      if(!nb.approvedBrand && !nb.likely.length) addWarn(out,'브랜드 조회 안 됨');
    } catch(e){}

    /* 본문이 정말 비어 있으면 자동 승인하지 않고 사람에게 보낸다 */
    if(!content){ out.action='hold'; out.reasons.push('본문 없음 → 확인'); return out; }

    /* ── 규칙 4: 발색 있는 제품이면 발색샷 유무를 사람이 보고 고른다 ── */
    out.swatch = isSwatch(item.productName);

    if(out.suspension && out.suspension.count) addWarn(out,'정지 이력 '+out.suspension.count+'회');
    if(out.photo.v==='none'){
      /* 사진이 없으면 그리드에서 눈으로 볼 것이 없다 — 승인 후보로 두지 않는다 */
      out.action='hold'; out.reasons.push('첨부 사진 없음 → 확인');
      if(out.warn) out.reasons.push(out.warn);
      return out;
    }
    out.action='approve'; out.approvable=true;
    if(out.photo.v==='mixed')       out.reasons.push('사진 '+out.photo.label+' → 눈으로 확인');
    else if(out.photo.v==='camera') out.reasons.push('직접촬영 · 매칭 정상');
    else                            out.reasons.push('사진 판별 애매 → 확인');
    if(out.swatch) out.reasons.push('발색 제품('+out.swatch+') — 발색샷 확인');
    if(out.warn)   out.reasons.push(out.warn);
    return out;
  }

  /* ── 누적 이력 (이 브라우저) ─────────────────────────────
     users : 사용자별로 콘솔이 실제로 처리한 결과 — 미노출 이력이 있으면 자동 승인에서 뺀다
     texts : 본문 지문 → 리뷰 ID — 다른 날 같은 본문을 다시 올린 복붙을 잡는다
     alias : (브랜드, 유저가 쓴 제품명) → CMS 제품 — 한 번 사람이 맞춘 표기는 다음부터 자동
     gate  : 날짜별 표본 검사 결과 — 자동 승인이 믿을 만한지 쌓아 두는 기록 */
  var HIST_KEY='unpa-console-history-v1';
  function histLoad(){
    var h; try{ h=JSON.parse(localStorage.getItem(HIST_KEY)||'{}'); }catch(e){ h={}; }
    if(!h || typeof h!=='object') h={};
    h.users=h.users||{}; h.texts=h.texts||{}; h.alias=h.alias||{}; h.gate=h.gate||[];
    return h;
  }
  function histSave(h){
    try{
      var keys=Object.keys(h.texts);
      if(keys.length>8000){      /* 오래된 지문부터 버려 저장공간을 지킨다 */
        keys.sort(function(a,b){ return String(h.texts[a].t||'')<String(h.texts[b].t||'') ? -1 : 1; });
        keys.slice(0, keys.length-8000).forEach(function(k){ delete h.texts[k]; });
      }
      if(h.gate.length>200) h.gate=h.gate.slice(-200);
      var jh=h._jh; delete h._jh;
      localStorage.setItem(HIST_KEY, JSON.stringify(h));
      if(jh) h._jh=jh;
    }catch(e){}
  }
  function histUser(h, nick){ var k=String(nick||''); return h.users[k]||(h.users[k]={approve:0,hide:0,revise:0}); }
  function aliasKey(brandId, productName){
    return String(brandId)+'|'+norm(stripSize(String(productName||'').replace(/\[[^\]]*\]/g,'')));
  }

  /* 본문 비교용 정규화 — 공백·기호를 걷고 앞 400자만 */
  function normText(t){ return String(t||'').toLowerCase().replace(/[^0-9a-z가-힣]/g,'').slice(0,400); }
  function textHash(t){      /* FNV-1a 32bit — 본문 원문을 저장하지 않고 지문만 남긴다 */
    var h=0x811c9dc5;
    for(var i=0;i<t.length;i++){ h^=t.charCodeAt(i); h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0; }
    return h.toString(36)+'_'+t.length;
  }

  /* ── 자동 승인 신뢰도 ─────────────────────────────────────
     사진이 그 제품이 맞는지는 기계가 볼 수 없다(사진 서버가 픽셀 읽기를 막는다).
     그래서 "사람이 봐도 거의 틀림없이 승인할 조건"을 모두 갖춘 건만 고신뢰로 둔다.
     하나라도 빠지면 그리드에서 사람이 본다. */
  function confidenceOf(r, h){
    var why=[];
    var cls=r.photoCls||[];
    if(!cls.length) why.push('사진 없음');
    else if(cls.indexOf('camera')<0) why.push('고해상도 직접촬영 사진 없음');
    if(cls.some(function(c){ return c==='web'||c==='screenshot'||c==='broken'; })) why.push('저해상·캡처·깨진 사진 섞임');
    var body=(String(r._body||'').match(/[가-힣a-zA-Z0-9]/g)||[]).length;
    if(body<40) why.push('본문 짧음('+body+'자)');
    if(r.swatch) why.push('발색 제품 — 발색샷 확인');
    if(r.suspension && r.suspension.count) why.push('정지 이력 '+r.suspension.count+'회');
    if(r.warn) why.push(r.warn);
    if(r.dup) why.push(r.dup);
    var u=h.users[String(r.user||'')];
    var hides=Math.max(u ? (u.hide||0) : 0, (h._jh||{})[String(r.user||'')]||0);   /* 다른 컴퓨터에서 미노출한 것도 센다 */
    if(hides) why.push('과거 미노출 '+hides+'회 사용자');
    /* 짧은 본문인데 제품·브랜드 언급도 없으면 제품 리뷰인지 확신할 수 없다 */
    if(body<80){
      var nt=normText(r._body);
      var mention = (bareName(r.brand) && nt.indexOf(bareName(r.brand))>=0)
                 || tokensOf(r.product).some(function(t){ return t.length>=2 && nt.indexOf(t)>=0; });
      if(!mention) why.push('짧은 본문에 제품·브랜드 언급 없음');
    }
    return { level: why.length ? 'check' : 'high', why: why };
  }

  /* 판정이 끝난 뒤 리뷰끼리 비교해야 알 수 있는 것들 */
  function postScan(){
    var h=histLoad();
    h._jh={}; var J=sentLoad(); Object.keys(J).forEach(function(k){ var e=J[k]; if(e && e.action==='hide' && e.u) h._jh[e.u]=(h._jh[e.u]||0)+1; });
    var items=results.filter(function(r){ return r && r._body!==undefined; });
    items.forEach(function(r){ r._nt=normText(r._body); r._bg=r._nt.length>=30 ? bigrams(r._nt) : null; });

    /* ① 같은 날 거의 같은 본문 (복붙) */
    for(var i=0;i<items.length;i++){
      var a=items[i]; if(!a._bg) continue;
      for(var j=i+1;j<items.length;j++){
        var b=items[j]; if(!b._bg) continue;
        var common=0, A=a._bg.m, B=b._bg.m;
        for(var g in A){ if(B[g]) common+=Math.min(A[g],B[g]); }
        var d=(2*common)/(a._bg.n+b._bg.n);
        if(d<0.85) continue;
        var same = a.user && a.user===b.user;
        var msgA = same ? '같은 사용자가 다른 리뷰(#'+b.id+')에 거의 같은 본문' : '다른 리뷰(#'+b.id+')와 본문 거의 동일 — 복붙 의심';
        var msgB = same ? '같은 사용자가 다른 리뷰(#'+a.id+')에 거의 같은 본문' : '다른 리뷰(#'+a.id+')와 본문 거의 동일 — 복붙 의심';
        if(!a.dup){ a.dup=msgA; a.reasons.push(msgA); }
        if(!b.dup){ b.dup=msgB; b.reasons.push(msgB); }
      }
    }

    /* ② 지난 스캔에서 본 본문을 다른 리뷰로 다시 올린 경우 */
    var now=new Date().toISOString();
    items.forEach(function(r){
      if(r._nt.length<30) return;
      var k=textHash(r._nt), seen=h.texts[k];
      if(seen && String(seen.id)!==String(r.id) && !r.dup){
        r.dup='과거 리뷰(#'+seen.id+', '+seen.d+')와 본문 동일';
        r.reasons.push(r.dup);
      }
      /* 처음 본 리뷰를 원본으로 둔다 — 덮어쓰면 원본이 도리어 복붙으로 몰린다 */
      if(!seen) h.texts[k]={ id:String(r.id), d:r.date||SCAN_DATE, t:now };
      else if(String(seen.id)===String(r.id)) seen.t=now;
    });

    /* ③ 승인 후보 신뢰도 + 표본 */
    var highs=[];
    results.forEach(function(r){
      if(r.action!=='approve' || !r.approvable || r.applied) return;
      var c=confidenceOf(r, h);
      r.conf=c.level; r.confWhy=c.why; r.sample=false;
      if(c.level==='high') highs.push(r);
    });
    /* 이번 달 목표 안에서 할 승인만 고르고(planApprovals), 그 고신뢰 중 10%(최소 3건)를 표본으로 사람이 확인한다.
       표본이 하나라도 탈락하면 그날 고신뢰 자동 승인은 통째로 보류된다. */
    planApprovals();
    fixSamples();

    histSave(h);
  }

  /* 그리드 실행 대상 결정 — 표본이 전부 통과해야 고신뢰 건을 함께 보낸다 */
  function gridJobs(pool, st, highs){
    var jobs=[], samples=pool.filter(function(r){ return r.sample; });
    pool.forEach(function(r){
      var v=st[r.id];
      if(v==='approve'){ r.action='approve'; jobs.push(r); }
      else if(v==='swatch'){ r.action='revise_swatch'; jobs.push(r); }
    });
    var failed=samples.filter(function(r){ return st[r.id]!=='approve'; });
    var gateOk = samples.length>0 && failed.length===0;
    if(gateOk) highs.forEach(function(r){ r.action='approve'; jobs.push(r); });
    return { jobs:jobs, gateOk:gateOk, samples:samples.length, failed:failed.length };
  }

  /* ── 등록 후 재확인 ────────────────────────────────────
     사람이 CMS 에 상품(또는 브랜드)을 등록하고 완료 체크를 하면,
     그 제품을 다시 찾아 유저에게 보낼 "제품 재선택 요청"으로 바꾼다.
     찾지 못하면(등록 검수 대기 등) 표시만 남기고 그대로 둔다. */
  async function recheckRegistered(list){
    var found=[];
    for(var i=0;i<list.length;i++){
      var r=list[i];
      try{
        delete brandCache[norm(r.brand)];                      /* 방금 등록한 것을 보려고 캐시를 비운다 */
        var b=await findBrand(r.brand);
        if(!b.approvedBrand){ r.recheck=b.unapproved?'브랜드가 아직 미검수':'브랜드가 아직 검색되지 않음'; continue; }
        var pr=await findProduct(b.approvedBrand.id, r.product);
        if(pr.pick && pr.confident){
          r.action='revise_product'; r.exec=true; r.recheck=null;
          r.product_exact=pr.pick.name; r.product_id=pr.pick.id;
          r.brand_match={ id:b.approvedBrand.id, name:b.approvedBrand.name, tier:b.tier };
          r.reasons.push('등록 확인 → 재선택 요청 ('+pr.why+')');
          found.push(r);
        } else {
          /* 이름이 달라 못 찾았어도, 방금 내가 그 브랜드에 등록한 제품이 있으면 그것이다 */
          var me=(typeof ME!=='undefined' && ME) || await whoAmI();
          var pe=pendingLoad()[String(r.id)]||{};
          var entry={ id:String(r.id), ex:true, st:'open', b:r.brand, bid:b.approvedBrand.id, p:r.product,
                      since:pe.since||new Date(Date.now()-6*3600e3).toISOString() };
          var as=me ? associate([entry], await myRecentProducts(me)) : [];
          if(as.length){
            var ap=as[0].p;
            r.action='revise_product'; r.exec=true; r.recheck=null;
            r.product_exact=ap.name; r.product_id=ap.id;
            r.brand_match={ id:b.approvedBrand.id, name:b.approvedBrand.name, tier:b.tier };
            r.reasons.push('방금 등록한 「'+ap.name+'」와 연결 (이름 일치도 '+as[0].s.toFixed(2)+')');
            found.push(r);
          } else {
            r.recheck = pr.pick ? '후보 「'+pr.pick.name+'」 — 확정 못 함' : (pr.lookupFailed ? '제품 조회 실패' : '아직 CMS에서 검색되지 않음');
          }
        }
      }catch(e){ r.recheck='재확인 오류 — '+(e&&e.message||e); }
    }
    return found;
  }

  /* ── 대기 목록과 경험 쌓기 ───────────────────────────────
     콘솔이 "상품등록 필요 · 브랜드+상품 등록 · 확인"으로 넘긴 리뷰를 유저가 쓴 표기 그대로 기억해 두고,
     그 뒤 일어난 일에서 배운다.
       - 내 계정이 그 브랜드에 새 제품을 등록했다 → 이름이 맞으면 그 리뷰의 제품으로 짝짓고 수정요청을 준비한다
       - 콘솔이나 CMS 화면에서 수정요청을 보냈다 → 보낸 것으로 표시하고 계속 지켜본다
       - 유저가 제품을 다시 골랐다(목록에 CMS 제품명이 뜬다) → (브랜드, 유저 표기) → 그 제품 을 배운다
     배운 연결은 다음 스캔의 제품 찾기(1-1단계)에서 바로 쓰이고, 업무일지 서버로 다른 컴퓨터와 나눈다.
     상태 st: open 대기 · sent 콘솔이 요청 보냄 · sent-manual CMS 에서 직접 보냄 · learned 배움 · resolved 끝남 */
  var PENDING_KEY='unpa-console-pending-v1';
  var MANUAL_KINDS={ register_product:1, register_brand:1, hold:1 };
  function pendingLoad(){ try{ var o=JSON.parse(localStorage.getItem(PENDING_KEY)||'{}'); return (o && typeof o==='object') ? o : {}; }catch(e){ return {}; } }
  function pendingSave(o){
    var now=Date.now();
    Object.keys(o).forEach(function(k){ var e=o[k]; if(!e || now-(Date.parse(e.since||0)||0)>90*864e5) delete o[k]; });   /* 90일 지난 것은 버린다 */
    try{ localStorage.setItem(PENDING_KEY, JSON.stringify(o)); return true; }catch(e){ return false; }
  }
  function pendingMark(id, st, extra){
    var o=pendingLoad(), e=o[String(id)]; if(!e) return;
    o[String(id)]=Object.assign({}, e, extra||{}, { st:st, u:new Date().toISOString() });
    pendingSave(o);
  }
  /* 스캔 결과에서 사람이 할 일로 남긴 것을 기억한다 */
  function pendingRecord(rows){
    var o=pendingLoad(), now=new Date().toISOString();
    rows.forEach(function(r){
      if(!r || r.id==null) return;
      var k=String(r.id), e=o[k];
      if(MANUAL_KINDS[r.action] && !r.applied){
        o[k]=Object.assign({}, e||{}, {
          id:k, d:r.date||SCAN_DATE, b:String(r.brand||''), p:String(r.product||''),
          bid:(r.brand_match && r.brand_match.id) || (e && e.bid) || null,
          a:r.action, ex:!!r.exbak, why:String((r.reasons||[]).slice(-1)[0]||'').slice(0,90),
          since:(e && e.since) || now, u:now,
          st:(e && (e.st==='sent-manual' || e.st==='learned')) ? e.st : 'open' });
      }
    });
    pendingSave(o);
  }
  function brandSame(e, p){
    if(e.bid && p.bid) return String(e.bid)===String(p.bid);
    var a=bareName(e.b), b=bareName(p.bname);
    if(!a || !b) return false;
    if(a===b) return true;
    var mn=Math.min(a.length,b.length), mx=Math.max(a.length,b.length);
    return (a.indexOf(b)>=0 || b.indexOf(a)>=0) && mn/mx>=0.6;
  }
  /* 사람이 이미 "새 제품이 필요하다"고 보고 등록까지 한 뒤라 기준을 조금 낮춰도 된다 — 대신 종류가 다르면 안 되고, 후보가 뚜렷해야 한다 */
  function nameScore(userName, cmsName){
    if(kindRel(userName, cmsName)==='clash') return 0;
    var uT=tokensOf(userName), cT=tokensOf(cmsName);
    var ab=abbrMatch(uT, cT);
    var d=diceSim(norm(canonKind(stripSize(userName))), norm(canonKind(stripSize(cmsName))));
    var lc=(looseCover(uT, cT)+looseCover(cT, uT))/2;
    return Math.max(ab ? 0.9 : 0, d, lc);
  }
  /* 대기 리뷰 ↔ 내가 그 뒤에 등록한 제품 */
  function associate(entries, mine){
    var out=[];
    entries.forEach(function(e){
      if(!e || !e.ex || !(e.st==='open' || e.st==='sent-manual')) return;
      var t0=(Date.parse(e.since||0)||0)-15*60000;
      var c=mine.filter(function(p){ return (Date.parse(p.at)||0)>=t0 && brandSame(e, p); })
        .map(function(p){ return { p:p, s:nameScore(e.p, p.name) }; })
        .filter(function(x){ return x.s>=0.55; })
        .sort(function(a,b){ return b.s-a.s; });
      if(!c.length || (c.length>1 && c[0].s-c[1].s<0.1)) return;       /* 비슷한 게 둘이면 사람에게 */
      out.push({ e:e, p:c[0].p, s:c[0].s });
    });
    return out;
  }
  function learnAlias(bid, userName, pid, name){
    if(!bid || !pid || !userName) return;
    var h=histLoad(), k=aliasKey(bid, userName), prev=h.alias[k];
    h.alias[k]={ pid:pid, name:name, n:(prev && String(prev.pid)===String(pid)) ? (prev.n||1)+1 : 1, t:new Date().toISOString() };
    histSave(h);
  }
  /* CMS 목록에서 본 대기 리뷰의 그 뒤 상태로 배운다 (me = 내 계정) */
  async function learnFromWatch(watch, me){
    var o=pendingLoad(), learned=0, sent=0, done=0;
    var ids=Object.keys(watch||{});
    for(var i=0;i<ids.length;i++){
      var k=ids[i], e=o[k], w=watch[k]; if(!e || !w || e.st==='learned' || e.st==='resolved') continue;
      if(w.visible===false && w.status==='PENDING'){ e.st='resolved'; done++; continue; }
      if(w.status==='REVISED' && w.actor===me && e.st==='open'){ e.st='sent-manual'; e.u=new Date().toISOString(); sent++; }
      /* 유저가 제품을 골랐다 — 목록의 제품명이 유저 표기에서 CMS 제품명으로 바뀐다 */
      if(e.ex && (w.status==='APPROVED' || w.status==='UPDATED') && w.productName && norm(w.productName)!==norm(e.p)){
        var dr=await get(API+'/admin/reviews/'+k);
        var pid=dr.json && dr.json.productId;
        if(pid){
          var bid=e.bid;
          if(!bid){ var b=await findBrand(w.brandName||e.b); bid=b.approvedBrand && b.approvedBrand.id; }
          learnAlias(bid, e.p, pid, dr.json.productName||w.productName);
          e.st='learned'; e.pid=pid; e.pname=dr.json.productName||w.productName; e.u=new Date().toISOString(); learned++;
        }
      } else if(w.status==='APPROVED' && e.st!=='sent-manual'){ e.st='resolved'; done++; }
    }
    pendingSave(o);
    return { learned:learned, sent:sent, done:done };
  }
  /* 내가 최근에 등록한 제품 (등록 직후 재확인용) */
  async function myRecentProducts(me){
    var r=await get(API+'/admin/products?approved=true&brandApproved=true&page=1&pageSize=100'), rows=listOf(r.json)||[];
    return rows.filter(function(p){ return p && p.approvedAt && String(p.approvedBy||'').trim().toLowerCase()===me; })
      .map(function(p){ return { id:p.id, name:p.name||'', bid:p.brand&&p.brand.id, bname:(p.brand&&p.brand.name)||'', at:p.approvedAt }; });
  }
  /* 업무일지 서버에 올려 다른 컴퓨터와 나누는 콘솔 경험 */
  function consoleState(){
    var h=histLoad();
    return { alias:h.alias, gate:h.gate, texts:h.texts, done:doneRaw(), pending:pendingLoad(), sent:sentLoad() };
  }
  /* 서버에서 합쳐 돌아온 경험을 이 브라우저에 반영한다 — 그사이 새로 쌓인 것도 잃지 않게 한 번 더 합친다 */
  function applyConsoleState(m){
    if(!m || typeof m!=='object') return false;
    var C=window.WorklogCore;
    if(!C || !C.mergeConsole) return false;
    var x=C.mergeConsole(m, consoleState());
    var h=histLoad(); h.alias=x.alias; h.gate=x.gate; h.texts=x.texts; histSave(h);
    try{
      localStorage.setItem(DONE_KEY, JSON.stringify(x.done));
      localStorage.setItem(SENT_KEY, JSON.stringify(x.sent));
    }catch(e){}
    pendingSave(x.pending);
    return true;
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

  var ACT={
    approve:          {t:'검수완료',              c:'#3ddc97'},
    revise_swatch:    {t:'발색샷 요청',            c:'#f0a35e'},
    revise_product:   {t:'제품 재선택 요청',        c:'#3ddc97'},
    hide:             {t:'미노출',                c:'#ff8f6b'},
    register_product: {t:'상품등록 필요 (브랜드○)', c:'#f5c451'},
    register_brand:   {t:'브랜드+상품 등록 필요',   c:'#f5c451'},
    hold:             {t:'👀 확인',               c:'#8fb8ff'}
  };
  /* 사람이 직접 해야 하는 것 — 실행 버튼을 붙이지 않는다 */
  var MANUAL={ register_product:1, register_brand:1, hold:1 };

  function head(html){
    return '<b style="color:#3ddc97">🧭 리뷰 검수 콘솔</b>'
      +'<div id="csSync" style="margin-top:4px;font-size:11.5px;color:#9fb4ab">'+SYNC_HTML+'</div>'+html;
  }
  /* 동기화 버튼은 화면이 다시 그려져도 살아 있도록 위임으로 받는다 */
  box.addEventListener('click', function(ev){
    var t=ev.target;
    if(t && t.id==='csSyncBtn'){ ev.preventDefault(); ev.stopPropagation(); syncNow(); }
  });

  async function renderStart(sd){
    var manual='<div style="margin-top:12px;border-top:1px solid #22392e;padding-top:10px;font-size:12px;color:#9fb4ab">날짜 하나만 '
      +'<input id="csDate" value="'+esc(sd)+'" style="width:112px;background:#132019;color:#e8f1ed;border:1px solid #2c4a3c;border-radius:7px;padding:4px 7px;font:inherit"> '
      +'<button id="csScan" style="background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:7px;padding:5px 10px;font:inherit;cursor:pointer">이 날짜만 스캔</button></div>'
      +'<div style="margin-top:8px;font-size:11px;color:#6b7f77">스캔은 조회만 합니다. 실제 처리는 이후 대기열·그리드에서 승인해야 나갑니다.</div>';
    var bindManual=function(){
      document.getElementById('csScan').onclick=function(){ var d=document.getElementById('csDate').value.trim(); if(!validDate(d)){alert('실제 존재하는 YYYY-MM-DD 날짜를 입력해주세요.');return;} scan(d); };
    };

    var backlog=await loadBacklog();
    if(backlog===null){
      box.innerHTML=head('<div style="margin-top:9px;color:#ff8f6b">목록 조회 실패 — 관리 화면에서 목록을 한 번 불러온 뒤 다시 실행해주세요.</div>'+manual);
      bindManual(); return;
    }
    BACKLOG=backlog;
    var total=0, upd=0; backlog.forEach(function(b){ total+=b.rows.length; upd+=b.updated; });
    var warns='';
    if(backlog.failed && backlog.failed.length)
      warns+='<div style="margin-top:8px;font-size:11.5px;color:#ff8f6b">⚠ 조회 실패 '+backlog.failed.length+'일 ('
        +backlog.failed.slice(0,6).map(function(d){ return d.slice(5); }).join(', ')+(backlog.failed.length>6?' …':'')
        +') — 이 날짜는 목록에 없습니다. 잠시 뒤 콘솔을 다시 열어 주세요.</div>';
    if(!tplMap.product_match || !tplMap.swatch)
      warns+='<div style="margin-top:8px;font-size:11.5px;color:#ff8f6b">⚠ 수정요청 안내 문구를 불러오지 못했습니다 — 제품 재선택·발색샷 요청은 보낼 수 없습니다. 새로고침 후 다시 실행해 주세요.</div>';
    var list = backlog.length
      ? backlog.slice(0,14).map(function(b){
          return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #1a2b23">'
            +'<span>'+b.date.slice(5)+'</span><span><b style="color:#e8f1ed">'+b.rows.length+'</b>건'
            +(b.updated?' <span style="color:#f5c451">✏️수정완료 '+b.updated+'</span>':'')+'</span></div>';
        }).join('') + (backlog.length>14?'<div style="color:#6b7f77;font-size:11px;margin-top:3px">… 외 '+(backlog.length-14)+'일</div>':'')
      : '<div style="color:#3ddc97">짝수일에 남은 일이 없습니다 🎉</div>';
    box.innerHTML=head(
      '<div style="margin-top:9px;color:#9fb4ab">📋 남은 일 · 짝수일 최근 '+BACKLOG_DAYS+'일</div>'
      +'<div style="margin-top:6px;font-size:12px;color:#9fb4ab">'+list+'</div>'+warns+'<div id="csAssoc"></div>'
      +(backlog.length?'<button id="csScanAll" style="margin-top:11px;width:100%;background:#3ddc97;color:#04130c;border:0;border-radius:9px;padding:10px;font-weight:800;cursor:pointer">'
        +'▶ 남은 것 전부 스캔 ('+backlog.length+'일 · '+total+'건'+(upd?' · 수정완료 '+upd:'')+')</button>':'')
      +manual);
    bindManual();
    if(backlog.length) document.getElementById('csScanAll').onclick=function(){ scanAll(backlog); };
    renderAssoc();
  }

  function listUrl(sd,page,size){ return API+'/admin/reviews?pageSize='+size+'&startDate='+sd+'&endDate='+sd+'&beforeApproval=true&page='+page+'&field=CREATED_AT&direction=desc'; }

  /* ── 날짜 ─────────────────────────────────────────────
     담당은 짝수일(그날 작성된 리뷰). 업무일지도 리뷰 작성일 기준으로 적는다. */
  function ymd(d){ var p=function(n){ return (n<10?'0':'')+n; }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function evenDates(days, today){
    var now=today||new Date(), out=[];
    for(var i=0;i<days;i++){
      var d=new Date(now.getFullYear(), now.getMonth(), now.getDate()-i);
      if(d.getDate()%2===0) out.push(ymd(d));
    }
    return out;
  }
  var BACKLOG_DAYS=60, SCAN_LABEL='', BACKLOG=null, SCAN_ABORT=null;

  /* 한 날짜의 "검수 필요" 목록 전부 (수정완료 UPDATED 도 여기 섞여 있다) */
  async function listAll(sd, onPage){
    var page=1, all=[], total=0, seen={};
    while(page<=30){
      var r=await get(listUrl(sd,page,100)); var rows=listOf(r.json);
      if(r.status!==200 || !rows){ await delay(800); r=await get(listUrl(sd,page,100)); rows=listOf(r.json); }   /* 한 번만 더 */
      if(r.status!==200 || !rows) return null;
      total=totalOf(r.json)||total;
      /* 오늘 날짜는 넘기는 사이에 새 리뷰가 들어와 앞 페이지 것이 밀려 온다 — 같은 리뷰를 두 번 넣지 않는다 */
      rows.forEach(function(x){ if(x && x.id!=null && !seen[x.id]){ seen[x.id]=1; all.push(x); } });
      if(onPage) onPage(all.length);
      if(rows.length<100 || (total>0 && all.length>=total)) break; page++;
    }
    return all;
  }

  /* 짝수일마다 아직 할 일이 남은 리뷰를 모은다.
     이미 콘솔로 처리한 건(전송 이력)과 이미 미노출된 건은 빼되,
     예전에 제품 재선택 요청을 보냈는데 유저가 수정완료한 건은 다시 넣는다. */
  function backlogTodo(rows, sent){
    return rows.filter(function(x){
      if(x.visible===false) return false;
      var e=sent[String(x.id)];
      if(!e) return true;
      return x.status==='UPDATED' && (e.action==='revise_product' || e.action==='revise_swatch');
    });
  }
  async function loadBacklog(){
    var dates=evenDates(BACKLOG_DAYS), sent=sentLoad(), res=new Array(dates.length), next=0, doneN=0;
    var paint=function(){
      box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">남은 일 확인 중… <b>'+doneN+' / '+dates.length+'</b>일<br>'
        +'<span style="font-size:11px">짝수일 최근 '+BACKLOG_DAYS+'일 · 조회만 합니다</span></div>');
    };
    paint();
    async function worker(){
      while(next<dates.length){
        var i=next++, rows=await listAll(dates[i]);
        if(rows===null) res[i]={ date:dates[i], failed:true, rows:[], updated:0 };
        else {
          var todo=backlogTodo(rows, sent);
          res[i]={ date:dates[i], rows:todo, updated:todo.filter(function(x){ return x.status==='UPDATED'; }).length };
        }
        doneN++; paint();
        await delay(40);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    var failed=res.filter(function(x){ return x.failed; }).map(function(x){ return x.date; });
    if(failed.length===dates.length) return null;          /* 전부 실패 = 로그인·권한 문제 */
    var out=res.filter(function(x){ return !x.failed && x.rows.length; });
    out.failed=failed;                                     /* 일부만 실패한 날짜는 따로 알린다 */
    return out;
  }

  async function scan(sd){
    SCAN_DATE=sd; SCAN_LABEL=sd;
    box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">목록 수집…</div>');
    var all=await listAll(sd, function(n){ box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">목록 수집… <b>'+n+'</b>건</div>'); });
    if(all===null){ box.innerHTML=head('<div style="margin-top:9px;color:#ff8f6b">인증/조회 실패<br>관리 화면에서 목록을 한 번 불러온 뒤 다시 실행해주세요.</div>'); return; }
    all.forEach(function(x){ x._date=sd; });
    await scanRows(all);
  }

  /* 남은 짝수일을 한 번에 — 날짜마다 따로 돌리던 것을 한 번으로 */
  async function scanAll(backlog){
    var dates=backlog.map(function(b){ return b.date; }).sort();
    SCAN_DATE = dates.length===1 ? dates[0] : dates[0]+'_'+dates[dates.length-1];
    SCAN_LABEL = dates.length===1 ? dates[0] : dates[0].slice(5)+' ~ '+dates[dates.length-1].slice(5)+' ('+dates.length+'일)';
    var rows=[];
    backlog.forEach(function(b){ b.rows.forEach(function(x){ x._date=b.date; rows.push(x); }); });
    await scanRows(rows);
  }

  async function scanRows(pending){
    results=[]; SCAN_ABORT=null;
    var fails=0;
    for(var i=0;i<pending.length;i++){
      box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">판정 중… <b>'+(i+1)+' / '+pending.length+'</b><br>'
        +esc(pending[i].brandName||'')+' — '+esc(pending[i].productName||'')+'</div>');
      var dr=await get(API+'/admin/reviews/'+pending[i].id);
      var c;
      if(dr.status!==200 || !dr.json || typeof dr.json!=='object'){
        /* 상세를 못 받았으면 빈 값으로 지어내지 않는다 — 잘못된 판정보다 보류가 낫다 */
        c={ id:pending[i].id, brand:pending[i].brandName, product:pending[i].productName,
            user:pending[i].userNickname, action:'hold', exec:false, approvable:false,
            reasons:['리뷰 상세 조회 실패 (HTTP '+dr.status+') — 판정 보류'],
            attachments:[], photo:{v:'none',label:'조회 실패'}, photoCls:[] };
        fails++;
      } else {
        fails=0;
        try {
          c=await classify(pending[i], dr.json);
        } catch(e){
          /* 한 건이 터져도 나머지 스캔은 이어간다 */
          c={ id:pending[i].id, brand:pending[i].brandName, product:pending[i].productName,
              user:pending[i].userNickname, action:'hold', exec:false, approvable:false,
              reasons:['판정 중 오류 — '+(e&&e.message||e)], attachments:[],
              photo:{v:'none',label:'오류'}, photoCls:[] };
        }
      }
      /* 목록을 받은 뒤 시간이 지났을 수 있다 — 상태·노출은 방금 받은 상세를 따른다 */
      var dj=(dr.status===200 && dr.json && typeof dr.json==='object') ? dr.json : {};
      var vis = typeof dj.visible==='boolean' ? dj.visible : pending[i].visible;
      if(c.action==='hide' && vis===false && !c.applied){
        c.applied=true; c.exec=false;
        c.reasons.push('이미 미노출 상태 — 보내지 않음');
      } else if(vis===false && !c.applied){
        /* 누가 이미 미노출한 리뷰를 승인·수정요청하지 않는다 */
        c.action='hold'; c.exec=false; c.approvable=false;
        c.reasons.push('이미 미노출된 리뷰 — 승인·수정요청 대상에서 제외');
      }
      c.date = pending[i]._date || SCAN_DATE;
      c.reviewStatus = dj.status || pending[i].status || null;
      if(c.reviewStatus==='UPDATED'){
        c.reasons.unshift(c.exbak ? '✏️ 유저가 수정완료했지만 제품이 아직 연결 안 됨' : '✏️ 유저 수정완료');
      }
      c=sentApply(c);
      /* 콘솔 밖(CMS 화면)에서 이미 처리된 리뷰 — 다시 보내면 에러로 배치가 멈춘다 */
      if(!c.applied && (c.reviewStatus==='APPROVED' || c.reviewStatus==='REVISED')){
        c.action='hold'; c.exec=false; c.approvable=false;
        c.reasons.unshift('CMS에서 이미 '+(c.reviewStatus==='APPROVED'?'검수완료':'수정요청')+'된 리뷰 — 보내지 않음');
      }
      results.push(c);
      if(fails>=5){
        SCAN_ABORT='리뷰 상세 조회가 연속 '+fails+'번 실패해 '+(i+1)+' / '+pending.length+'건에서 멈췄습니다. '
          +'CMS 로그인 상태를 확인하고 [다시]를 눌러 주세요. 못 본 건은 남은 일 목록에 그대로 남습니다.';
        break;
      }
      await delay(60);
    }
    postScan();
    pendingRecord(results);
    outboxAudit();
    renderQueue(SCAN_LABEL||SCAN_DATE);
  }

  function renderQueue(sd){
    sd = SCAN_LABEL || sd;          /* 실행·체크 뒤 다시 그려도 "09-20 ~ 09-26 (3일)" 표시를 유지한다 */
    var B=planApprovals(); fixSamples();
    var done=doneLoad();
    var multiDay=scanDates().length>1;
    var groups={revise:[],hide:[],register:[],hold:[]};
    results.forEach(function(r){ (groups[r.action]||(groups[r.action]=[])).push(r); });
    var order=['revise_product','hide','register_product','register_brand','hold','revise_swatch','approve'];

    var html='<div style="margin-top:8px;color:#9fb4ab">'+esc(sd)+' · 총 <b style="color:#fff">'+results.length+'</b>건 판정 완료</div>'
      +(SCAN_ABORT?'<div style="margin-top:6px;font-size:11.5px;color:#ff8f6b">⚠ '+esc(SCAN_ABORT)+'</div>':'')
      +(results.some(function(r){ return r.action==='approve' && !r.applied; })
         ? '<div style="margin-top:6px;font-size:11.5px;color:'+(B.known?'#f5c451':'#6b7f77')+'">'+esc(budgetLine(B))
           +(B.known && B.deferredN ? ' · <b>'+B.deferredN+'건은 남겨 둠</b>(다음 달)' : '')+'</div>' : '');
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
    order.forEach(function(k){ if(!groups[k]||!groups[k].length) return;
      var nDone = MANUAL_TODO[k] ? groups[k].filter(function(r){ return done[String(r.id)]; }).length : 0;
      html+='<span style="font-size:11px;background:#132019;border:1px solid #2c4a3c;border-radius:20px;padding:3px 9px;color:'+ACT[k].c+'">'+ACT[k].t+' <b>'+groups[k].length+'</b>'
        +(nDone?' <span style="color:#3ddc97">· 완료 '+nDone+'</span>':'')+'</span>'; });
    html+='</div>';

    order.forEach(function(k){ var g=groups[k]; if(!g||!g.length) return;
      var exec = (k==='revise_product'||k==='hide');
      var manual = !!MANUAL_TODO[k];
      var gDone = manual ? g.filter(function(r){ return done[String(r.id)]; }).length : 0;
      html+='<div style="margin-top:12px;border-top:1px solid #22392e;padding-top:9px">'
        +'<div style="font-weight:800;color:'+ACT[k].c+'">'+ACT[k].t+' · '+g.length+'건'
        +(manual?' <span class="csDoneCnt" data-k="'+k+'" style="font-size:11px;color:'+(gDone===g.length?'#3ddc97':'#9fb4ab')+'">✓ '+gDone+'/'+g.length+'</span>':'')
        +(k==='approve'?(function(){
            var hi=g.filter(function(r){ return r.conf==='high' && !r.applied; }).length;
            var ck=g.filter(function(r){ return r.conf==='check' && !r.applied; }).length;
            return ' <span style="font-size:11px;color:#9fe3c4">⚡고신뢰 '+hi+'</span> <span style="font-size:11px;color:#9fb4ab">👀확인 '+ck+'</span>';
          })():'')
        +' <span style="font-size:10.5px;color:#6b7f77">('
        + (exec ? '체크 후 실행' : (k==='approve'||k==='revise_swatch') ? '👀 그리드에서 처리' : '사람이 직접')
        +')</span></div>';
      g.forEach(function(r,idx){
        var gid=k+'_'+idx;
        var dn = manual ? done[String(r.id)] : null;
        var strike = dn ? 'text-decoration:line-through;text-decoration-color:rgba(159,180,171,.7);' : '';
        html+='<div class="csCard" data-id="'+r.id+'" style="margin-top:7px;background:'+(dn?'#0d1512':'#111d18')+';border:1px solid '+(dn?'#1a2b23':'#22392e')+';border-radius:8px;padding:8px 10px;opacity:'+(dn?'.6':'1')+'">'
          +(exec?'<label style="display:flex;gap:7px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="csChk" data-id="'+r.id+'" '+(r.applied?'disabled':'checked')+' style="margin-top:3px">'
            :manual?'<div style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" class="csDone" data-id="'+r.id+'" '+(dn?'checked':'')+' title="등록을 끝냈으면 체크 (표시만, CMS 로 보내지 않음)" style="margin-top:3px;width:15px;height:15px;accent-color:#3ddc97;cursor:pointer">'
            :'<div>')
          +'<div><a class="csLink" href="'+reviewUrl(r.id)+'" target="_blank" rel="noopener" '
          +'title="CMS 리뷰 상세를 새 탭에서 열기" '
          +'style="color:#8fd8ff;font-weight:800;text-decoration:none;border-bottom:1px dotted rgba(143,216,255,.5)">#'+r.id+' ↗</a> '
          +(r.applied?'<span style="color:#3ddc97;font-weight:800">✓ 처리됨</span> ':'')
          +(multiDay?'<span style="color:#6b7f77;font-size:10.5px">'+esc(String(r.date||'').slice(5))+'</span> ':'')
          +(r.reviewStatus==='UPDATED'?'<span style="font-size:10.5px;color:#f5c451;font-weight:800">✏️수정완료</span> ':'')
          +'<span style="color:#9fb4ab;'+strike+'">'+esc(r.brand||'')+' / '+esc(r.product||'')+'</span>'
          +(dn?' <span style="color:#3ddc97;font-size:10.5px;font-weight:800">✓ 완료 '+esc(doneStamp(dn.at))+'</span>':'')
          +(k==='approve' && !r.applied && r.deferred ? ' <span style="font-size:10.5px;color:#f5c451;font-weight:800">⏸ 목표 도달 — 남겨 둠</span>' : '')
          +(k==='approve' && !r.applied && !r.deferred && r.conf
              ? (r.conf==='high'
                  ? ' <span style="font-size:10.5px;color:#9fe3c4;font-weight:800">⚡고신뢰'+(r.sample?' · 🎯표본':'')+'</span>'
                  : ' <span style="font-size:10.5px;color:#9fb4ab">👀 '+esc((r.confWhy||[])[0]||'확인')+'</span>')
              : '')
          + (r.suspension && (r.suspension.blocked===true || r.suspension.count)
              ? '<span style="display:inline-block;margin-left:5px;padding:1px 7px;border-radius:20px;font-size:10.5px;font-weight:800;'
                + (r.suspension.blocked===true
                    ? 'background:#4a1f1a;color:#ff8f6b;border:1px solid #ff8f6b">🚫 정지'
                    : 'background:#3a3320;color:#f5c451;border:1px solid #f5c451">⚠ 정지이력')
                + (r.suspension.count ? ' '+r.suspension.count+'회' : '') + '</span>'
              : '')
          +(r.recheck?'<div style="font-size:11px;color:#f5c451;margin-top:2px">↻ '+esc(r.recheck)+'</div>':'')
          +'<div style="font-size:11px;color:#7f948b;margin-top:2px;'+strike+'">'+esc(r.reasons.join(' · '))
          + (r.photo&&r.photo.v!=='none'?' · 사진:'+esc(r.photo.label):'')
          + (r.product_exact?' · <span style="color:#3ddc97">→ '+esc(r.product_exact)+'</span>':'')+'</div>'
          + (!exec && r.product_exact && !r.applied
              ? '<button class="csFix" data-id="'+r.id+'" '
                +'style="margin-top:7px;width:100%;background:#1b3329;color:#9fe3c4;border:1px solid #3ddc97;'
                +'border-radius:7px;padding:7px 9px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer">'
                +'「'+esc(r.product_exact)+'」로 수정요청</button>'
              : '')
          +'</div>'+(exec?'</label>':manual?'</div>':'</div>')
          +'</div>';
      });
      html+='</div>';
    });

    var nExec = results.filter(function(r){ return !r.applied && (r.action==='revise_product'||r.action==='hide'); }).length;
    var doneMap2=doneLoad();
    var pendingRe=results.filter(function(r){ return MANUAL_TODO[r.action] && doneMap2[String(r.id)]; });
    if(pendingRe.length) html+='<button id="csRecheck" style="width:100%;margin-top:14px;background:#1b3329;color:#9fe3c4;'
      +'border:1px solid #3ddc97;border-radius:9px;padding:10px;font:inherit;font-weight:800;cursor:pointer">'
      +'↻ 등록 완료 '+pendingRe.length+'건 다시 찾아 수정요청</button>';
    var cand = results.filter(function(r){ return r.approvable && !r.applied && !r.deferred; });
    var nGrid = cand.length;
    var nHigh = cand.filter(function(r){ return r.conf==='high' && !r.sample; }).length;
    var nLook = nGrid - nHigh;

    if(nGrid) html+='<button id="csGridBtn" style="width:100%;margin-top:14px;background:#8fb8ff;color:#06121f;'
      +'border:0;border-radius:9px;padding:11px;font:inherit;font-weight:800;cursor:pointer">'
      +'👀 '+nLook+'건만 보고 검수'+(nHigh?' · ⚡고신뢰 '+nHigh+'건 함께 승인':'')+'</button>';

    html+='<div style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap">'
      +'<button id="csRescan" style="flex:1;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">다시</button>'
      +'<button id="csRun" style="flex:2;background:'+(nExec?'#3ddc97':'#22392e')+';color:'+(nExec?'#04130c':'#6b7f77')+';border:0;border-radius:8px;padding:9px;font-weight:800;cursor:'+(nExec?'pointer':'default')+'">체크한 것 실행 ('+nExec+')</button>'
      +'</div>'
      +'<div id="csLog" style="margin-top:10px;font-size:11.5px;color:#9fb4ab"></div>'
      +'<div style="margin-top:7px;font-size:10.5px;color:#6b7f77">상한 — 미노출 '+capOf('hide')+' · 제품재선택 '+capOf('revise_product')+' · 발색샷 '+capOf('revise_swatch')+' · 검수완료 '+capOf('approve')
      +(scanDates().length>1?' (하루 상한 × '+scanDates().length+'일)':'')+'. 에러 시 즉시 중단.</div>';

    box.innerHTML=head(html);
    /* 링크는 label 안에 있어 클릭이 체크박스까지 토글한다 — 막는다 */
    [].slice.call(box.querySelectorAll('.csLink')).forEach(function(a){
      a.onclick=function(ev){ ev.stopPropagation(); };
    });
    /* 등록 완료 체크 — 표시만 바꾸고 CMS 로는 보내지 않는다 */
    [].slice.call(box.querySelectorAll('.csDone')).forEach(function(cb){
      cb.onclick=function(ev){ ev.stopPropagation(); };
      cb.onchange=async function(){
        var r=results.filter(function(x){ return String(x.id)===String(cb.dataset.id); })[0];
        if(!r) return;
        doneToggle(r, cb.checked);
        var top=box.scrollTop;
        if(cb.checked && MANUAL_TODO[r.action]){
          r.recheck='CMS에서 다시 찾는 중…';
          renderQueue(SCAN_DATE); box.scrollTop=top;
          var found=await recheckRegistered([r]);
          renderQueue(SCAN_DATE); box.scrollTop=top;
          if(found.length) runJobs(found);            /* 확인창 한 번이면 유저에게 나간다 */
          return;
        }
        renderQueue(SCAN_DATE);
        box.scrollTop=top;
      };
    });
    /* 확인 목록에서 한 번에 수정요청 — 확인창은 runJobs 가 띄운다 */
    [].slice.call(box.querySelectorAll('.csFix')).forEach(function(b){
      b.onclick=function(ev){
        ev.stopPropagation(); ev.preventDefault();
        var r=results.filter(function(x){ return String(x.id)===String(b.dataset.id); })[0];
        if(!r || !r.product_exact) return;
        var prev=r.action;
        r.action='revise_product';
        /* 취소·실패하면 원래 자리로 — 안 돌리면 확인 건이 "체크한 것 실행"에 체크된 채 섞인다 */
        runJobs([r]).then(function(){ if(!r.applied){ r.action=prev; renderQueue(SCAN_DATE); } });
      };
    });
    document.getElementById('csRescan').onclick=function(){ renderStart(String(SCAN_DATE||'').slice(0,10)); };
    if(nGrid) document.getElementById('csGridBtn').onclick=function(){ openGrid(); };
    var rb=document.getElementById('csRecheck');
    if(rb) rb.onclick=async function(){
      rb.disabled=true; rb.textContent='다시 찾는 중…';
      var found=await recheckRegistered(pendingRe);
      renderQueue(SCAN_DATE);
      if(found.length) runJobs(found);
      else alert('아직 CMS에서 찾지 못했습니다. 각 건의 ↻ 표시를 확인해 주세요.');
    };
    if(nExec) document.getElementById('csRun').onclick=function(){ runExec(); };
  }

  /* ── 전송 이력 ────────────────────────────────────────
     성공한 전송만 기록한다. 재스캔해도 같은 리뷰에 수정요청이
     두 번 나가지 않게 하는 것이 목적이다. */
  var SENT_KEY='unpa-console-sent-v1';
  function sentLoad(){ try{ return JSON.parse(localStorage.getItem(SENT_KEY)||'{}'); }catch(e){ return {}; } }
  var SENT_KEEP_DAYS=150;
  function isRevise(a){ return a==='revise_product' || a==='revise_swatch'; }
  /* 같은 리뷰에 수정요청을 몇 번 보냈나 (예전 기록엔 횟수가 없어 1로 본다) */
  function reviseCount(e){ return e ? (e.rn || (isRevise(e.action)?1:0)) : 0; }
  /* 수정완료 후 다시 보내는 것은 허용하되, 같은 수정요청은 2번까지만 — 무한 반복을 막는다 */
  function canSend(r, e){
    if(!e) return true;
    if(!r._allowResend) return false;
    return !(isRevise(r.action) && reviseCount(e)>=2);
  }
  function sentMark(r){
    try{ var m=sentLoad(), id=String(r.id), prev=m[id];
      m[id]={ action:r.action, at:new Date().toISOString(), date:r.date||SCAN_DATE,
              rn:reviseCount(prev)+(isRevise(r.action)?1:0) };
      if(r.user) m[id].u=String(r.user).slice(0,40);
      /* 브라우저 저장공간(약 5MB)이 차면 기록이 조용히 멈춰 중복 발송이 가능해진다.
         남은 일 목록(60일)보다 훨씬 오래된 기록부터 버린다. */
      var keys=Object.keys(m);
      if(keys.length>5000){
        var cut=new Date(Date.now()-SENT_KEEP_DAYS*864e5).toISOString();
        keys.forEach(function(k){ if(String(m[k].at||'')<cut) delete m[k]; });
      }
      localStorage.setItem(SENT_KEY, JSON.stringify(m));
      return true;
    }catch(e){ return false; }
  }
  function sentApply(r){
    var m=sentLoad(), e=m[String(r.id)];
    if(!e) return r;
    if(r.reviewStatus==='UPDATED' && isRevise(e.action)){
      var rn=reviseCount(e);
      if(isRevise(r.action) && rn>=2){
        r.action='hold'; r.exec=false; r.approvable=false;
        r.reasons=(r.reasons||[]).concat(['수정요청을 이미 '+rn+'번 보냈는데 아직 그대로 — 같은 요청을 반복하지 않고 직접 확인']);
        return r;
      }
      r._allowResend=true;           /* 유저가 응답했으니 새 차례다 — 이전 전송 기록으로 막지 않는다 */
      r.reasons=(r.reasons||[]).concat(['이전 요청('+String(e.at).slice(5,10)+') 후 유저 수정완료 — 다시 판정']);
      return r;
    }
    r.applied=true; r.action=e.action; r.approvable=false;
    r.reasons=(r.reasons||[]).concat(['이미 처리됨 ('+String(e.at).slice(0,16).replace('T',' ')+')']);
    return r;
  }

  /* ── 사람이 직접 한 등록 작업의 완료 표시 ─────────────────
     상품등록·브랜드 등록은 CMS 에서 사람이 직접 한다. 목록을 보며 하나씩 처리하므로
     끝낸 건을 체크해 둘 수 있게 한다. 표시만 할 뿐 CMS 로는 아무것도 보내지 않는다.
     브라우저에 저장해 재스캔·새로고침 후에도 유지한다. */
  var DONE_KEY='unpa-console-manual-done-v1';
  var MANUAL_TODO={ register_product:1, register_brand:1 };
  function doneRaw(){ try{ var o=JSON.parse(localStorage.getItem(DONE_KEY)||'{}'); return (o && typeof o==='object') ? o : {}; }catch(e){ return {}; } }
  /* 해제한 것은 {off:true} 로 남는다 — 다른 컴퓨터 기록과 합칠 때 되살아나지 않게 */
  function doneLoad(){ var m=doneRaw(), out={}; Object.keys(m).forEach(function(k){ if(m[k] && !m[k].off) out[k]=m[k]; }); return out; }
  function doneToggle(r, on){
    var m=doneRaw(), id=String(r.id);
    if(on) m[id]={ at:new Date().toISOString(), action:r.action, date:r.date||SCAN_DATE };
    else m[id]={ off:true, at:new Date().toISOString() };
    try{ localStorage.setItem(DONE_KEY, JSON.stringify(m)); }catch(e){ alert('완료 표시를 저장하지 못했습니다 (브라우저 저장공간 확인).'); }
    return (m[id] && !m[id].off) ? m[id] : null;
  }
  /* 저장은 ISO(UTC) 로 하되 화면에는 이 컴퓨터 시간대로 보인다 */
  function doneStamp(at){
    var d=new Date(at); if(!isFinite(d.getTime())) return '';
    var p=function(n){ return (n<10?'0':'')+n; };
    return p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
  }

  /* ── 실행 ─────────────────────────────────────────────
     대기열의 [실행]과 썸네일 그리드의 [승인]이 같은 경로를 쓴다.
     상한은 액션별로 다르다 — 되돌리기 어려운 미노출은 좁게,
     되돌리기 쉬운 승인은 넓게. */
  var CAP={ hide:30, revise_product:60, revise_swatch:120, approve:300 };
  /* 상한은 하루 기준 — 남은 짝수일을 여러 날 한꺼번에 스캔했으면 날짜 수만큼 늘린다.
     안 그러면 3일치 승인 400건이 상한 300에 막혀 아예 실행할 수 없다. */
  function capOf(k){ return (CAP[k]||0)*Math.max(1, scanDates().length); }

  function buildReq(r){
    if(r.action==='revise_product'){                 /* 제품 재선택 요청 — 정확한 상품명을 넣어 보낸다 */
      var tpl=tplMap['product_match'];
      var body=tpl?tpl.body.replace(/\{제품명\}/g, r.product_exact||r.product):null;
      return body ? {method:'POST',url:API+'/admin/reviews/'+r.id+'/revise',body:{content:[body]}} : null;
    }
    if(r.action==='revise_swatch'){                  /* 발색샷 요청 — 변수 없는 고정 문구 */
      var t2=tplMap['swatch'];
      return t2 ? {method:'POST',url:API+'/admin/reviews/'+r.id+'/revise',body:{content:[t2.body]}} : null;
    }
    if(r.action==='hide')    return {method:'PUT', url:API+'/admin/reviews/'+r.id, body:{visible:false}};
    if(r.action==='approve') return {method:'POST',url:API+'/admin/reviews/'+r.id+'/approve', body:{}};
    return null;
  }

  async function runJobs(jobs){
    if(window.__CONSOLE_RUNNING){ alert('이미 실행 중입니다.'); return; }
    if(!jobs.length){ alert('실행할 대상이 없습니다.'); return; }

    var already=sentLoad();
    jobs=jobs.filter(function(r){ return canSend(r, already[String(r.id)]); });   /* 이미 보낸 건은 빼고 보낸다 */
    if(!jobs.length){ alert('선택한 건은 모두 이미 처리되었습니다.'); return; }
    /* 안내 문구를 못 불러왔으면 수정요청은 만들 수 없다 — 실행 도중이 아니라 지금 알린다 */
    var noReq=jobs.filter(function(r){ return !buildReq(r); });
    if(noReq.length){
      if(!confirm(noReq.length+'건은 안내 문구(템플릿)가 없어 보낼 수 없습니다.\n나머지 '+(jobs.length-noReq.length)+'건만 진행할까요?')) return;
      jobs=jobs.filter(function(r){ return !!buildReq(r); });
      if(!jobs.length) return;
    }
    /* 이번 달 목표를 넘는 승인은 실행 직전에 한 번 더 잘라 낸다 (CMS 집계가 10분 넘게 지났으면 다시 센다) */
    var appr=jobs.filter(function(r){ return r.action==='approve'; }), goalNote='';
    if(appr.length){
      var B=budget();
      if(B.known && WORK && ME && Date.now()-(Date.parse(WORK.at)||0)>10*60000){
        log('🎯 목표 확인 — CMS 이번 달 승인 다시 집계 중…');
        try{ WORK=await collectWork(ME); }catch(e){}
        B=budget();
      }
      if(B.known){
        if(appr.length>B.approvals){
          var keep={}; appr.slice().sort(approvalOrder).slice(0, B.approvals).forEach(function(r){ keep[String(r.id)]=1; });
          appr.forEach(function(r){ if(!keep[String(r.id)]) r.deferred=true; });
          jobs=jobs.filter(function(r){ return r.action!=='approve' || keep[String(r.id)]; });
          goalNote='\n\n🎯 목표 '+wonFmt(B.target)+'까지 남은 '+wonFmt(Math.max(0,B.left))+' — 승인은 '+B.approvals+'건만 하고 '+(appr.length-B.approvals)+'건은 남겨 둡니다.';
          if(!jobs.length){ alert('이번 달 목표('+wonFmt(B.target)+')에 이미 닿았습니다 (이번 달 '+wonFmt(B.won)+').\n승인은 하지 않고 남겨 둡니다.'); if(results.length) renderQueue(SCAN_DATE); return; }
        } else {
          goalNote='\n\n🎯 승인 '+appr.length+'건 뒤 이번 달 '+wonFmt(B.won+appr.length*RATE_R)+' / 목표 '+wonFmt(B.target);
        }
      } else goalNote='\n\n⚠ '+B.why+' — 목표 금액 제한 없이 승인합니다.';
    }
    var byAct={}; jobs.forEach(function(r){ byAct[r.action]=(byAct[r.action]||0)+1; });
    var over=Object.keys(byAct).filter(function(k){ return byAct[k] > capOf(k); });
    if(over.length){
      alert(over.map(function(k){ return ACT[k].t+' '+byAct[k]+'건 (상한 '+capOf(k)+')'; }).join('\n')
            + '\n\n상한을 초과해 실행을 거부합니다.');
      return;
    }
    var summ=Object.keys(byAct).map(function(k){ return ACT[k].t+' '+byAct[k]+'건'; }).join(' · ');
    if(!confirm('실제로 '+jobs.length+'건을 처리합니다.\n\n'+summ+goalNote+'\n\n진행할까요?')) return;

    window.__CONSOLE_RUNNING=true;
    var run=document.getElementById('csRun'); if(run){ run.disabled=true; run.textContent='실행 중…'; }
    var logs=[], hist=histLoad();
    try {
      for(var i=0;i<jobs.length;i++){
        var r=jobs[i], req=buildReq(r);
        if(!req){ log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ #'+r.id+' 요청 생성 실패 — 건너뜀</span>'); continue; }
        log('▶ #'+r.id+' '+ACT[r.action].t+' <span style="color:#6b7f77">('+(i+1)+'/'+jobs.length+')</span>');
        var res=await send(req.method,req.url,req.body);
        var ok=(res.status>=200&&res.status<300);
        /* 이미 미노출인 리뷰에 미노출을 보내면 400 "노출 상태가 같습니다" 가 온다.
           원하는 상태는 이미 이뤄졌으므로 성공으로 보고 다음 건으로 넘어간다.
           (실측 실패 4건이 전부 이것이었고, 그때마다 배치 전체가 멈췄다) */
        if(!ok && r.action==='hide' && res.status===400 && /노출 상태가 같/.test(res.text||'')){
          ok=true; res.status=200;
          log('&nbsp;&nbsp;<span style="color:#9fb4ab">이미 미노출 상태 — 완료로 처리</span>');
        }
        r.applied=ok;
        /* 나중에 "무엇을 보고 무엇을 안내했는지" 검증할 수 있게 판단 근거를 함께 남긴다 */
        logs.push({id:r.id,action:r.action,status:res.status,ok:ok,at:new Date().toISOString(),
                   error:ok?null:String(res.text||'').slice(0,200),
                   brand:r.brand||null, user_product:r.product||null,
                   told:r.action==='revise_product'?(r.product_exact||null):null,
                   conf:r.conf||null, sample:!!r.sample, why:(r.reasons||[]).slice(-2)});
        if(ok){
          if(r.action==='approve') SESSION_APPROVED[String(r.id)]=ymd(new Date());   /* 목표 계산에 바로 반영 */
          if(pendingLoad()[String(r.id)]) pendingMark(r.id, r.action==='revise_product' ? 'learned' : isRevise(r.action) ? 'sent' : 'resolved',
                                                     r.action==='revise_product' ? { pid:r.product_id, pname:r.product_exact } : null);
          if(!sentMark(r)) log('&nbsp;&nbsp;<span style="color:#ff8f6b">⚠ 전송 기록 저장 실패 — 브라우저 저장공간을 확인하세요 (재스캔 때 다시 보낼 수 있음)</span>');
          r._allowResend=false;
          var hu=histUser(hist, r.user);
          if(r.action==='approve') hu.approve++;
          else if(r.action==='hide') hu.hide++;
          else if(r.action==='revise_product' || r.action==='revise_swatch') hu.revise++;
          /* 제품 재선택을 보냈으면 그 표기를 기억한다 — 같은 표기가 또 오면 자동 */
          if(r.action==='revise_product' && r.product_id && r.brand_match && r.brand_match.id){
            var ak=aliasKey(r.brand_match.id, r.product), prev=hist.alias[ak];
            hist.alias[ak]={ pid:r.product_id, name:r.product_exact, n:(prev&&String(prev.pid)===String(r.product_id)?(prev.n||1)+1:1), t:new Date().toISOString() };
          }
          log('&nbsp;&nbsp;<span style="color:#3ddc97">✓ '+res.status+'</span>');
        }
        else {
          log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ '+res.status+' — 중단</span>');
          log('&nbsp;&nbsp;<span style="font-size:11px">'+esc((res.text||'').slice(0,140))+'</span>');
          break;
        }
        await delay(300);
      }
      histSave(hist);
      /* 처리 로그는 파일로 내려받지 않고 검수기록에 붙여 업무일지로 넘긴다 */
      outboxRun(logs, jobs);
      var okN=logs.filter(function(x){return x.ok;}).length;
      log('<b style="color:'+(okN===logs.length?'#3ddc97':'#ff8f6b')+'">완료 '+okN+'/'+logs.length+'</b>');
    } finally {
      window.__CONSOLE_RUNNING=false;     /* 도중에 예외가 나도 콘솔이 "이미 실행 중"으로 잠기지 않게 */
    }
    if(results.length) renderQueue(SCAN_DATE); else renderStart(ymd(new Date()));
    if(logs.some(function(x){ return x.ok; })) syncNow();      /* 처리한 것을 바로 업무일지에 */
  }

  /* 대기열 체크박스 → 실행 */
  function runExec(){
    var ids={};
    [].slice.call(document.querySelectorAll('.csChk')).forEach(function(c){ if(c.checked) ids[c.dataset.id]=1; });
    runJobs(results.filter(function(r){ return ids[r.id] && (r.action==='revise_product'||r.action==='hide'); }));
  }

  /* ── 업무일지 연동 ────────────────────────────────────
     검수 기록 탭은 verdict / reason / applied 를 읽는데
     콘솔 내부는 action / reasons 를 쓴다. 여기서 맞춰 내보낸다. */
  /* 업무일지 검수 기록 탭 어휘로 대응시킨다 (탭은 revise_color 를 "발색샷 요청" 컬럼으로 쓴다) */
  var VMAP={ approve:'approve', hide:'hide',
             revise_swatch:'revise_color', revise_product:'revise_product',
             register_product:'register', register_brand:'register', hold:'hold' };
  function auditPayload(date){
    var doneMap=doneLoad();
    var rows = date ? results.filter(function(r){ return (r.date||SCAN_DATE)===date; }) : results;
    var summary={}; rows.forEach(function(r){ summary[r.action]=(summary[r.action]||0)+1; });
    /* 업무일지 브라우저에 날마다 쌓이므로 가볍게 남긴다 (저장공간 약 5MB 를 업무일지 건수와 나눠 쓴다).
       승인은 전체의 95% — 한 줄 사유만. 보류·미노출·수정요청·등록처럼 다시 볼 일이 있는 건만 근거를 자세히. */
    return {
      v:1, date:date||SCAN_DATE, at:new Date().toISOString(), total:rows.length, summary:summary,
      items: rows.map(function(r){
        var it={ id:r.id, brand:r.brand||'', product:r.product||'', user:r.user||'',
                 verdict: VMAP[r.action]||'hold', action:r.action, applied: !!r.applied,
                 reason: (r.reasons||[]).join(' · ') };
        if(r.reviewStatus && r.reviewStatus!=='PENDING') it.review_status=r.reviewStatus;
        if(r.action==='approve'){ it.reason=it.reason.slice(0,80); return it; }
        if(r.text) it.text=String(r.text).slice(0,120);
        if(r.photo && r.photo.label) it.photo=r.photo.label;
        if(r.exbak) it.exbak=true;
        if(r.swatch) it.swatch=r.swatch;
        if(r.warn) it.warn=r.warn;
        if(r.suspension && (r.suspension.blocked!==false || r.suspension.count)) it.suspension=r.suspension;
        if(MANUAL_TODO[r.action]) it.manual_done = doneMap[String(r.id)] ? doneMap[String(r.id)].at : null;
        if(r.product_exact) it.product_exact=r.product_exact;
        if(r.product_option) it.product_option=r.product_option;
        if(r.residue) it.residue=r.residue;
        if(r.brand_match) it.brand_match={ id:r.brand_match.id, name:r.brand_match.name };
        return it;
      })
    };
  }

  function scanDates(){
    var seen={}, out=[];
    results.forEach(function(r){ var d=r.date||SCAN_DATE; if(validDate(d) && !seen[d]){ seen[d]=1; out.push(d); } });
    return out.sort();
  }
  function auditDays(){
    var days={}; scanDates().forEach(function(d){ days[d]=auditPayload(d); });
    return { v:1, at:new Date().toISOString(), days:days };
  }

  /* ── 월 목표에 맞춰 승인 ─────────────────────────────────
     업무일지 수입 = 리뷰 검수완료 500원 + 제품 등록 600원 (업무일지와 같은 단가). 목표를 넘기면 안 된다.
     목표 금액은 업무일지에서(동기화 때 받아 이 브라우저에 둔다), 이번 달 수입은 CMS 실데이터로 센다.
     업무일지가 이번 달을 더 크게 알고 있으면 그 값을 쓴다 — 목표를 넘는 쪽으로는 틀리지 않게.
     남은 금액으로 할 수 있는 승인만 고른다: 고신뢰 먼저, 모자라면 사람 확인 건을 오래된 작성일부터.
     수정요청·미노출은 수입(리뷰 수)에 들어가지 않으므로 막지 않는다. */
  var RATE_R=500, RATE_P=600;
  var GOAL_KEY='unpa-console-goal-v1', SESSION_APPROVED={};
  function goalLoad(){ try{ var g=JSON.parse(localStorage.getItem(GOAL_KEY)||'null'); return (g && typeof g==='object') ? g : null; }catch(e){ return null; } }
  function goalSave(g){ try{ localStorage.setItem(GOAL_KEY, JSON.stringify(g)); }catch(e){} }
  function wonFmt(n){ return '₩'+Math.round(n||0).toLocaleString('ko-KR'); }
  function dayOf(v){ var d=Array.isArray(v) ? v[0] : v; return typeof d==='string' ? d : ''; }
  function budget(){
    var m=ymd(new Date()).slice(0,7), g=goalLoad();
    if(!g || !(g.target>0)) return { known:false, why:'업무일지 목표 금액을 아직 모름 (동기화 뒤 적용)' };
    if(!WORK) return { known:false, why:'이번 달 수입 계산 중 (CMS 집계 전)' };
    var r=0, p=0, seen={};
    Object.keys(WORK.reviews||{}).forEach(function(id){ if(dayOf(WORK.reviews[id]).slice(0,7)===m){ r++; seen[id]=1; } });
    Object.keys(SESSION_APPROVED).forEach(function(id){ if(!seen[id] && SESSION_APPROVED[id].slice(0,7)===m) r++; });
    Object.keys(WORK.products||{}).forEach(function(id){ if(dayOf(WORK.products[id]).slice(0,7)===m) p++; });
    var won=r*RATE_R+p*RATE_P, src='CMS';
    if(g.month===m && typeof g.won==='number' && g.won>won){ won=g.won; src='업무일지'; }
    var left=g.target-won;      /* 달이 바뀌어도 목표는 이어진다 (업무일지와 같은 규칙) */
    return { known:true, month:m, target:g.target, won:won, src:src, r:r, p:p, left:left, approvals:Math.max(0, Math.floor(left/RATE_R)) };
  }
  function approvalOrder(a, b){
    var ha=a.conf==='high' ? 0 : 1, hb=b.conf==='high' ? 0 : 1;
    return ha-hb || String(a.date||'').localeCompare(String(b.date||'')) || (Number(a.id)||0)-(Number(b.id)||0);
  }
  /* 승인 후보 중 이번 달 목표 안에서 할 것만 남기고 나머지는 "남겨 둠" 표시 */
  function planApprovals(){
    var b=budget();
    var c=results.filter(function(r){ return r.action==='approve' && r.approvable && !r.applied; });
    c.forEach(function(r){ r.deferred=false; });
    if(!b.known) return b;
    c.sort(approvalOrder).forEach(function(r, i){ r.deferred = i>=b.approvals; });
    b.cand=c.length; b.deferredN=Math.max(0, c.length-b.approvals);
    return b;
  }
  /* 표본은 이번에 승인할 고신뢰 중에서 10%(최소 3건) */
  function fixSamples(){
    results.forEach(function(r){ if(r.sample && r.deferred) r.sample=false; });
    var inHighs=results.filter(function(r){ return r.action==='approve' && r.approvable && !r.applied && r.conf==='high' && !r.deferred; });
    var need=Math.min(inHighs.length, Math.max(3, Math.ceil(inHighs.length*0.1)));
    var have=inHighs.filter(function(r){ return r.sample; }).length;
    var rest=inHighs.filter(function(r){ return !r.sample; });
    while(have<need && rest.length){ rest.splice(Math.floor(Math.random()*rest.length), 1)[0].sample=true; have++; }
  }
  function budgetLine(b){
    if(!b) return '';
    if(!b.known) return '🎯 '+b.why;
    return '🎯 목표 '+wonFmt(b.target)+' · 이번 달 '+wonFmt(b.won)+' · 남은 '+wonFmt(Math.max(0,b.left))+' → 승인 '+b.approvals+'건까지';
  }

  /* ── 업무일지 자동 동기화 ─────────────────────────────────
     업무일지는 "실제로 일한 날" 기준이다. 9/24 리뷰를 9/27 에 검수했으면 9/27 에 적힌다.
     근거는 CMS 에 있다.
       리뷰 : approvedAt(승인 시각) + revisedBy 의 마지막 계정(승인한 사람)
       제품 : approvedAt(검수 시각) + approvedBy(검수 계정)
     콘솔을 열면 최근 60일치를 조회만 해서 "내 계정이 그날 승인한 리뷰 / 등록한 제품"을 모으고,
     업무일지의 동기화 창(sync.html)에 넘긴다. CMS 화면에서 직접 한 작업도 같이 잡힌다.
     파일은 내려받지 않는다. 못 넘긴 검수기록은 이 브라우저 보관함에 두었다가 다음에 다시 보낸다.
     (9월 실측: 이 방식으로 센 승인 수가 직접 적어 온 업무일지 수와 같았다 — 수정요청은 세지 않는다) */
  var SYNC_URL = WORKLOG_URL + 'sync.html';
  var WL_ORIGIN = 'https://moowillbedone.github.io';
  var AUTO_FROM = '2026-09-01';          /* 이날부터 업무일지 리뷰·제품 수를 CMS 기준으로 채운다 */
  var WORK_DAYS = 60;
  var OUTBOX_KEY = 'unpa-console-outbox-v1';
  var ME = null, WORK = null, SYNC_HTML = '';

  function syncStatus(html){
    SYNC_HTML = html;
    var el=document.getElementById('csSync'); if(el) el.innerHTML=html;
  }
  async function whoAmI(){
    var r=await get(API+'/users/profile');
    var e=(r.json && typeof r.json.email==='string') ? r.json.email.trim().toLowerCase() : '';
    return /^[^@\s]+@[^@\s]+$/.test(e) ? e : null;
  }
  /* 승인한 계정 = revisedBy 의 마지막 (수정요청 후 승인하면 [나, 나], 내가 요청하고 남이 승인하면 [나, 남]) */
  function lastActor(row){
    var by=row && row.revisedBy;
    return Array.isArray(by) && by.length ? String(by[by.length-1]||'').trim().toLowerCase() : '';
  }
  function localDay(iso){ var d=new Date(iso); return isFinite(d.getTime()) ? ymd(d) : null; }

  async function collectWork(me, onProgress){
    var now=new Date(), dates=[];
    for(var i=0;i<WORK_DAYS;i++) dates.push(ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()-i)));
    var reviews={}, products={}, failed=[], next=0, doneN=0, watch={}, mine=[];
    var watchIds=pendingLoad();
    async function worker(){
      while(next<dates.length){
        var sd=dates[next++], page=1;
        while(page<=10){
          var url=API+'/admin/reviews?pageSize=1000&startDate='+sd+'&endDate='+sd+'&page='+page+'&field=CREATED_AT&direction=desc';
          var r=await get(url), rows=listOf(r.json);
          if(r.status!==200 || !rows){ await delay(800); r=await get(url); rows=listOf(r.json); }
          if(r.status!==200 || !rows){ failed.push(sd); break; }
          rows.forEach(function(x){
            if(!x || x.id==null) return;
            /* 대기 목록에 있는 리뷰는 그 뒤 상태를 지켜본다 (배우기) */
            if(watchIds[String(x.id)]) watch[String(x.id)]={ status:x.status, productName:x.productName||'', brandName:x.brandName||'',
                                                             visible:x.visible, actor:lastActor(x) };
            if(!x.approvedAt || lastActor(x)!==me) return;
            var d=localDay(x.approvedAt);
            /* [승인한 날, 브랜드, 제품, 작성일] — 업무일지 작업 증빙 */
            if(d && d>=AUTO_FROM) reviews[String(x.id)]=[d, x.brandName||'', x.productName||'', localDay(x.createdAt)||''];
          });
          if(rows.length<1000) break;
          page++;
        }
        doneN++; if(onProgress) onProgress(doneN, dates.length);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    /* 제품 목록은 등록 최신순 — 기간 앞까지만 넘긴다 */
    var since=dates[dates.length-1], pg=1;
    while(pg<=40){
      var pu=API+'/admin/products?approved=true&brandApproved=true&page='+pg+'&pageSize=300';
      var pr=await get(pu), prow=listOf(pr.json);
      if(pr.status!==200 || !prow){ await delay(800); pr=await get(pu); prow=listOf(pr.json); }
      if(pr.status!==200 || !prow){ failed.push('products'); break; }
      var oldest=null;
      prow.forEach(function(p){
        if(!p || p.id==null) return;
        var c=localDay(p.createdAt); if(c && (!oldest || c<oldest)) oldest=c;
        if(!p.approvedAt || String(p.approvedBy||'').trim().toLowerCase()!==me) return;
        var d=localDay(p.approvedAt), bn=(p.brand && p.brand.name) || '';
        mine.push({ id:p.id, name:p.name||'', bid:p.brand && p.brand.id, bname:bn, at:p.approvedAt });
        if(d && d>=AUTO_FROM) products[String(p.id)]=[d, bn, p.name||''];
      });
      if(prow.length<300 || (oldest && oldest<since)) break;
      pg++;
    }
    return { reviews:reviews, products:products, failed:failed, watch:watch, mine:mine, at:new Date().toISOString() };
  }

  /* ── 보관함: 아직 업무일지에 못 넘긴 검수기록·실행 결과 ── */
  function outboxLoad(){ try{ var o=JSON.parse(localStorage.getItem(OUTBOX_KEY)||'{}'); return (o && typeof o==='object') ? o : {}; }catch(e){ return {}; } }
  function outboxEdit(fn){
    var o=outboxLoad(); o.audit=o.audit||{}; o.reviews=o.reviews||[];
    fn(o); o.seq=(o.seq||0)+1;
    /* 오래 못 넘기더라도 이 브라우저 저장공간을 채우지 않게 — 최근 30일치, 승인 5000건까지만 */
    var ds=Object.keys(o.audit).sort(); if(ds.length>30) ds.slice(0,ds.length-30).forEach(function(d){ delete o.audit[d]; });
    if(o.reviews.length>5000) o.reviews=o.reviews.slice(-5000);
    try{ localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); return true; }catch(e){ return false; }
  }
  /* 같은 날짜 기록은 리뷰 ID 기준으로 합친다 — 처리됨(applied)은 되돌리지 않는다 */
  function mergeDay(a, b){
    if(!a) return b;
    var m={}, order=[];
    (a.items||[]).concat(b.items||[]).forEach(function(x){
      var k=String(x.id), p=m[k];
      if(!p) order.push(k);
      m[k] = (p && p.applied && !x.applied) ? p : x;
    });
    var out=Object.assign({}, a, b);
    out.items=order.map(function(k){ return m[k]; });
    out.executions=(a.executions||[]).concat(b.executions||[]);
    out.total=out.items.length;
    var s={}; out.items.forEach(function(x){ s[x.action]=(s[x.action]||0)+1; }); out.summary=s;
    return out;
  }
  function outboxAudit(){
    return outboxEdit(function(o){ scanDates().forEach(function(d){ o.audit[d]=mergeDay(o.audit[d], auditPayload(d)); }); });
  }
  /* 실행 결과 — 파일로 내려받던 처리 로그 대신 검수기록에 붙여 넘긴다 */
  function outboxRun(logs, jobs){
    var today=ymd(new Date());
    return outboxEdit(function(o){
      scanDates().forEach(function(d){ o.audit[d]=mergeDay(o.audit[d], auditPayload(d)); });
      logs.forEach(function(x){
        var r=jobs.filter(function(j){ return String(j.id)===String(x.id); })[0];
        var d=(r && r.date) || SCAN_DATE; if(!validDate(d)) d=today;
        var day=o.audit[d] || (o.audit[d]={ v:1, date:d, items:[], executions:[] });
        day.executions=(day.executions||[]).concat([{ id:x.id, action:x.action, at:x.at, ok:x.ok, status:x.status,
          told:x.told||null, conf:x.conf||null, sample:!!x.sample }]);
        /* 방금 승인한 것은 CMS 재조회 없이 바로 반영 — 날짜는 처리한 시각 기준 (자정 무렵 어긋남 방지) */
        if(x.ok && x.action==='approve') o.reviews.push([String(x.id), localDay(x.at)||today, (r&&r.brand)||'', (r&&(r.product_exact||r.product))||'', (r&&r.date)||'', 'c']);
      });
    });
  }
  function workPayload(){
    var ob=outboxLoad(), rv=[], pv=[], J=sentLoad();
    var arr=function(x){ return Array.isArray(x) ? x : [x]; };
    if(WORK){
      /* [리뷰ID, 승인한 날, 브랜드, 제품, 작성일, 출처(c 콘솔 · m CMS 직접)] */
      Object.keys(WORK.reviews).forEach(function(id){ var x=arr(WORK.reviews[id]);
        rv.push([id, x[0], x[1]||'', x[2]||'', x[3]||'', (J[id] && J[id].action==='approve') ? 'c' : 'm']); });
      Object.keys(WORK.products).forEach(function(id){ var x=arr(WORK.products[id]); pv.push([id, x[0], x[1]||'', x[2]||'']); });
    }
    (ob.reviews||[]).forEach(function(x){ if(x && validDate(x[1]) && x[1]>=AUTO_FROM) rv.push([String(x[0])].concat(x.slice(1))); });
    return { v:1, seq:ob.seq||0,
             work:{ v:1, from:AUTO_FROM, to:ymd(new Date()), reviews:rv, products:pv, partial:!!(WORK && WORK.failed.length) },
             audit:ob.audit||{}, pending:pendingList(), backlog:backlogList(), console:consoleState() };
  }
  function syncNonce(){
    try{ return Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)),function(x){ return (x<16?'0':'')+x.toString(16); }).join(''); }
    catch(e){ var s=''; while(s.length<32) s+=Math.floor(Math.random()*16).toString(16); return s; }
  }
  function syncButton(msg){
    syncStatus(msg+' <button id="csSyncBtn" style="margin-left:4px;background:#2c4a3c;color:#cfe;border:1px solid #3ddc97;border-radius:6px;padding:2px 8px;font:inherit;font-size:11px;font-weight:800;cursor:pointer">지금 반영</button>');
  }
  /* 업무일지 동기화 창을 열어 넘긴다.
     클릭 없이 열리면 팝업 차단에 걸릴 수 있다 — 그때는 버튼 한 번으로 연다.
     (주소창의 팝업 차단 아이콘에서 cms.unpa.me 를 "항상 허용"하면 이후 자동) */
  var SYNCING=false;
  function syncNow(){
    if(!ME){ syncStatus('<span style="color:#ff8f6b">⚠ CMS 계정을 확인하지 못해 업무일지 동기화를 건너뜀</span>'); return false; }
    if(SYNCING) return false;
    var nonce=syncNonce(), sx=(window.screenX||0)+Math.max(0,(window.outerWidth||1200)-460);
    var w=null;
    try{ w=window.open(SYNC_URL+'#n='+nonce, 'unpa-worklog-sync', 'popup,width=420,height=300,left='+sx+',top='+((window.screenY||0)+80)); }catch(e){ w=null; }
    if(!w){
      syncButton('📒 업무일지 반영 대기 <span style="color:#6b7f77">(팝업 차단 — 주소창 아이콘에서 항상 허용하면 자동)</span>');
      return false;
    }
    SYNCING=true;
    var payload=workPayload();
    syncStatus('📒 업무일지에 반영 중…');
    var timer;
    var finish=function(){ SYNCING=false; clearTimeout(timer); window.removeEventListener('message', onMsg); };
    var onMsg=function(ev){
      if(ev.origin!==WL_ORIGIN || ev.source!==w || !ev.data || ev.data.nonce!==nonce) return;
      if(ev.data.type==='unpa-sync-ready'){ w.postMessage({ type:'unpa-sync-data', nonce:nonce, payload:payload }, WL_ORIGIN); return; }
      if(ev.data.type!=='unpa-sync-done') return;
      finish();
      if(!ev.data.ok){ syncButton('<span style="color:#ff8f6b">⚠ 업무일지 반영 실패 — '+esc(String(ev.data.error||'').slice(0,80))+'</span>'); return; }
      if(ev.data.console) applyConsoleState(ev.data.console);
      if(ev.data.goal && ev.data.goal.target>0){ goalSave(Object.assign({ at:new Date().toISOString() }, ev.data.goal)); if(results.length) renderQueue(SCAN_DATE); }
      if(ev.data.verdicts && seedFromVerdicts(ev.data.verdicts)) matchPending();   /* 예전 판정으로 채운 건도 바로 짝지어 본다 */
      /* 보낸 뒤로 보관함에 새로 쌓인 게 없으면 비운다 (새로 쌓였으면 다음에 함께 다시 보낸다 — 합칠 때 중복은 걸러진다) */
      if((outboxLoad().seq||0)===payload.seq){ try{ localStorage.removeItem(OUTBOX_KEY); }catch(e){} }
      var t=ev.data.today||{}, hm=new Date().toTimeString().slice(0,5);
      syncStatus('<span style="color:#3ddc97">📒 업무일지 반영 '+hm+'</span> · 오늘 리뷰 <b>'+(t.r||0)+'</b> · 제품 <b>'+(t.p||0)+'</b>'
        +(ev.data.nChanges?' · 바뀐 날 '+ev.data.nChanges+'일':'')
        +(ev.data.auditDays?' · 검수기록 '+ev.data.auditDays+'일':'')
        +(ev.data.auditError?' <span style="color:#f5c451">(검수기록 저장 실패 — '+esc(String(ev.data.auditError).slice(0,60))+')</span>':'')
        +(WORK && WORK.failed.length?' <span style="color:#f5c451">(일부 날짜 조회 실패 — 다음에 채움)</span>':'')
        +(ev.data.cloud==='on' ? ' · <span style="color:#9fe3c4">☁ 다른 컴퓨터와 합침</span>'
          : ev.data.cloud==='off' ? ' · <span style="color:#6b7f77">☁ 업무일지 로그인 전 — 이 컴퓨터에만</span>'
          : ev.data.cloud ? ' · <span style="color:#f5c451">☁ 서버 합치기 실패 — 다음에 다시</span>' : '')
        +(LEARN_NOTE?' · '+LEARN_NOTE:'')
        +(function(){ var b=budget(); return b.known ? '<br><span style="color:#f5c451">'+esc(budgetLine(b))+'</span>' : ''; })());
    };
    window.addEventListener('message', onMsg);
    timer=setTimeout(function(){ finish(); syncButton('<span style="color:#ff8f6b">⚠ 업무일지 창 응답 없음</span>'); }, 45000);
    return true;
  }
  async function startWorkSync(){
    if(!ME) ME=await whoAmI();
    if(!ME){ syncStatus('<span style="color:#ff8f6b">⚠ CMS 계정을 확인하지 못해 업무일지 동기화를 건너뜀</span>'); return; }
    syncStatus('📒 업무일지 집계 중… (CMS 최근 '+WORK_DAYS+'일, 조회만)');
    WORK=await collectWork(ME, function(d,n){ if(!SYNCING) syncStatus('📒 업무일지 집계 중… '+d+' / '+n+'일'); });
    try{ await learnAndMatch(); }catch(e){}
    syncNow();
  }
  /* 대기 리뷰의 그 뒤 상태에서 배우고, 내가 새로 등록한 제품과 짝짓는다 */
  var ASSOC=[], LEARN_NOTE='';
  async function learnAndMatch(){
    if(!WORK || !ME) return;
    var lw=await learnFromWatch(WORK.watch, ME);
    var silent=matchPending();
    var n=lw.learned+silent;
    LEARN_NOTE = n ? '<span style="color:#9fe3c4">🧠 제품명 연결 '+n+'건 새로 배움</span>' : '';
  }
  /* 대기 목록 ↔ 내가 등록한 제품 짝짓기 (CMS 를 다시 부르지 않는다) */
  function matchPending(){
    if(!WORK) return 0;
    var o=pendingLoad(), list=Object.keys(o).map(function(k){ return o[k]; });
    var as=associate(list, WORK.mine||[]), silent=0;
    /* CMS 에서 이미 직접 수정요청을 보낸 건은 보낸 제품을 배우기만 한다 */
    as.filter(function(x){ return x.e.st==='sent-manual'; }).forEach(function(x){
      learnAlias(x.p.bid, x.e.p, x.p.id, x.p.name); pendingMark(x.e.id, 'learned', { pid:x.p.id, pname:x.p.name }); silent++; });
    var open=pendingIds();
    ASSOC=as.filter(function(x){ return x.e.st==='open' && (!open || open[x.e.id]); });
    renderAssoc();
    return silent;
  }
  /* 지금 CMS 에서 아직 검수 대기인 리뷰 (시작 화면에서 불러온 남은 일) */
  function pendingIds(){
    if(!BACKLOG) return null;
    var m={}; BACKLOG.forEach(function(b){ b.rows.forEach(function(x){ m[String(x.id)]=1; }); }); return m;
  }
  /* 업무일지 "아직 안 끝난 일" 목록 */
  /* CMS 에 지금 남은 검수 대기 (짝수일 최근 60일) — 업무일지 "아직 안 끝난 일"의 기준.
     콘솔을 연 뒤 처리한 것은 전송 기록으로 빼서 넘긴다. */
  function backlogList(){
    if(!BACKLOG) return null;
    var sent=sentLoad(), out=[];
    BACKLOG.forEach(function(b){ backlogTodo(b.rows, sent).forEach(function(x){
      out.push({ id:String(x.id), d:b.date, brand:x.brandName||'', product:x.productName||'', status:x.status||'', blocked:x.userBlocked===true });
    }); });
    return out;
  }
  /* 업무일지에 남아 있는 예전 판정으로 대기 목록을 채운다 — 새 콘솔로 스캔하기 전 건도
     "내가 그 브랜드·제품을 등록하면 자동 짝짓기"가 되도록 */
  function seedFromVerdicts(v){
    var o=pendingLoad(), n=0, now=new Date().toISOString();
    Object.keys(v||{}).forEach(function(k){
      var x=v[k]; if(!x || o[k] || x.applied || !MANUAL_KINDS[x.action]) return;
      var d=validDate(x.d)?x.d:null; if(!d) return;
      o[k]={ id:k, d:d, b:String(x.brand||''), p:String(x.product||''), bid:null, a:x.action,
             ex:x.action==='register_product' || x.action==='register_brand', why:String(x.reason||'').slice(0,90),
             since:new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10)).toISOString(), u:now, st:'open', seeded:true };
      n++;
    });
    if(n) pendingSave(o);
    return n;
  }
  function pendingList(){
    var o=pendingLoad(), open=pendingIds();
    return Object.keys(o).map(function(k){ return o[k]; })
      .filter(function(e){ return (e.st==='open' || e.st==='sent-manual') && (!open || open[e.id]); })
      .sort(function(a,b){ return a.d<b.d ? -1 : 1; })
      .map(function(e){ return { id:e.id, d:e.d, brand:e.b, product:e.p, action:e.a, why:e.why, st:e.st, since:e.since }; });
  }
  function assocJob(x){
    var r=results.filter(function(y){ return String(y.id)===String(x.e.id); })[0] || { id:x.e.id, user:'', reasons:[] };
    r.action='revise_product'; r.exec=true; r.approvable=false;
    r.brand=r.brand||x.e.b; r.product=r.product||x.e.p; r.date=r.date||x.e.d;
    r.product_exact=x.p.name; r.product_id=x.p.id;
    r.brand_match={ id:x.p.bid, name:x.p.bname };
    var why='방금 등록한 「'+x.p.name+'」와 연결';
    if((r.reasons||[]).indexOf(why)<0) (r.reasons=r.reasons||[]).push(why);
    return r;
  }
  function renderAssoc(){
    if(!ASSOC.length) return;
    if(results.length){
      /* 스캔한 뒤라면 해당 카드를 수정요청으로 바꿔 대기열에 올린다 */
      var hit=0; ASSOC.forEach(function(x){ if(results.some(function(y){ return String(y.id)===String(x.e.id) && !y.applied; })){ assocJob(x); hit++; } });
      if(hit) renderQueue(SCAN_DATE);
      return;
    }
    var el=document.getElementById('csAssoc'); if(!el) return;
    el.innerHTML='<div style="margin-top:10px;background:#132019;border:1px solid #3ddc97;border-radius:9px;padding:9px 11px">'
      +'<div style="font-weight:800;color:#9fe3c4">🆕 방금 등록한 제품과 이어진 리뷰 '+ASSOC.length+'건</div>'
      +ASSOC.slice(0,6).map(function(x){ return '<div style="font-size:11.5px;color:#9fb4ab;margin-top:3px">#'+esc(x.e.id)+' «'+esc(x.e.p)+'» → <span style="color:#3ddc97">「'+esc(x.p.name)+'」</span></div>'; }).join('')
      +(ASSOC.length>6?'<div style="font-size:11px;color:#6b7f77">… 외 '+(ASSOC.length-6)+'건</div>':'')
      +'<button id="csAssocGo" style="margin-top:8px;width:100%;background:#3ddc97;color:#04130c;border:0;border-radius:8px;padding:8px;font-weight:800;cursor:pointer">이 제품으로 수정요청 보내기 ('+ASSOC.length+')</button></div>';
    document.getElementById('csAssocGo').onclick=function(){
      var jobs=ASSOC.map(assocJob);
      runJobs(jobs).then(function(){ ASSOC=ASSOC.filter(function(x){ return !jobs.some(function(j){ return String(j.id)===String(x.e.id) && j.applied; }); }); });
    };
  }
  /* 합치기 규칙(worklog-core.js)을 업무일지 사이트에서 불러온다 — 다른 컴퓨터 경험을 합칠 때 쓴다 */
  function loadCore(){
    return new Promise(function(res){
      if(window.WorklogCore && window.WorklogCore.mergeConsole) return res(true);
      try{
        var sc=document.createElement('script');
        sc.src=WORKLOG_URL+'worklog-core.js?t='+Date.now();
        sc.onload=function(){ res(!!window.WorklogCore); }; sc.onerror=function(){ res(false); };
        (document.head||document.body).appendChild(sc);
      }catch(e){ res(false); }
    });
  }

  /* ── 썸네일 그리드 일괄 승인 ──────────────────────────
     "직접촬영"까지는 기계가 가려내지만, 그 사진이 제품과 맞는지는
     눈으로 봐야 한다. 한 화면에 깔아놓고 이상한 것만 체크를 풀어
     나머지를 한 번에 승인한다. */
  function openGrid(){
    planApprovals(); fixSamples();
    var all=results.filter(function(r){ return r.approvable && !r.applied && !r.deferred; });
    /* 고신뢰(표본 아님)는 사람이 보지 않는다 — 표본이 전부 통과하면 함께 승인된다 */
    var highs=all.filter(function(r){ return r.conf==='high' && !r.sample; });
    var pool=all.filter(function(r){ return !(r.conf==='high' && !r.sample); });
    if(!pool.length){ alert('검수 진행할 대상이 없습니다.'); return; }
    /* 발색 제품 → 확인 필요 → 표본 순. 주의가 필요한 것부터 본다 */
    var rank=function(r){ return r.swatch ? 0 : r.sample ? 2 : 1; };
    pool.sort(function(a,b){ return rank(a)-rank(b); });

    var st={}, node={};
    /* 기본은 검수완료. 전에 건너뛰기·발색샷으로 바꾼 카드는 그대로 둔다 —
       그리드를 닫았다 다시 열면 건너뛴 카드가 검수완료로 돌아가 승인되던 문제 */
    pool.forEach(function(r){ st[r.id]=r._gridSt||'approve'; });

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
    grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));'
      +'gap:12px;align-content:start';
    scroll.appendChild(grid);
    ov.appendChild(bar); ov.appendChild(scroll);
    document.body.appendChild(ov);
    box.style.display='none';
    var closeGrid=function(){ ov.remove(); box.style.display=''; };

    function tally(){
      var a=0,w=0,s0=0;
      pool.forEach(function(r){ var v=st[r.id]; if(v==='approve')a++; else if(v==='swatch')w++; else s0++; });
      return {a:a,w:w,skip:s0};
    }
    function syncBar(){
      var t=tally();
      var g=document.getElementById('gGo');
      if(g){
        g.textContent='실행 — 검수완료 '+t.a+' · 발색샷 '+t.w;
        g.disabled=(t.a+t.w===0);
        g.style.opacity=(t.a+t.w===0)?'.45':'1';
      }
      var c=document.getElementById('gCnt');
      if(c) c.textContent='건너뜀 '+t.skip;
    }
    function paint(r){
      var el=node[r.id]; if(!el) return;
      var v=st[r.id];
      r._gridSt=v;
      var col = v==='approve' ? '#3ddc97' : v==='swatch' ? '#f0a35e' : '#22392e';
      el.style.borderColor=col;
      el.style.opacity = v==='skip' ? '.4' : '1';
      var badge=el.querySelector('.gchk');
      if(badge){
        badge.style.display = v==='skip' ? 'none' : 'flex';
        badge.style.background = col;
        badge.textContent = v==='swatch' ? '💄' : '✓';
      }
      var sw=el.querySelector('.gsw');
      if(sw) sw.style.background = v==='swatch' ? '#f0a35e' : 'rgba(0,0,0,.7)';
    }

    var BTN='background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:8px 13px;font:inherit;cursor:pointer';
    var nSample=pool.filter(function(r){ return r.sample; }).length;
    bar.innerHTML='<b style="color:#3ddc97;font-size:14px">👀 사진 확인 후 검수</b>'
      +(highs.length?'<span style="background:#1b3329;border:1px solid #3ddc97;border-radius:20px;padding:2px 10px;color:#9fe3c4">⚡ 고신뢰 '+highs.length
        +'건은 🎯표본 '+nSample+'건이 모두 통과하면 함께 승인</span>':'')
      +'<span style="color:#9fb4ab">카드=<b>건너뛰기</b> 토글 · <b style="color:#f0a35e">💄</b>=발색샷 요청 · <b>🔍</b>=사진 크게 · <b>↗</b>=CMS 상세</span>'
      +'<span id="gCnt" style="color:#6b7f77">건너뜀 0</span>'
      +'<span style="flex:1"></span>'
      +'<button id="gAll" style="'+BTN+'">전체 검수완료</button>'
      +'<button id="gNone" style="'+BTN+'">전체 건너뛰기</button>'
      +'<button id="gGo" style="background:#3ddc97;color:#04130c;border:0;border-radius:8px;padding:8px 17px;font:inherit;font-weight:800;cursor:pointer">실행</button>'
      +'<button id="gX" style="'+BTN+'">닫기</button>';

    pool.forEach(function(r){
      var src=(r.attachments&&r.attachments[0])||'';
      var n=(r.attachments||[]).length;
      var el=document.createElement('div');
      el.style.cssText='cursor:pointer;border:2px solid #3ddc97;border-radius:10px;overflow:hidden;background:#111d18';
      el.innerHTML='<div style="position:relative;aspect-ratio:1/1;background:#0a1310">'
        +(src?'<img src="'+esc(src)+'" loading="lazy" style="width:100%;height:100%;object-fit:cover">'
             :'<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#4d6158;font-size:11px">사진 없음</div>')
        +(n>1?'<span style="position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.7);border-radius:11px;padding:1px 7px;font-size:11px">+'+(n-1)+'</span>':'')
        +'<span class="gchk" style="position:absolute;left:6px;top:6px;background:#3ddc97;color:#04130c;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px">✓</span>'
        +'<span class="gsw" title="발색샷 요청" style="position:absolute;right:6px;top:6px;background:rgba(0,0,0,.7);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px">💄</span>'
        +(n?'<span class="gzoom" title="사진 크게" style="position:absolute;right:36px;top:6px;background:rgba(0,0,0,.7);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px">🔍</span>':'')
        +'<span class="gopen" title="CMS 상세 열기" style="position:absolute;right:66px;top:6px;background:rgba(0,0,0,.7);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px">↗</span>'
        +'</div>'
        +'<div style="padding:7px 8px">'
        +'<div style="font-size:11px;color:#9fb4ab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.brand||'')+'</div>'
        +'<div style="font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.product||'')+'</div>'
        +(r.swatch?'<div style="font-size:10px;color:#f0a35e;margin-top:2px">💄 발색 제품 — 발색샷 확인</div>':'')
        +(r.photo&&r.photo.v==='mixed'?'<div style="font-size:10px;color:#f5c451;margin-top:2px">⚠ '+esc(r.photo.label)+'</div>':'')
        +(r.warn?'<div style="font-size:10px;color:#f5c451;margin-top:2px">⚠ '+esc(r.warn)+'</div>':'')
        +(r.reviewStatus==='UPDATED'?'<div style="font-size:10px;color:#f5c451;margin-top:2px;font-weight:800">✏️ 유저 수정완료 건</div>':'')
        +(r.sample?'<div style="font-size:10px;color:#8fd8ff;margin-top:2px;font-weight:800">🎯 표본 — 문제 있으면 건너뛰기</div>'
          :(r.conf==='check'&&r.confWhy&&r.confWhy.length?'<div style="font-size:10px;color:#9fb4ab;margin-top:2px">👀 '+esc(r.confWhy[0])+'</div>':''))
        +'</div>';
      el.onclick=function(ev){
        var t=ev.target;
        if(t && t.classList.contains('gzoom')){ ev.stopPropagation(); lightbox(r); return; }
        if(t && t.classList.contains('gopen')){ ev.stopPropagation(); window.open(reviewUrl(r.id),'_blank','noopener'); return; }
        if(t && t.classList.contains('gsw')){
          ev.stopPropagation();
          st[r.id] = (st[r.id]==='swatch') ? 'approve' : 'swatch';
        } else {
          st[r.id] = (st[r.id]==='skip') ? 'approve' : 'skip';
        }
        paint(r); syncBar();
      };
      node[r.id]=el; grid.appendChild(el);
    });

    function lightbox(r){
      var lb=document.createElement('div');
      lb.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(4,10,8,.94);overflow:auto;padding:24px;'
        +'display:flex;flex-wrap:wrap;gap:14px;align-content:center;justify-content:center';
      lb.innerHTML='<div style="width:100%;text-align:center;color:#9fb4ab;font:13px -apple-system,sans-serif">'
        +'<a href="'+reviewUrl(r.id)+'" target="_blank" rel="noopener" style="color:#8fd8ff;font-weight:800;text-decoration:none">#'+r.id+' ↗</a> '
        +esc(r.brand||'')+' / '+esc(r.product||'')
        +(r.swatch?' <span style="color:#f0a35e">· 발색 제품</span>':'')
        +' <span style="color:#6b7f77">— 아무 곳이나 클릭하면 닫힙니다</span></div>'
        +(r.attachments||[]).map(function(u){
          return '<img src="'+esc(u)+'" style="max-width:44%;max-height:74vh;object-fit:contain;border-radius:10px">'; }).join('');
      lb.onclick=function(){ lb.remove(); };
      document.body.appendChild(lb);
    }

    document.getElementById('gAll').onclick =function(){ pool.forEach(function(r){ st[r.id]='approve'; paint(r); }); syncBar(); };
    document.getElementById('gNone').onclick=function(){ pool.forEach(function(r){ st[r.id]='skip';    paint(r); }); syncBar(); };
    document.getElementById('gX').onclick   =function(){ closeGrid(); };
    document.getElementById('gGo').onclick  =function(){
      var g=gridJobs(pool, st, highs);
      var h=histLoad(); h.gate.push({ d:SCAN_DATE, t:new Date().toISOString(), samples:g.samples, failed:g.failed, highs:highs.length });
      histSave(h);
      if(highs.length && !g.gateOk){
        /* 표본에서 문제가 나왔다 — 고신뢰 판정을 믿지 않고 전부 사람이 보게 돌린다 */
        highs.forEach(function(r){ r.conf='check'; r.sample=false; r.confWhy=['표본 탈락으로 전체 확인 전환']; });
        alert('🎯 표본 '+g.samples+'건 중 '+g.failed+'건을 건너뛰셨습니다.\n\n'
          +'오늘은 고신뢰 자동 승인을 보류합니다. 지금 고른 건만 처리하고,\n'
          +'남은 고신뢰 '+highs.length+'건은 그리드를 다시 열어 직접 확인해 주세요.');
      }
      if(!g.jobs.length){ alert('선택된 건이 없습니다.'); return; }
      closeGrid();
      runJobs(g.jobs);
    };
    pool.forEach(paint); syncBar();
  }

  /* ── 시작 ── */
  var qs=new URLSearchParams(location.search); var sd=qs.get('startDate')||ymd(new Date());
  box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">템플릿 불러오는 중…</div>');
  oF.call(window,TPL_URL+'?t='+Date.now()).then(function(r){return r.json();})
    .then(function(d){ (d.templates||[]).forEach(function(t){tplMap[t.key]=t;}); }, function(){})
    .then(function(){ loadCore(); return renderStart(sd); })
    /* 남은 일 목록을 먼저 띄우고, 업무일지 집계는 그 뒤에 뒤에서 돈다 */
    .then(function(){ return startWorkSync(); })
    .catch(function(e){ syncStatus('<span style="color:#ff8f6b">⚠ 업무일지 동기화 오류 — '+esc(e&&e.message||e)+'</span>'); });
})();
