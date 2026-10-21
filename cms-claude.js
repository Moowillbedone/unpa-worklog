/* Claude 가 CMS 탭에서 리뷰 승인·제품 등록을 할 때 쓰는 도구 — 월 목표 가드가 들어 있다.
   CMS(cms.unpa.me) 탭에 <script> 로 넣어 쓴다. window.UnpaGuard / UnpaOps / UnpaForm 을 만든다.

   ── 월 목표 가드 ──
   업무일지 수입 = 리뷰 검수완료 500원 + 제품 등록 600원 (업무일지·검수 콘솔과 같은 단가). 이번 달 수입은 목표를 절대 넘지 않는다.
   기준값: 업무일지 동기화 뒤 검수 콘솔이 이 CMS 브라우저 localStorage 'unpa-console-goal-v2' 에 남긴
           {month, target, won, at, countedAt, partial}. won 은 countedAt(CMS 집계를 시작한 시각)까지의 수입이다.
   countedAt 뒤에 한 일은 따로 더한다: Claude 원장 'unpa-claude-ledger-v1'(이 도구) + 검수 콘솔 전송 기록 'unpa-console-sent-v1'의 승인.
   다음 한 건이 목표를 넘기게 되면(이번 달 + 이번 건 > 목표) 실행하지 않고 그 자리에서 멈춘다. 목표에 딱 맞게 닿는 건 허용.
   한 번 멈추면 그 금액이 그달 최종 수입이다 — 더 싼 일(600원 제품은 안 되지만 500원 승인은 되는 경우 등)도 이어서 하지 않는다.
   이 '정지'는 같은 달·같은 목표 금액인 동안 유지되고, 업무일지에서 목표를 올리면(또는 다음 달) 풀린다.
   아무것도 하지 않는 경우: 목표를 모름 · 이번 달 것이 아님 · 집계 시각(countedAt)이 없거나 1시간 넘음 · 이번 달 집계 일부 실패(partial).
   애매하면 센다: 확인을 누른 뒤 결과가 안 보여도 원장에서 지우지 않는다 (늦게 멈추는 것보다 일찍 멈추는 쪽).
   수정요청·미노출·브랜드 등록·기존 제품 편집은 수입에 들어가지 않으므로 막지 않는다. */
