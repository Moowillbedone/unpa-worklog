// ==UserScript==
// @name         언니의파우치 업무일지 자동 동기화
// @namespace    https://moowillbedone.github.io/unpa-worklog/
// @version      1.0.0
// @description  CMS를 열어 두면 업무일지(리뷰·제품 수, 금액, 미등록 제품수)를 30분마다 CMS 기준으로 맞춥니다. 조회만 하고 CMS는 바꾸지 않습니다.
// @match        https://cms.unpa.me/*
// @match        https://moowillbedone.github.io/unpa-worklog/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://moowillbedone.github.io/unpa-worklog/unpa-autosync.user.js
// @downloadURL  https://moowillbedone.github.io/unpa-worklog/unpa-autosync.user.js
// ==/UserScript==

/* 이 스크립트는 "대신 눌러 주는 손"일 뿐이다.
   - CMS 탭: 업무일지 [📒 업데이트] 북마클릿과 같은 검수 콘솔 집계(cms-console.js, 조회만)를 정해진 때에 실행한다.
   - 업무일지 탭: 집계 결과를 받아 업무일지 화면에 반영하게 한다.
   집계 규칙·데이터는 모두 저장소(cms-console.js · worklog-core.js)와 업무일지에 있다.
   Tampermonkey 가 없어져도 업무일지 [🔄 업데이트] + 북마클릿으로 똑같이 할 수 있다. */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var WL = 'https://moowillbedone.github.io/unpa-worklog/';
  var EVERY = 30 * 60 * 1000;        /* 자동 동기화 간격 */
  var RUN_LIMIT = 6 * 60 * 1000;     /* 한 번 도는 데 넉넉한 시간 — 그 사이 다른 CMS 탭은 기다린다 */

  function now() { return Date.now(); }
  function rid() {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  var TAB = rid();

  if (location.hostname === 'cms.unpa.me') cmsSide();
  else if (location.hostname === 'moowillbedone.github.io') worklogSide();

  /* ── CMS 탭 ───────────────────────────────────────── */
  function cmsSide() {
    var run = null;          /* 지금 이 탭에서 도는 집계 {nonce, timer} */
    var waiting = null;      /* 업무일지 반영 결과를 기다리는 집계 {nonce, at} */

    function status(text, err) { GM_setValue('status', { at: now(), text: String(text || '').slice(0, 160), err: !!err, tab: TAB }); }
    /* 로그인 화면에서는 돌지 않는다 — 관리 화면 메뉴가 보일 때만 */
    function loggedIn() { return !!document.body && /CMS MENU/.test(document.body.innerText || ''); }
    function due() { var last = GM_getValue('lastRun', 0), req = GM_getValue('request', 0); return req > last || now() - last >= EVERY; }
    function busyElsewhere() { var l = GM_getValue('lock', null); return !!(l && l.tab !== TAB && l.t > now() - RUN_LIMIT); }

    function tryRun() {
      if (run || !loggedIn() || !due() || busyElsewhere()) return;
      /* 검수 콘솔·업데이트 북마클릿이 이미 떠 있으면 그쪽이 동기화한다 */
      if (document.getElementById('cmsConsoleBox') || document.getElementById('unpaSyncBox')) return;
      GM_setValue('lock', { tab: TAB, t: now() });
      /* 여러 CMS 탭이 동시에 잡으려 하면 마지막에 쓴 탭만 돈다 */
      setTimeout(function () {
        var l = GM_getValue('lock', null);
        if (!l || l.tab !== TAB || run) return;
        start();
      }, 400 + Math.floor(Math.random() * 400));
    }

    function start() {
      var nonce = rid();
      run = { nonce: nonce, timer: setTimeout(function () { fail('응답 시간 초과 — 다음에 다시 시도'); }, RUN_LIMIT) };
      GM_setValue('ack', { at: now(), tab: TAB });
      status('CMS 집계 시작…');
      document.documentElement.setAttribute('data-unpa-autosync-run', nonce);
      var s = document.createElement('script');
      s.src = WL + 'cms-console.js?t=' + now();
      s.onerror = function () { fail('검수 콘솔 스크립트를 불러오지 못했습니다'); };
      (document.body || document.documentElement).appendChild(s);
    }
    function release() {
      if (run) clearTimeout(run.timer);
      run = null;
      var l = GM_getValue('lock', null); if (l && l.tab === TAB) GM_setValue('lock', null);
    }
    function fail(msg) { status('⚠ ' + (msg || '자동 동기화 실패'), true); release(); }

    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data || !run || ev.data.nonce !== run.nonce) return;
      var d = ev.data;
      if (d.type === 'unpa-auto-status') { status(d.text); GM_setValue('lock', { tab: TAB, t: now() }); }
      else if (d.type === 'unpa-auto-fail') fail(d.error);
      else if (d.type === 'unpa-auto-payload') {
        var at = now();
        waiting = { nonce: run.nonce, at: at };
        GM_setValue('payload', { at: at, payload: d.payload });
        GM_setValue('lastRun', at);
        status('업무일지로 넘김 — 업무일지 화면에서 반영');
        release();
      }
    });
    /* 업무일지 탭이 반영한 결과를 콘솔 카드로 돌려준다 (배운 제품 연결·보관함 정리에 쓰인다) */
    GM_addValueChangeListener('result', function (n, o, v) {
      if (!waiting || !v || v.at !== waiting.at) return;
      try { window.postMessage({ type: 'unpa-auto-result', nonce: waiting.nonce, res: v.res }, location.origin); } catch (e) {}
      waiting = null;
    });
    /* 업무일지 [🔄 업데이트] 버튼 — 30분을 기다리지 않고 바로 */
    GM_addValueChangeListener('request', function (n, o, v, remote) { if (remote) tryRun(); });

    setTimeout(tryRun, 1500);
    setInterval(tryRun, 60 * 1000);
  }

  /* ── 업무일지 탭 ──────────────────────────────────── */
  function worklogSide() {
    /* 업무일지 본체에서만 (도구 모음·동기화 창 제외) */
    if (!/^\/unpa-worklog\/(index\.html)?$/.test(location.pathname)) return;
    var html = document.documentElement;
    html.setAttribute('data-unpa-autosync', VERSION);
    var applying = null;

    function post(m) { try { window.postMessage(m, location.origin); } catch (e) {} }
    function pageReady() { return html.getAttribute('data-unpa-autosync-ready') === '1'; }

    function apply() {
      var p = GM_getValue('payload', null);
      if (!p || !p.payload || applying || !pageReady()) return;
      if (p.at <= GM_getValue('appliedAt', 0)) return;
      /* 업무일지 탭이 여러 개면 한 탭만 반영한다 */
      var l = GM_getValue('applyLock', null);
      if (l && l.tab !== TAB && l.t > now() - 60000) return;
      GM_setValue('applyLock', { tab: TAB, t: now() });
      applying = { at: p.at, timer: setTimeout(function () { applying = null; }, 90000) };
      post({ type: 'unpa-autosync-apply', id: String(p.at), payload: p.payload });
    }

    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin || !ev.data) return;
      var d = ev.data;
      if (d.type === 'unpa-autosync-request') { GM_setValue('request', now()); return; }
      if (d.type === 'unpa-autosync-applied' && applying && d.id === String(applying.at)) {
        clearTimeout(applying.timer);
        var at = applying.at; applying = null;
        if (d.res && d.res.ok) GM_setValue('appliedAt', at);
        GM_setValue('result', { at: at, res: d.res || { ok: false } });
        var l = GM_getValue('applyLock', null); if (l && l.tab === TAB) GM_setValue('applyLock', null);
      }
    });
    GM_addValueChangeListener('payload', function () { setTimeout(apply, 50); });
    GM_addValueChangeListener('status', function (n, o, v) { if (v) post({ type: 'unpa-autosync-status', text: String(v.text || ''), err: !!v.err, at: v.at }); });
    GM_addValueChangeListener('ack', function (n, o, v) { if (v) post({ type: 'unpa-autosync-ack', at: v.at }); });

    /* 업무일지가 준비되면(받을 준비 신호) 밀린 집계를 반영한다 */
    var tries = 0;
    (function wait() { if (pageReady()) { apply(); return; } if (++tries < 150) setTimeout(wait, 200); })();
  }
})();
