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
 *            건별 로그 · 에러 시 즉시 중단 · 액션별 상한 · 처리 로그 저장.
 *            이미 처리된 건은 다시 대상이 되지 않는다.
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
  /* CMS 리뷰 상세 — 목록 페이지네이션을 넘기지 않고 바로 열기 위한 주소 */
  function reviewUrl(id){ return location.origin+'/review/detail/'+id; }
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
  /* 취급 품목이면 null, 아니면 걸린 키워드를 돌려준다.
     허용 목록이 먼저다 — "콜라겐 젤리"처럼 차단어와 겹쳐 보이는 이너뷰티를 살린다. */
  function notBeauty(name){
    var n=String(name||'');
    for(var i=0;i<BEAUTY_OK.length;i++) if(n.indexOf(BEAUTY_OK[i])>=0) return null;
    /* 물티슈는 화장·클렌징용만 취급한다 */
    if(n.indexOf('물티슈')>=0)
      return /클렌징|메이크업|화장|리무버|페이셜|아이|립|선케어/.test(n) ? null : '뷰티용 아닌 물티슈';
    for(var j=0;j<NOT_BEAUTY.length;j++) if(n.indexOf(NOT_BEAUTY[j])>=0) return NOT_BEAUTY[j];
    return null;
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
    return parts.join('\n');
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
    var rep=t.match(/(.)\1{2,}/g);
    if(rep){
      /* 반복 덩어리를 걷어내고도 실질 내용이 남으면 정상 리뷰다 ("ㅋㅋㅋ 진짜 좋아요") */
      var left=(t.replace(/(.)\1{2,}/g,'').match(/[가-힣a-zA-Z0-9]/g)||[]).length;
      if(left<6) return '같은 글자 반복 («'+rep[0].slice(0,6)+'»)';
    }
    if(syll.length>=8){
      var u={}; syll.forEach(function(c){ u[c]=1; });
      if(Object.keys(u).length/syll.length<=0.3) return '동일 음절 반복';
    }
    if(syll.length===0 && alnum.length<=2 && t.length<=6) return '내용 없음 («'+t.slice(0,8)+'»)';
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
                   '아이라이너','마스카라','네일','매니큐어','틴트밤','립틴트','립스테인'];
  /* 립밤·오일처럼 무색이 많은 품목은 색상명이 함께 있을 때만 색조로 본다 */
  var COLOR_KW  = ['핑크','레드','코랄','베이지','브라운','오렌지','퍼플','누드','로즈','피치',
                   '버건디','플럼','살구','자몽','체리','와인','모브','글리터','펄','실버','골드',
                   '레드빛','토프','카키','마젠타','라벤더','apricot','pink','red','coral'];
  /* 색조 키워드가 걸려도 발색과 무관한 품목은 뺀다 (네일 "크림"·"에센스" 등) */
  var SWATCH_EXCLUDE = /네일\s*(크림|에센스|오일|영양|강화|리무버|케어|트리트먼트)|핸드\s*앤\s*네일|핸드앤네일/;
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
    return why.length ? why : null;
  }

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
        PROD_EP=eps[i];
        if(!SCHEMA.productKeys) SCHEMA.productKeys=Object.keys(r.json).sort();
        if(!SCHEMA.productEndpoint) SCHEMA.productEndpoint=eps[i];
        var opts=optionNames(r.json);
        prodCache[pid]=opts; return opts;
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
  function tokensOf(name){
    return String(name||'')
      .replace(/\[[^\]]*\]/g,' ').replace(/\([^)]*\)/g,' ')
      .split(/[\s·/,+&]+/)
      .map(function(t){ return t.replace(/[^0-9a-zA-Z가-힣]/g,'').toLowerCase(); })
      .filter(Boolean);
  }
  function tokenCover(a, b){          /* a 의 단어가 b 에 얼마나 들어 있나 (0~1) */
    if(!a.length) return 0;
    var set={}; b.forEach(function(t){ set[t]=1; });
    var hit=0; a.forEach(function(t){ if(set[t]) hit++; });
    return hit/a.length;
  }

  /* 유저 입력에서 CMS 제품명을 뺀 나머지를 돌려준다 (옵션 후보) */
  function residueOf(userNorm, cmsNorm){
    if(!cmsNorm || cmsNorm.length>=userNorm.length) return null;
    if(userNorm.indexOf(cmsNorm)!==0 && userNorm.lastIndexOf(cmsNorm)!==userNorm.length-cmsNorm.length
       && userNorm.indexOf(cmsNorm)<0) return null;
    return userNorm.split(cmsNorm).join('');
  }

  async function findProduct(brandId, productName){
    var toks=tokenize(productName); var seen={}, cand=[];
    for(var i=0;i<toks.length;i++){
      var r=await get(API+'/admin/products?approved=true&brandApproved=true&page=1&pageSize=20&brandId='+brandId+'&q='+encodeURIComponent(toks[i]));
      var rows=listOf(r.json)||[];
      rows.forEach(function(p){ if(p&&p.id!=null&&!seen[p.id]){seen[p.id]=1;cand.push({id:p.id,name:p.name||p.productName||''});} });
      await delay(80);
    }
    var raw=productName.replace(/\[[^\]]*\]/g,'');
    var target=norm(raw);

    /* 1) 상품명이 그대로 일치 */
    var exact=cand.filter(function(p){ return norm(p.name)===target; });
    if(exact.length===1) return { pick:exact[0], confident:true,  why:'상품명 정확히 일치', candidates:cand };
    if(exact.length>1)   return { pick:null,     confident:false, why:'동일 상품명 '+exact.length+'건 — 사람이 선택', candidates:cand };

    /* 2) 유저가 단어를 빠뜨린 경우 — CMS 이름이 더 완전하다.
          유저의 단어가 전부 CMS 이름에 있고, CMS 이름도 충분히 덮이면 같은 제품으로 본다.
          ("쿠션" 하나로 "에센셜 스킨 누더 쿠션"에 붙는 것은 덮는 비율이 낮아 걸러진다) */
    var uT=tokensOf(raw);
    var subset=cand.map(function(p){
      var cT=tokensOf(p.name);
      return { p:p, cT:cT, uInC:tokenCover(uT,cT), cInU:tokenCover(cT,uT) };
    }).filter(function(x){
      return uT.length>=2 && x.uInC>=0.999 && x.cT.length>=uT.length && x.cInU>=0.6;
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

    /* 3) 제품명 + 옵션(호수·색상) 조합인지 확인.
          남는 부분이 실제 옵션이면 같은 제품으로 본다. */
    var prefixed=cand.filter(function(p){ return residueOf(target, norm(p.name)); })
                     .sort(function(a,b){ return norm(b.name).length-norm(a.name).length; });  /* 긴 이름 우선 */
    for(var k=0;k<Math.min(prefixed.length,3);k++){
      var p=prefixed[k];
      var res=residueOf(target, norm(p.name));
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
      var f=prefixed[0], fr=residueOf(target, norm(f.name));
      var fo=prodCache[f.id];
      /* 왜 확정 못 했는지 구분해서 보여 준다 — 조회 실패와 "옵션에 없음"은 다른 문제다 */
      var note = (fo===null)          ? '옵션 조회 실패'
               : (!fo || !fo.length)  ? '옵션 목록 비어 있음'
               : '옵션 '+fo.length+'개와 불일치 ['+fo.slice(0,8).join(' / ')+(fo.length>8?' …':'')+']';
      return { pick:f, confident:false, options:(fo||null), residue:fr,
               why:'「'+f.name+'」 + 남은 «'+fr+'» · '+note+' → 수정요청인지 상품등록인지 사람이 판단',
               candidates:cand };
    }

    /* 4) 길이가 비슷한 포함 관계 */
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
              product_options:null, residue:null, swatch:null, warn:null,
              attachments:atts.slice(0,6),
              approvable:false };   /* 그리드에서 승인/발색샷요청을 고를 수 있는 건인지 */

    /* 사진 포렌식 (첨부 최대 4장) */
    var cls=[]; for(var i=0;i<Math.min(atts.length,4);i++){ var d=await imgDims(atts[i]); cls.push(classifyImg(d.w,d.h)); }
    out.photo=photoVerdict(cls); out.photoCls=cls;

    out.text = content.slice(0,120);   /* 무엇을 읽고 판정했는지 남긴다 */

    /* ── 규칙 3: 무의미한 언어만 있으면 검수 대상이 아니다 → 미노출 ──
       단 "본문이 비어 있음"은 무의미한 언어가 아니다. 간편 리뷰일 수도 있고
       엑박 처리가 먼저일 수도 있어, 미노출로 바로 보내지 않는다. */
    var gb=gibberish(content);
    if(gb){ out.action='hide'; out.exec=true; out.reasons.push('무의미한 본문 — '+gb); return out; }
    if(isSpam(content)){ out.action='hide'; out.exec=true; out.reasons.push('본문 도배'); return out; }

    /* 취급하지 않는 품목은 검수 대상이 아니다 — 사람이 보고 미노출 여부를 정한다 */
    var nb2=notBeauty(item.productName+' '+item.brandName);
    if(nb2){ out.action='hold'; out.reasons.push('취급 품목 아님('+nb2+') → 미노출 검토'); return out; }

    /* ── 규칙 1·2: 브랜드 안에 매칭된 상품이 있고 좌상단 이미지가 떠야 검수 대상 ── */
    if(exWhy){
      out.reasons.push('엑박 — '+exWhy.join(' · '));
      var b=await findBrand(item.brandName);
      if(!b.approvedBrand){
        /* 6번: 브랜드부터 새로 등록해야 함 */
        out.action='register_brand';
        out.reasons.push(b.anyExact?'브랜드가 미검수 상태':'브랜드가 CMS에 없음');
        return out;
      }
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
      if(!nb.approvedBrand && !nb.anyExact) out.warn='브랜드 조회 안 됨';
    } catch(e){}

    /* 본문이 정말 비어 있으면 자동 승인하지 않고 사람에게 보낸다 */
    if(!content){ out.action='hold'; out.reasons.push('본문 없음 → 확인'); return out; }

    /* ── 규칙 4: 발색 있는 제품이면 발색샷 유무를 사람이 보고 고른다 ── */
    out.swatch = isSwatch(item.productName);

    out.action='approve'; out.approvable=true;
    if(out.photo.v==='mixed')       out.reasons.push('사진 '+out.photo.label+' → 눈으로 확인');
    else if(out.photo.v==='camera') out.reasons.push('직접촬영 · 매칭 정상');
    else if(out.photo.v==='none')   out.reasons.push('첨부 사진 없음 → 확인');
    else                            out.reasons.push('사진 판별 애매 → 확인');
    if(out.swatch) out.reasons.push('발색 제품('+out.swatch+') — 발색샷 확인');
    if(out.warn)   out.reasons.push(out.warn);
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
    var order=['revise_product','hide','register_product','register_brand','hold','revise_swatch','approve'];

    var html='<div style="margin-top:8px;color:#9fb4ab">'+esc(sd)+' · 총 <b style="color:#fff">'+results.length+'</b>건 판정 완료</div>';
    html+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
    order.forEach(function(k){ if(!groups[k]||!groups[k].length) return;
      html+='<span style="font-size:11px;background:#132019;border:1px solid #2c4a3c;border-radius:20px;padding:3px 9px;color:'+ACT[k].c+'">'+ACT[k].t+' <b>'+groups[k].length+'</b></span>'; });
    html+='</div>';

    order.forEach(function(k){ var g=groups[k]; if(!g||!g.length) return;
      var exec = (k==='revise_product'||k==='hide');
      html+='<div style="margin-top:12px;border-top:1px solid #22392e;padding-top:9px">'
        +'<div style="font-weight:800;color:'+ACT[k].c+'">'+ACT[k].t+' · '+g.length+'건'
        +' <span style="font-size:10.5px;color:#6b7f77">('
        + (exec ? '체크 후 실행' : (k==='approve'||k==='revise_swatch') ? '👀 그리드에서 처리' : '사람이 직접')
        +')</span></div>';
      g.forEach(function(r,idx){
        var gid=k+'_'+idx;
        html+='<div style="margin-top:7px;background:#111d18;border:1px solid #22392e;border-radius:8px;padding:8px 10px">'
          +(exec?'<label style="display:flex;gap:7px;align-items:flex-start;cursor:pointer"><input type="checkbox" class="csChk" data-id="'+r.id+'" '+(r.applied?'disabled':'checked')+' style="margin-top:3px">':'<div>')
          +'<div><a class="csLink" href="'+reviewUrl(r.id)+'" target="_blank" rel="noopener" '
          +'title="CMS 리뷰 상세를 새 탭에서 열기" '
          +'style="color:#8fd8ff;font-weight:800;text-decoration:none;border-bottom:1px dotted rgba(143,216,255,.5)">#'+r.id+' ↗</a> '
          +(r.applied?'<span style="color:#3ddc97;font-weight:800">✓ 처리됨</span> ':'')
          +'<span style="color:#9fb4ab">'+esc(r.brand||'')+' / '+esc(r.product||'')+'</span>'
          +'<div style="font-size:11px;color:#7f948b;margin-top:2px">'+esc(r.reasons.join(' · '))
          + (r.photo&&r.photo.v!=='none'?' · 사진:'+esc(r.photo.label):'')
          + (r.product_exact?' · <span style="color:#3ddc97">→ '+esc(r.product_exact)+'</span>':'')+'</div>'
          + (!exec && r.product_exact && !r.applied
              ? '<button class="csFix" data-id="'+r.id+'" '
                +'style="margin-top:7px;width:100%;background:#1b3329;color:#9fe3c4;border:1px solid #3ddc97;'
                +'border-radius:7px;padding:7px 9px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer">'
                +'「'+esc(r.product_exact)+'」로 수정요청</button>'
              : '')
          +'</div>'+(exec?'</label>':'</div>')
          +'</div>';
      });
      html+='</div>';
    });

    var nExec = results.filter(function(r){ return !r.applied && (r.action==='revise_product'||r.action==='hide'); }).length;
    var nGrid = results.filter(function(r){ return r.approvable && !r.applied; }).length;

    if(nGrid) html+='<button id="csGridBtn" style="width:100%;margin-top:14px;background:#8fb8ff;color:#06121f;'
      +'border:0;border-radius:9px;padding:11px;font:inherit;font-weight:800;cursor:pointer">'
      +'👀 사진 보고 검수 진행 ('+nGrid+'건)</button>';

    html+='<div style="display:flex;gap:7px;margin-top:9px;flex-wrap:wrap">'
      +'<button id="csRescan" style="flex:1;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">다시</button>'
      +'<button id="csDl" style="flex:1.3;background:#132019;color:#9fb4ab;border:1px solid #2c4a3c;border-radius:8px;padding:9px;font-weight:700;cursor:pointer">검수기록 JSON</button>'
      +'<button id="csRun" style="flex:2;background:'+(nExec?'#3ddc97':'#22392e')+';color:'+(nExec?'#04130c':'#6b7f77')+';border:0;border-radius:8px;padding:9px;font-weight:800;cursor:'+(nExec?'pointer':'default')+'">체크한 것 실행 ('+nExec+')</button>'
      +'</div>'
      +'<div id="csLog" style="margin-top:10px;font-size:11.5px;color:#9fb4ab"></div>'
      +'<div style="margin-top:7px;font-size:10.5px;color:#6b7f77">상한 — 미노출 '+CAP.hide+' · 제품재선택 '+CAP.revise_product+' · 발색샷 '+CAP.revise_swatch+' · 검수완료 '+CAP.approve+'. 에러 시 즉시 중단.</div>';

    box.innerHTML=head(html);
    /* 링크는 label 안에 있어 클릭이 체크박스까지 토글한다 — 막는다 */
    [].slice.call(box.querySelectorAll('.csLink')).forEach(function(a){
      a.onclick=function(ev){ ev.stopPropagation(); };
    });
    /* 확인 목록에서 한 번에 수정요청 — 확인창은 runJobs 가 띄운다 */
    [].slice.call(box.querySelectorAll('.csFix')).forEach(function(b){
      b.onclick=function(ev){
        ev.stopPropagation(); ev.preventDefault();
        var r=results.filter(function(x){ return String(x.id)===String(b.dataset.id); })[0];
        if(!r || !r.product_exact) return;
        r.action='revise_product';
        runJobs([r]);
      };
    });
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
  var CAP={ hide:30, revise_product:60, revise_swatch:120, approve:300 };

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
    runJobs(results.filter(function(r){ return ids[r.id] && (r.action==='revise_product'||r.action==='hide'); }));
  }

  /* ── 업무일지 연동 ────────────────────────────────────
     검수 기록 탭은 verdict / reason / applied 를 읽는데
     콘솔 내부는 action / reasons 를 쓴다. 여기서 맞춰 내보낸다. */
  /* 업무일지 검수 기록 탭 어휘로 대응시킨다 (탭은 revise_color 를 "발색샷 요청" 컬럼으로 쓴다) */
  var VMAP={ approve:'approve', hide:'hide',
             revise_swatch:'revise_color', revise_product:'revise_product',
             register_product:'register', register_brand:'register', hold:'hold' };
  function auditPayload(){
    var summary={}; results.forEach(function(r){ summary[r.action]=(summary[r.action]||0)+1; });
    return {
      v:1, date:SCAN_DATE, at:new Date().toISOString(), total:results.length, summary:summary,
      schema: SCHEMA,          /* 상세 응답 필드 — 판정이 어긋나면 여기부터 본다 */
      items: results.map(function(r){
        return { id:r.id, brand:r.brand, product:r.product, user:r.user,
                 verdict: VMAP[r.action]||'hold', action:r.action,
                 reason: r.reasons.join(' · '), reasons:r.reasons,
                 applied: !!r.applied, exbak:!!r.exbak, swatch:r.swatch||null, warn:r.warn||null,
                 text: r.text||'',
                 photo: r.photo?r.photo.label:'', photoCls:r.photoCls||[],
                 product_exact:r.product_exact, product_option:r.product_option||null,
                 product_options:r.product_options||null, residue:r.residue||null,
                 attachments:r.attachments||[] };
      })
    };
  }

  function offerWorklog(){
    var done=results.filter(function(r){ return r.applied; });
    if(!done.length) return;
    var n=function(a){ return done.filter(function(r){return r.action===a;}).length; };
    var payload={ d:SCAN_DATE, r:done.length, p:0,
                  note:'콘솔 처리 · 검수완료 '+n('approve')+' · 제품재선택 '+n('revise_product')
                       +' · 발색샷 '+n('revise_swatch')+' · 미노출 '+n('hide') };
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
    var pool=results.filter(function(r){ return r.approvable && !r.applied; });
    if(!pool.length){ alert('검수 진행할 대상이 없습니다.'); return; }
    /* 발색 제품을 앞으로 — 발색샷 유무는 주의해서 봐야 하므로 */
    pool.sort(function(a,b){ return (b.swatch?1:0)-(a.swatch?1:0); });

    var st={}, node={};
    pool.forEach(function(r){ st[r.id]='approve'; });   /* 기본은 검수완료 */

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
    bar.innerHTML='<b style="color:#3ddc97;font-size:14px">👀 사진 확인 후 검수</b>'
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
      var jobs=[];
      pool.forEach(function(r){
        var v=st[r.id];
        if(v==='approve'){ r.action='approve';       jobs.push(r); }
        else if(v==='swatch'){ r.action='revise_swatch'; jobs.push(r); }
      });
      if(!jobs.length){ alert('선택된 건이 없습니다.'); return; }
      closeGrid();
      runJobs(jobs);
    };
    pool.forEach(paint); syncBar();
  }

  /* ── 시작 ── */
  var qs=new URLSearchParams(location.search); var sd=qs.get('startDate')||new Date().toISOString().slice(0,10);
  box.innerHTML=head('<div style="margin-top:9px;color:#9fb4ab">템플릿 불러오는 중…</div>');
  oF.call(window,TPL_URL+'?t='+Date.now()).then(function(r){return r.json();}).then(function(d){
    (d.templates||[]).forEach(function(t){tplMap[t.key]=t;}); renderStart(sd);
  }).catch(function(){ renderStart(sd); });
})();