(function(root){
  var RATE={ r:500, p:600 }, VERSION=11, HALT_V=7, OLD_DAYS=70;
  /* 목표 스냅샷은 v2 키에서 읽는다 — v1 키에는 새 콘솔이 '일부 실패'로 막아 둔 값만 남아, 예전 버전 가드(시각 기준)가 열린 탭은 아무것도 하지 않는다 */
  var GOAL_KEY='unpa-console-goal-v6', LEDGER_KEY='unpa-claude-ledger-v1', SENT_KEY='unpa-console-sent-v1', OUTBOX_KEY='unpa-console-outbox-v1';
  var MAX_AGE=60*60e3, MARGIN=5*60e3, KEEP=45*86400e3;
  var NAME={ r:'리뷰 승인', p:'제품 등록' };
  var store=function(){ return root.localStorage; };
  function nowMs(){ return root.__unpaNow ? root.__unpaNow() : Date.now(); }
  function kstMonth(ms){ return new Date(ms+9*3600e3).toISOString().slice(0,7); }
  function load(k){ try{ return JSON.parse(store().getItem(k)||'null'); }catch(e){ return null; } }
  function save(k,v){ store().setItem(k, JSON.stringify(v)); }
  function won(n){ return '₩'+Math.round(n||0).toLocaleString('ko-KR'); }
  /* 원장은 한 건 = 한 키('unpa-claude-ledger-v1|r:123') — 여러 탭이 같은 순간에 써도 서로의 기록을 덮지 않게.
     예전 형식(한 키에 전부)도 그대로 읽는다. 정지 표시는 '…|!halt' */
  var IK=LEDGER_KEY+'|';
  function keysWith(prefix){ var st=store(), out=[]; for(var i=0;i<st.length;i++){ var k=st.key(i); if(k && k.indexOf(prefix)===0) out.push(k); } return out; }
  function ledger(){
    var l=load(LEDGER_KEY), items={}, halt=(l && l.halt) || null;
    if(l && l.items && typeof l.items==='object') Object.keys(l.items).forEach(function(k){ items[k]=l.items[k]; });
    keysWith(IK).forEach(function(sk){ var x=load(sk), k=sk.slice(IK.length); if(!x) return;
      if(k==='!halt'){ if(!halt || (x.t||0)>(halt.t||0)) halt=x; } else items[k]=x; });
    return { v:2, items:items, halt:halt };
  }
  function putItem(k, x){ save(IK+k, x); }
  function delItem(k){ try{ store().removeItem(IK+k); }catch(e){}
    var l=load(LEDGER_KEY); if(l && l.items && l.items[k]){ delete l.items[k]; save(LEDGER_KEY, l); } }
  function hm(ms){ return new Date(ms+9*3600e3).toISOString().slice(5,16).replace('T',' '); }

  /* 기준 시각(base) 뒤에 한 일인가 — base 는 집계 시작 시각에서 MARGIN 만큼 앞당긴다 */
  function goalInfo(now){
    var g=load(GOAL_KEY);
    if(!g || !(g.target>0) || typeof g.won!=='number' || !isFinite(g.won) || g.won<0)
      return { ok:false, why:'업무일지 목표 정보가 없습니다 — 업무일지 동기화를 먼저 하세요' };
    var month=kstMonth(now), counted=Date.parse(g.countedAt)||0;
    /* 달이 바뀌는 앞뒤 2분(한국 시간)은 하지 않는다 — 기기 시계가 1분 안에서 어긋나도 승인이 어느 달로 들어갈지 확실하지 않다 */
    if(kstMonth(now-2*60e3)!==kstMonth(now+2*60e3)) return { ok:false, why:'달이 바뀌는 앞뒤 2분입니다 — 잠시 뒤 다시 동기화하세요' };
    if(g.month!==month) return { ok:false, why:'목표 정보가 이번 달('+month+') 것이 아닙니다('+g.month+') — 동기화를 먼저 하세요' };
    if(g.partial) return { ok:false, why:'마지막 동기화 때 이번 달 CMS 집계가 일부 실패했습니다 — 동기화를 다시 하세요' };
    if(!counted) return { ok:false, why:'목표 정보에 CMS 집계 시각이 없습니다 — 새 콘솔로 동기화를 다시 하세요' };
    if(counted>now+MARGIN) return { ok:false, why:'목표 정보의 집계 시각이 미래입니다 — 컴퓨터 시계를 확인하고 동기화를 다시 하세요' };
    if(now-counted>MAX_AGE) return { ok:false, why:'CMS 집계가 '+Math.round((now-counted)/60e3)+'분 전 것입니다 — 동기화를 다시 하세요(1시간 이내)' };
    if(!g.ids || !Array.isArray(g.ids.r)) return { ok:false, why:'목표 정보에 이번 달 리뷰 번호 목록이 없습니다 — 새 버전으로 동기화를 다시 하세요' };
    /* 작업 권한: 업무일지 서버에 로그인한 상태면 이 기기가 이번 달 작업 권한을 가져야 한다(lease). 로그인 안 했으면 null(한 기기) */
    if(g.lease!==null){
      var L=g.lease||{}, W={
        other: L.closed
          ? '다른 컴퓨터가 작업 권한을 넘겨 두었습니다'+(L.after?' — '+hm(Date.parse(L.after))+' 이후에 시작한 CMS 집계로':'')+' 검수 콘솔을 열어 동기화하면 이 컴퓨터로 넘어옵니다'
          : '다른 컴퓨터(또는 브라우저)가 이번 달 작업 권한을 갖고 있습니다 — 그 컴퓨터 검수 콘솔의 [🔑 작업 권한 넘기기]를 누른 뒤 여기서 검수 콘솔을 열어 동기화하세요 (다음 달엔 저절로 풀림)',
        released:'이 컴퓨터는 작업 권한을 넘겨 두었습니다 — 다시 하려면 검수 콘솔의 [🔑 이 컴퓨터로 작업 권한 다시 가져오기]를 누르세요',
        behind:'업무일지 서버 기록이 권한을 넘긴 컴퓨터의 기록보다 적습니다 — 잠시 뒤 다시 동기화하세요',
        view:'조회 동기화([업데이트])로는 작업 권한을 받지 않습니다 — 검수 콘솔을 열어 동기화하세요',
        stale:'작업 권한이 바뀌는 중이었습니다 — 검수 콘솔에서 다시 동기화하세요',
        reclaim:'작업 권한을 다시 가져오는 중입니다 — 동기화가 끝나면 됩니다',
        version:'업무일지 동기화 창이 예전 버전입니다 — 업무일지를 새로고침한 뒤 동기화하세요',
        clock:'이 컴퓨터 시계가 서버 시각과 '+(L.skew!=null?Math.abs(L.skew)+'초':'1분 넘게')+' 차이 납니다 — 시계를 맞춘 뒤 동기화하세요',
        device:'검수 콘솔이 예전 버전입니다 — CMS 탭을 새로고침하고 콘솔을 다시 여세요',
        partial:'CMS 집계가 일부 실패했습니다 — 동기화를 다시 하세요',
        account:'다른 CMS 계정이 이 업무일지의 이번 달 작업 권한을 갖고 있습니다 — 다음 달에 풀립니다' };
      var rel=false; try{ rel=store().getItem('unpa-lease-release')==='1'; }catch(e){ rel=true; }
      if(rel) return { ok:false, why:W.released };                         /* [작업 권한 넘기기]를 누른 컴퓨터 — 스냅샷과 관계없이 바로 멈춘다 */
      if(!g.lease || !g.lease.ok) return { ok:false, why:W[L.why] || '이번 달 작업 권한을 확인하지 못했습니다(서버 연결) — 업무일지 동기화를 다시 하세요' };
      if(!(Date.parse(g.lease.until)>now)) return { ok:false, why:'작업 권한 시간이 지났습니다 — 동기화를 다시 하세요' };
    }
    /* 제품 기준 시각: 이 기기 집계와 업무일지에 합쳐진 같은 계정의 더 나중 집계 중 나중 것(미래 시각은 버림) — 수입 합계가 그때까지를 담고 있다 */
    var pb=Date.parse(g.prodBase)||0; if(!(pb<=now+MARGIN)) pb=0;
    return { ok:true, g:g, month:month, base:Math.max(counted, pb)-MARGIN, have:new Set(g.ids.r.map(String)) };
  }
  /* 리뷰 승인: 이번 달에 했고, 업무일지 합계(번호 목록)에 아직 없으면 센다 — 시각으로 추측하지 않는다.
     제품 등록과 재승인(업무일지가 이미 한 번 센 리뷰가 다시 대기로 돌아와 또 승인 — 업무일지는 새 날짜로 한 번 더 센다)은
     번호로 가를 수 없어 시각으로 — CMS 집계를 시작한 뒤(5분 여유) 한 것만 (그 전 것은 집계에 들어 있다) */
  function counted(k, x, gi){
    if(!x || kstMonth(x.t)!==gi.month) return false;
    if(x.k==='r') return !gi.have.has(k.slice(2));      /* 업무일지는 한 번호를 한 번만 센다 — 재승인도 더 늘지 않는다 */
    return x.t>=gi.base;
  }
  function status(){
    var now=nowMs(), gi=goalInfo(now); if(!gi.ok) return gi;
    var g=gi.g, l=ledger(), spent=0, n={ r:0, p:0, c:0 }, seenR={};
    Object.keys(l.items).forEach(function(k){
      var x=l.items[k]; if(!RATE[x && x.k] || !counted(k, x, gi)) return;
      spent+=RATE[x.k]; n[x.k]++; if(x.k==='r') seenR[k.slice(2)]=1;
    });
    /* 권한을 넘긴 기기에 남아 있던 승인(넘겨받을 때 함께 받은 번호) — 업무일지 번호 목록에 잡힐 때까지 센다 */
    ((g.lease && Array.isArray(g.lease.pendR)) ? g.lease.pendR : []).forEach(function(id){
      id=String(id); if(seenR[id] || gi.have.has(id)) return; spent+=RATE.r; n.c++; seenR[id]=1; });
    /* 검수 콘솔 전송 기록의 승인 (원장에 없던 예전 기록 대비 — 번호로 중복 없이) */
    var sent=load(SENT_KEY)||{};
    Object.keys(sent).forEach(function(id){
      var e=sent[id]; if(!e || e.action!=='approve' || seenR[id]) return;
      if(!counted('r:'+id, { k:'r', t:Date.parse(e.at)||0 }, gi)) return;
      spent+=RATE.r; n.c++; seenR[id]=1;
    });
    var w=g.won+spent, left=g.target-w;
    /* 정지는 지금 셈법(v7)으로 쓴 것만 — 예전 셈법(재승인 500원 등)으로 걸린 정지는 한 번 다시 따진다.
       작업 권한과 함께 넘겨받은 정지(넘긴 컴퓨터가 이번 달을 멈췄음)도 이 컴퓨터 정지와 똑같이 본다 */
    var sameHalt=function(h){ return !!(h && h.v>=HALT_V && h.month===gi.month && h.target===g.target); }, lh=g.lease && g.lease.halt;
    var halt=sameHalt(l.halt) ? l.halt : (sameHalt(lh) && typeof lh.t==='number' && isFinite(lh.t)) ? lh : null;
    if(halt) return { ok:false, halted:true, month:gi.month, target:g.target, won:w, left:left,
      why:'이번 달은 목표 직전에서 멈춘 상태입니다 (멈춘 시각 '+hm(halt.t)+' · 이번 달 '+won(w)+' · 목표까지 '+won(Math.max(0,left))+' 남음). 목표를 올리면 다시 진행합니다' };
    return { ok:true, month:gi.month, target:g.target, base:g.won, spent:spent, n:n, won:w, left:left,
             approvals:Math.max(0, Math.floor(left/RATE.r)), products:Math.max(0, Math.floor(left/RATE.p)), countedAt:g.countedAt };
  }
  function line(s){
    s=s||status();
    if(!s.ok) return '🎯 '+s.why;
    return '🎯 목표 '+won(s.target)+' · 이번 달 '+won(s.won)+(s.spent?' (집계 뒤 +'+won(s.spent)+')':'')
      +' · 남은 '+won(Math.max(0,s.left))+' → 승인 '+s.approvals+'건 / 제품 '+s.products+'건까지';
  }
  /* 한 건 하기 직전에 부른다(리뷰는 지금 검수 대기인 것만). ok 면 원장에 적고, 아니면 절대 실행하지 않는다.
     같은 리뷰를 다시 부르면: 지금 세고 있는 예약이 있으면 그대로 ok(again — 그 예약에 '함께 씀' 표시를 남겨 주인이 지우지 못하게),
     셈에서 빠진 옛 기록이면 새 건처럼 예산부터 본다. 업무일지가 이미 센 리뷰가 다시 대기면 재승인 — 500원을 또 센다. */
  function haltAt(s, now){ save(IK+'!halt', { v:HALT_V, month:s.month, target:s.target, t:now, won:s.won }); }
  function reserve(kind, id, opt){
    var c=RATE[kind]; if(!c) return { ok:false, why:'알 수 없는 종류 '+kind };
    var key=kind+':'+String(id), now=nowMs(), s=status();
    if(!s.ok) return { ok:false, stop:true, why:s.why };
    var gi=goalInfo(now), all=ledger().items, cur=all[key];
    /* 작업 권한을 쓰는 동안(업무일지 서버 로그인)은 작성 70일 넘은 리뷰를 승인하지 않는다 — 다른 기기가 넘겨받을 때 하는
       CMS 집계(최근 75일 작성)에 안 잡혀 그 승인을 못 볼 수 있다 */
    if(kind==='r' && gi.g.lease!==null){
      var wd=Date.parse(String(opt && opt.written || '').slice(0,10)+'T00:00:00+09:00');
      if(!isFinite(wd)) return { ok:false, why:'리뷰 작성일을 몰라 승인하지 않습니다' };
      if(now-wd>OLD_DAYS*864e5) return { ok:false, why:'작성 '+OLD_DAYS+'일이 넘은 리뷰라 도구로 승인하지 않습니다 — CMS에서 직접 확인하세요' };
    }
    if(cur && counted(key, cur, gi)){ cur.j=now; putItem(key, cur); return { ok:true, again:true, left:s.left }; }
    if(kind==='r' && gi.have.has(String(id))) return { ok:true, again:true, free:true, left:s.left };   /* 이미 이번 달 수입에 든 리뷰의 재승인 — 업무일지가 더 세지 않으니 0원 */
    if(s.won+c>s.target){
      /* 집계 직전 5분 안에 한 제품 등록은 집계(won)와 원장에 두 번 들어 있을 수 있다 — 그것만 빼면 들어가는 경우엔
         최종 정지를 걸지 않고 새 집계를 요청한다(정확한 금액으로 다시 따지게) */
      var cb=Math.max(Date.parse(gi.g.countedAt)||0, Date.parse(gi.g.prodBase)||0), amb=0;
      Object.keys(all).forEach(function(k2){ var y=all[k2]; if(y && y.k==='p' && counted(k2, y, gi) && y.t<cb+MARGIN) amb+=RATE.p; });
      if(amb && s.won-amb+c<=s.target) return { ok:false, stop:true, why:'집계 직전에 등록한 제품이 두 번 셈해졌을 수 있습니다 — 업무일지 동기화(CMS 집계)를 새로 한 뒤 다시 하세요' };
      haltAt(s, now);                                                     /* 이 금액이 이번 달 최종 — 이후 모든 승인·등록 정지 */
      return { ok:false, stop:true, why:'목표 초과 — 이번 달 '+won(s.won)+' + '+NAME[kind]+' '+won(c)+' > 목표 '+won(s.target)+'. 여기서 멈추고 이번 달은 '+won(s.won)+'로 끝냅니다' };
    }
    var x={ k:kind, t:now };
    if(opt && opt.src) x.src=String(opt.src);
    putItem(key, x);
    Object.keys(all).forEach(function(k){ if(k!==key && !(all[k] && now-all[k].t<KEEP)) delItem(k); });
    /* 쓴 뒤 다시 센다 — 다른 탭이 같은 순간 예약해 합계가 넘었으면 내 예약을 거두고 멈춘다 */
    var s2=status();
    if(typeof s2.left==='number' && s2.left<0){
      var y=ledger().items[key]; if(y && y.t===now) delItem(key);
      haltAt(s2.ok ? s2 : s, now);
      return { ok:false, stop:true, why:'목표 초과 — 다른 탭과 동시에 예약돼 합계가 목표를 넘어 이 건은 하지 않고 멈춥니다' };
    }
    return { ok:true, created:true, token:now, left:s.left-c };
  }
  /* 목표 가까이(남은 금액이 이번 건 + 3만원 미만)에서는 탭끼리 줄을 세운다 — 브라우저 잠금(navigator.locks)을 잡고,
     다른 탭(다른 프로세스)이 막 쓴 원장이 이 탭에 전해질 시간을 잠깐 준 뒤 예약한다. 멀면 바로 예약 */
  var NEAR=30000, SETTLE=400;
  function settle(ms){ return new Promise(function(r){ (root.setTimeout||setTimeout)(r, ms); }); }
  function reserveSafe(kind, id, opt){
    var s=status(), c=RATE[kind];
    if(!s.ok || !c || s.left-c>=NEAR) return Promise.resolve(reserve(kind, id, opt));
    var run=function(){ return settle(SETTLE).then(function(){ return reserve(kind, id, opt); }); };
    var L=root.navigator && root.navigator.locks;
    return (L && L.request) ? L.request('unpa-guard-reserve', run) : run();
  }
  /* 원장에서 지우기 — 이번 시도가 새로 만든 그 예약(token)이고, 일이 실제로 일어나지 않은 게 확실할 때만 (예: 확인 창이 아예 안 떴음).
     다른 쪽이 그 예약을 함께 썼으면(j) 지우지 않는다 — 그쪽이 실제로 했을 수 있다 */
  function release(kind, id, token){
    var key=kind+':'+String(id), x=ledger().items[key];
    if(!x || x.j || (token!=null && x.t!==token)) return false;
    delItem(key); return true;
  }
  /* 결과가 애매한 예약(5xx·확인 뒤 결과 미확인)에 표시 — 이것만 나중에 forget 으로 지울 수 있다 */
  function mark(kind, id, token){
    var key=kind+':'+String(id), x=ledger().items[key];
    if(!x || (token!=null && x.t!==token)) return false;
    x.u=1; putItem(key, x); return true;
  }
  /* 수정요청이 실제로 나갔다 = 그 리뷰는 지금 대기였다 → 결과가 애매해 남겨 둔 승인 예약(u)은 실제로 승인되지 않은 것 — 지운다.
     확실히 된 승인(u 아님)은 지우지 않는다 — 승인 뒤 작성자가 고쳐 다시 대기가 된 경우일 수 있다 */
  function forget(id){ var key='r:'+String(id), x=ledger().items[key]; if(x && x.u){ delItem(key); return true; } return false; }
  /* 함께 쓴(again) 예약으로 실제 승인이 확인됐다 — 애매 표시를 지워 나중에 forget 으로 지워지지 않게 */
  function settled(kind, id){ var key=kind+':'+String(id), x=ledger().items[key]; if(x && x.u){ delete x.u; putItem(key, x); return true; } return false; }

  /* CMS 집계가 '내 승인 아님'으로 본 리뷰(notMine)의 승인 예약 중 집계 시작 전(before) 것은 실제로 승인되지 않았다 — 지운다.
     집계 범위(최근 60일 작성) 밖 리뷰는 notMine 에 없으니 지우지 않는다(센 채로 둠) */
  /* 지금 이번 달 수입으로 세고 있지만 업무일지 번호 목록엔 아직 없는 리뷰 번호(이 기기 원장·콘솔 전송 기록) — 넘길 때 함께 넘긴다 */
  function pendingReviewIds(){
    /* 스냅샷이 오래됐어도 넉넉하게: 이번 달(한국 시간) 원장·전송 기록의 리뷰 승인 중 스냅샷 번호 목록에 없는 것 전부 */
    var now=nowMs(), month=kstMonth(now), g=load(GOAL_KEY)||{}, have=new Set((g.month===month && g.ids && Array.isArray(g.ids.r)) ? g.ids.r.map(String) : []);
    var out={}, l=ledger();
    Object.keys(l.items).forEach(function(k){ var x=l.items[k]; if(x && x.k==='r' && kstMonth(x.t)===month && !have.has(k.slice(2))) out[k.slice(2)]=1; });
    var sent=load(SENT_KEY)||{};
    Object.keys(sent).forEach(function(id){ var e=sent[id]; if(e && e.action==='approve' && kstMonth(Date.parse(e.at)||0)===month && !have.has(String(id))) out[String(id)]=1; });
    return Object.keys(out);
  }
  function prune(notMine, before){
    var items=ledger().items, n=0;
    /* 마지막으로 쓴 때(t·함께 쓴 j 중 나중)가 집계 시작 전이어야 한다 — 집계 중에 다시 써서 실제로 승인된 예약은 남긴다 */
    /* 결과가 애매했던(u) 예약만 — 확인된 승인은 보관함으로 업무일지에 들어가 번호 목록에 잡힐 때까지 센다 */
    Object.keys(items).forEach(function(k){ var x=items[k]; if(x && x.k==='r' && x.u && Math.max(x.t||0, x.j||0)<before && notMine[k.slice(2)]){ delItem(k); n++; } });
    return n;
  }
  root.UnpaGuard={ VERSION:VERSION, RATE:RATE, status:status, line:line, reserve:reserve, reserveSafe:reserveSafe, release:release, mark:mark, forget:forget, settled:settled, prune:prune,
                   ledger:ledger, pendingReviewIds:pendingReviewIds, kstMonth:kstMonth,
                   keys:{ goal:GOAL_KEY, ledger:LEDGER_KEY, sent:SENT_KEY } };

  /* ── 리뷰 상세에서 하는 일 (승인 · 수정요청) ──
     숨은 탭에서도 느려지지 않게 MessageChannel 로 기다린다. 한 번에 33초까지만 돌고 남은 건 TIME 으로 돌려준다. */
  if(!root.document) return;
  var T=function(s){ return (s||'').replace(/\s+/g,' ').trim(); };
  var tick=function(){ return new Promise(function(r){ var c=new MessageChannel(); c.port1.onmessage=function(){ c.port1.close(); r(); }; c.port2.postMessage(0); }); };   /* 다 쓴 채널은 닫는다 */
  var waitFor=async function(fn,ms){ var t=Date.now(); while(Date.now()-t<ms){ var v=fn(); if(v) return v; await tick(); } return null; };
  var sleep=async function(ms){ var t=Date.now(); while(Date.now()-t<ms) await tick(); };
  var cells=function(){ var o={}; document.querySelectorAll('th').forEach(function(th){ o[T(th.innerText)]=T(th.nextElementSibling?th.nextElementSibling.innerText:''); }); return o; };
  var btn=function(t){ return [].slice.call(document.querySelectorAll('button')).find(function(b){ return T(b.innerText)===t; }); };
  var H=function(s){ var h=5381; for(var i=0;i<s.length;i++) h=(Math.imul(h,33)^s.charCodeAt(i))>>>0; return h; };
  function dataOf(opt){ var d=opt && opt.data; if(typeof d==='string'){ try{ return JSON.parse(sessionStorage.getItem(d)||'{}'); }catch(e){ return {}; } } return d||null; }
  async function open(id, need){
    if(location.pathname!=='/review/detail/'+id) root.next.router.push('/review/detail/'+id);
    var ok=await waitFor(function(){ return cells()['리뷰 ID']===id && btn(need); }, 8000);
    if(ok) await sleep(250);
    return !!ok;
  }
  function checkCommon(id, D){
    var c=cells();
    if(D && D[id] && D[id].upd && c['최근 수정일']!==D[id].upd) return 'STOP upd(수집 뒤 작성자 수정)';
    var sw=[].slice.call(document.querySelectorAll('button.ant-switch')).filter(function(b){ return /노출/.test(b.innerText); });
    if(!sw.length || sw[sw.length-1].getAttribute('aria-checked')!=='true') return 'STOP hidden';
    return null;
  }
  /* 승인 — 건마다 목표 가드를 먼저 통과해야 누른다. 가드에 걸리면 그 자리에서 전체를 멈춘다 */
  async function approve(ids, opt){
    opt=opt||{}; var D=dataOf(opt), out=[], t0=Date.now(), max=opt.maxMs||33000;
    var s0=status(); if(!s0.ok) return 'STOP 🎯 '+s0.why;
    for(var k=0;k<ids.length;k++){
      var id=String(ids[k]);
      if(Date.now()-t0>max){ out.push('TIME left '+ids.slice(k).join(',')); break; }
      if(!await open(id,'검수 완료')){ out.push(id+' STOP load'); continue; }
      var bad=checkCommon(id, D); if(bad){ out.push(id+' '+bad); continue; }
      var th=[].slice.call(document.querySelectorAll('img')).find(function(x){ return /images\.unpa\.me/.test(x.src) && x.alt; });
      if(!th || /\/null$/.test(th.src)){ out.push(id+' STOP xbox(제품 미연결)'); continue; }
      var a=btn('검수 완료'); if(!a || a.disabled){ out.push(id+' already/notpending'); continue; }
      var g=await reserveSafe('r', id, { written:cells()['최초 작성일'] });
      if(!g.ok && !g.stop){ out.push(id+' SKIP '+g.why); continue; }      /* 이 리뷰만 못 함(작성일 등) — 나머지는 이어서 */
      if(!g.ok){ out.push(id+' ⛔ '+g.why); out.push('NOT DONE '+ids.slice(k).join(',')); break; }
      a.click();
      var m=await waitFor(function(){ return [].slice.call(document.querySelectorAll('.ant-modal, .ant-modal-confirm')).find(function(x){ return /리뷰 검수를 완료하시겠습니까/.test(x.innerText); }); }, 4000);
      if(!m){ if(g.created) release('r', id, g.token); out.push(id+' STOP nomodal'); continue; }      /* 확인 창이 안 떴다 = 이번엔 승인 안 됨 → 이번에 만든 예약만 뺀다 */
      var ok=[].slice.call(m.querySelectorAll('button')).find(function(b){ return T(b.innerText)==='확인'; });
      if(!ok){ if(g.created) release('r', id, g.token); out.push(id+' STOP no-confirm-button'); continue; }
      ok.click();
      var fin=await waitFor(function(){ var b=btn('검수 완료'); return b && b.disabled ? 'y' : null; }, 7000);
      /* 확인을 누른 뒤에는 결과가 안 보여도 원장에 남긴다 — 실제로 됐을 수 있으니 센 채로 둔다 */
      if(!fin && g.created) mark('r', id, g.token);
      if(fin && g.again) settled('r', id);
      if(fin) outbox(id, g.token || nowMs());                                                 /* 확인된 승인만 — 애매한 건 업무일지 기록에 넣지 않는다(원장에는 센 채로) */
      out.push(id+(fin?' OK':' UNSURE(확인 누름 · 결과 미확인 — 수입에는 센 채로 둠)'));
    }
    return out.join(' ; ')+' || '+line();
  }
  /* 수정요청 — jobs: [{id, cb?(체크박스 번호), text?, hash?}]. 문구는 djb2 해시가 맞을 때만 보낸다. 수입과 무관해 가드 없음 */
  async function revise(jobs, opt){
    opt=opt||{}; var D=dataOf(opt), out=[], t0=Date.now(), max=opt.maxMs||30000;
    var setTA=function(ta,v){ ta.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta,v); ta.dispatchEvent(new Event('input',{bubbles:true})); };
    for(var k=0;k<jobs.length;k++){
      var j=jobs[k], id=String(j.id);
      if(Date.now()-t0>max){ out.push('TIME left '+jobs.slice(k).map(function(x){ return x.id; }).join(',')); break; }
      if(!await open(id,'작성자에게 수정 요청')){ out.push(id+' STOP load'); continue; }
      var bad=checkCommon(id, D); if(bad && bad!=='STOP hidden'){ out.push(id+' '+bad); continue; }
      var a=btn('검수 완료'), r=btn('작성자에게 수정 요청');
      if(!a || a.disabled || !r || r.disabled){ out.push(id+' STOP notpending'); continue; }
      r.click();
      var m=await waitFor(function(){ var x=document.querySelector('.ant-modal'); return x && x.querySelector('input[type=checkbox]') ? x : null; }, 4000);
      if(!m){ out.push(id+' STOP nomodal'); continue; }
      var labels=[].slice.call(m.querySelectorAll('label'));
      if(j.cb!=null){ var ci=labels[j.cb].querySelector('input'); if(!ci.checked) ci.click(); }
      if(j.text){ var cc=m.querySelector('.custom-area input[type=checkbox]'); if(!cc.checked) cc.click(); }
      await sleep(300);
      if(j.text){ var ta=await waitFor(function(){ return m.querySelector('textarea'); }, 2000); setTA(ta, j.text); await sleep(200); }
      var checks=[].slice.call(m.querySelectorAll('input[type=checkbox]')).map(function(c){ return c.checked; });
      var ta2=m.querySelector('textarea'), val=ta2?ta2.value:'';
      var need=(j.cb!=null?1:0)+(j.text?1:0);
      var good=checks.filter(Boolean).length===need && (j.cb==null||checks[j.cb]) && (!j.text||checks[checks.length-1])
        && (j.text ? (val===j.text && H(val)===(j.hash||H(j.text))) : !val);
      if(!good){ out.push(id+' STOP verify'); var cancel=[].slice.call(m.querySelectorAll('button')).find(function(b){ return T(b.innerText)==='취소'; }); if(cancel) cancel.click(); await sleep(400); continue; }
      [].slice.call(m.querySelectorAll('button')).find(function(b){ return T(b.innerText)==='확인'; }).click();
      var fin=await waitFor(function(){ var b=btn('수정 요청 완료'); return b && b.disabled ? 'y' : null; }, 7000);
      if(fin) forget(id);
      out.push(id+(fin?' SENT':' NOTDONE'));
    }
    return out.join(' ; ');
  }
  /* 승인(또는 결과 미확인)을 콘솔 보관함에도 남긴다 — 다음 동기화가 CMS 집계 범위(최근 60일 작성)와 관계없이 업무일지에 넣게 */
  function outbox(id, at){       /* at = 예약한(누르기 직전) 시각 — CMS 승인 시각보다 늦지 않아 자정 무렵 날짜가 앞서 가지 않는다 */
    try{ var o=load(OUTBOX_KEY); if(!o || typeof o!=='object') o={}; o.reviews=Array.isArray(o.reviews) ? o.reviews : []; o.audit=o.audit||{};
      var d=new Date(at || nowMs()), p2=function(n){ return (n<10?'0':'')+n; }, day=d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
      if(!o.reviews.some(function(x){ return x && String(x[0])===String(id); })) o.reviews.push([String(id), day, '', '', '', 'm']);
      if(o.reviews.length>5000) o.reviews=o.reviews.slice(-5000);
      o.seq=(o.seq||0)+1; save(OUTBOX_KEY, o); }catch(e){}
  }
  root.UnpaOps={ approve:approve, revise:revise, hash:H };

  /* ── 제품 등록 폼 (/product/edit) ──
     fill → (브랜드 드롭다운 뜰 때까지 2초쯤) → fill2 → submit(d). submit 은 폼 값이 d 와 모두 같고 목표 가드를 통과할 때만 '등록'을 누른다. */
  var fiberOf=function(el){ return el[Object.keys(el).find(function(k){ return k.indexOf('__reactFiber')===0; })]; };
  var txt=function(x){ return x==null ? '' : (typeof x==='string'||typeof x==='number') ? String(x) : Array.isArray(x) ? x.map(txt).join('') : x.props ? (txt(x.props.children)||txt(x.props.title)) : ''; };
  var setVal=function(input,v){ var proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,v); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); };
  var selProps=function(id){ var el=document.querySelector('input#'+id).closest('.ant-select'); var f=fiberOf(el), n=0; while(f && n<40){ var p=f.memoizedProps; if(p && p.onChange && (p.options || p.id===id)) return p; f=f.return; n++; } return null; };
  var PH={ name:'제품명을 입력해주세요.', amount:'제품의 용량을 입력하세요', price:'제품의 금액을 입력하세요' };
  var SUBMIT_SEQ=0;
  var F={
    setText:function(ph,v){ var i=document.querySelector('input[placeholder="'+ph+'"]'); setVal(i,String(v)); return i.value; },
    setSel:function(id,label){ var p=selProps(id); if(!p) return 'no props '+id; if(!p.options){ p.onChange(label,{value:label,label:label}); return 'set '+id+'='+label; }
      var o=p.options.find(function(o){ return txt(o.label).trim()===label; }); if(!o) return 'miss '+label+' in '+p.options.map(function(o){ return txt(o.label); }).join(',');
      p.onChange(o.value,o); return 'set '+id+'='+label; },
    brandSearch:function(q){ var i=document.querySelector('input#brand'); i.closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); i.focus(); setVal(i,q); return 'searching '+q; },
    brandPick:function(name){ var dd=[].slice.call(document.querySelectorAll('.ant-select-dropdown')).filter(function(d){ return d.className.indexOf('hidden')<0; });
      for(var i=0;i<dd.length;i++){ var o=[].slice.call(dd[i].querySelectorAll('.ant-select-item-option')).find(function(e){ return e.innerText.trim()===name; }); if(o){ o.click(); return 'picked '+name; } }
      return 'brand option not found'; },
    addOptions:function(n){ var b=[].slice.call(document.querySelectorAll('button')).find(function(b){ return b.innerText.trim()==='추가'; }); for(var k=0;k<n;k++) b.click(); return 'added '+n; },
    fillOptions:function(list){ var ins=[].slice.call(document.querySelectorAll('input[placeholder="추가"]')); list.forEach(function(v,k){ setVal(ins[k],v); }); return ins.map(function(i){ return i.value; }).join(' / '); },
    fill:function(d){ var r=[this.setText(PH.name,d.name),this.setText(PH.amount,d.amount),this.setText(PH.price,d.price),this.setSel('unit',d.unit),this.setSel('categoryId',d.cat),this.brandSearch(d.bq||d.brand)];
      if(d.options && d.options.length) r.push(this.addOptions(d.options.length)); return r.join(' | '); },
    fill2:function(d){ var r=[this.brandPick(d.brand),this.setSel('subcategoryId',d.sub)]; if(d.options && d.options.length) r.push(this.fillOptions(d.options)); return r.join(' | '); },
    state:function(){ var g=function(id){ return document.querySelector('input#'+id).closest('.ant-select').innerText.trim(); }; var v=function(ph){ return (document.querySelector('input[placeholder="'+ph+'"]')||{}).value; };
      return { name:v(PH.name), amount:v(PH.amount), unit:g('unit'), price:v(PH.price), brand:g('brand'), cat:g('categoryId'), sub:g('subcategoryId'),
               img:document.querySelectorAll('.ant-upload-list-item').length, options:[].slice.call(document.querySelectorAll('input[placeholder="추가"]')).map(function(i){ return i.value; }) }; },
    /* 새 제품 등록만 600원 — 이미 있는 제품 편집(id 가 붙은 화면)은 수입이 아니라 가드 없이 저장 */
    submit:async function(d){
      var s=this.state(), num=function(x){ return String(x).replace(/,/g,''); };
      var same=s.name===d.name && s.brand===d.brand && s.cat===d.cat && s.sub===d.sub && s.img===1 && s.unit===d.unit
        && num(s.amount)===String(d.amount) && num(s.price)===String(d.price) && JSON.stringify(s.options)===JSON.stringify(d.options||[]);
      if(!same) return 'HOLD 폼 값이 다름 '+JSON.stringify(s);
      try{ sessionStorage.removeItem('__unpaLastP'); }catch(e){}   /* 이번에 예약한 것만 되돌릴 수 있게 */
      var isNew=!/[?&]id=/.test(location.search), key=d.name+'|'+d.brand+'|'+nowMs()+'|'+(++SUBMIT_SEQ)+Math.random().toString(36).slice(2,6);   /* 누를 때마다 새 키 — 다시 눌러도 따로 센다 */
      var b=[].slice.call(document.querySelectorAll('button[type=submit]')).find(function(b){ return b.innerText.trim()==='등록'; });
      if(!b) return 'STOP 등록 버튼 없음';
      if(isNew){ var g=await reserveSafe('p', key); if(!g.ok) return '⛔ '+g.why; try{ sessionStorage.setItem('__unpaLastP', key); }catch(e){} }
      b.click(); return 'SUBMIT '+d.name+(isNew?' · key '+key+' · '+line():'');
    },
    /* 방금 등록이 실제로 안 된 것을 제품 목록에서 확인한 뒤에만 부른다 — 결과가 애매하면 부르지 않는다(센 채로 둔다) */
    undo:function(key){ var last=null; try{ last=sessionStorage.getItem('__unpaLastP'); }catch(e){}
      if(!key || key!==last) return false;                 /* 방금 이 탭에서 예약한 그 키만 */
      try{ sessionStorage.removeItem('__unpaLastP'); }catch(e){} return release('p', key); },
    result:function(){ return location.pathname+' | '+[].slice.call(document.querySelectorAll('.ant-notification-notice, .ant-message-notice')).map(function(e){ return e.innerText.trim(); }).join(' | ')
      +' | top: '+[].slice.call(document.querySelectorAll('tbody tr')).slice(0,1).map(function(r){ var a=r.querySelector('a[href*="/product/"]'); return r.innerText.replace(/\s+/g,' ').slice(0,50)+' '+(a && a.getAttribute('href')); }).join(''); }
  };
  root.UnpaForm=F;
})(typeof window!=='undefined' ? window : globalThis);
