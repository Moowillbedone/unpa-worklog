/* ============================================================
 * 리뷰 검수 수집기 — cms-collect.js   (읽기 전용 · GET만)
 *
 * 인증 확보 순서
 *   1) 쿠키만으로 API 가 열리는지 시도
 *   2) next-auth 세션(/api/auth/session)에서 토큰 추출
 *   3) 그래도 안 되면 페이지 요청을 가로채기 위해 대기
 *      (화면 우측 상단 드롭다운을 바꾸면 목록이 다시 불려온다)
 *
 * 하지 않는 것: 승인/반려/수정 등 상태 변경 요청.
 *              전 과정이 GET 뿐이며 버튼을 누르지 않는다.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }

  /* 재실행 허용 — 이전 실행 흔적 정리 */
  try { var old = document.getElementById('cmsCollectBox'); if (old) old.remove(); } catch (e) {}
  if (window.__COLLECT_RUNNING) { window.__COLLECT_ABORT = true; }
  window.__COLLECT_RUNNING = true;
  window.__COLLECT_ABORT = false;

  var API = 'https://api-v2.unpa.me';
  var AUTH = window.__COLLECT_AUTH || null;   /* 이전 실행에서 잡아둔 토큰 재사용 */
  var OUT = { at: new Date().toISOString(), pageUrl: location.href, range: null,
              totalCount: 0, list: [], details: [], detailEndpoint: null, probes: [], authMode: null };

  /* ── 패널 ── */
  var box = document.createElement('div');
  box.id = 'cmsCollectBox';
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0e1a16;color:#e8f1ed;'
    + 'border:1px solid #2fb87f;border-radius:13px;padding:15px 18px;'
    + 'font:12.5px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:350px';
  document.body.appendChild(box);
  function say(html) {
    box.innerHTML = '<b style="color:#3ddc97">📥 리뷰 수집</b><div style="margin-top:8px;color:#9fb4ab">'
      + html + '</div><div style="margin-top:8px;font-size:11px;color:#6b7f77">GET 전용 · 상태 변경 없음</div>';
  }

  /* ── 요청 가로채기 (계속 켜둔다) ── */
  function grab(h) {
    try {
      if (!h) return;
      var o = {};
      if (h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; });
      else if (typeof h === 'object') Object.keys(h).forEach(function (k) { o[k.toLowerCase()] = h[k]; });
      if (o.authorization) { AUTH = o.authorization; window.__COLLECT_AUTH = AUTH; }
    } catch (e) {}
  }
  var oF = window.__COLLECT_OF || window.fetch;
  window.__COLLECT_OF = oF;
  window.fetch = function () {
    var a = arguments, u = String((a[0] && a[0].url) || a[0] || '');
    try {
      if (u.indexOf('/admin/') >= 0) { if (a[0] && a[0].headers) grab(a[0].headers); if (a[1] && a[1].headers) grab(a[1].headers); }
    } catch (e) {}
    return oF.apply(this, a);
  };
  if (!window.__COLLECT_XHOOK) {
    window.__COLLECT_XHOOK = true;
    var OX = XMLHttpRequest.prototype.open, OSH = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return OX.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (String(k).toLowerCase() === 'authorization' && String(this.__u).indexOf('/admin/') >= 0) {
        AUTH = v; window.__COLLECT_AUTH = v; } } catch (e) {}
      return OSH.apply(this, arguments);
    };
  }

  function H() { var h = { 'Accept': 'application/json' }; if (AUTH) h['Authorization'] = AUTH; return h; }
  function get(url) {
    return oF.call(window, url, { headers: H(), credentials: 'include' })
      .then(function (r) { return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t.slice(0, 300) };
      }); })
      .catch(function (e) { return { status: 0, json: null, text: String(e && e.message || e) }; });
  }

  /* ── 조회 조건 ── */
  var qs = new URLSearchParams(location.search);
  var sd = qs.get('startDate'), ed = qs.get('endDate');
  if (!sd || !ed) {
    say('<b style="color:#ff8f6b">주소에 날짜가 없습니다.</b><br><br>아래 형태의 주소로 이동한 뒤 다시 실행해주세요.<br>'
      + '<span style="font-family:monospace;font-size:11px;color:#cfe">/review/list/all?startDate=2026-08-24'
      + '&amp;endDate=2026-08-24&amp;beforeApproval=true</span>');
    window.__COLLECT_RUNNING = false; return;
  }
  OUT.range = { startDate: sd, endDate: ed, beforeApproval: qs.get('beforeApproval') === 'true' };

  function listUrl(page, size) {
    return API + '/admin/reviews?pageSize=' + size + '&startDate=' + sd + '&endDate=' + ed
         + (OUT.range.beforeApproval ? '&beforeApproval=true' : '')
         + '&page=' + page + '&field=CREATED_AT&direction=desc';
  }

  /* ── 인증 확보 ── */
  async function ensureAuth() {
    /* 1) 쿠키만으로 되는지 */
    say('접근 방식 확인 중… (1/3 쿠키)');
    var r = await get(listUrl(1, 1));
    if (r.status === 200 && r.json) { OUT.authMode = AUTH ? 'header+cookie' : 'cookie'; return true; }

    /* 2) next-auth 세션에서 토큰 */
    say('접근 방식 확인 중… (2/3 세션)');
    var s = await get(location.origin + '/api/auth/session');
    if (s.json) {
      var found = null;
      (function walk(o) {
        if (!o || typeof o !== 'object' || found) return;
        Object.keys(o).forEach(function (k) {
          if (found) return;
          var v = o[k];
          if (typeof v === 'string' && v.length > 60 && /token/i.test(k)) found = v;
          else if (v && typeof v === 'object') walk(v);
        });
      })(s.json);
      if (found) {
        AUTH = /^Bearer /i.test(found) ? found : 'Bearer ' + found;
        window.__COLLECT_AUTH = AUTH;
        var r2 = await get(listUrl(1, 1));
        if (r2.status === 200 && r2.json) { OUT.authMode = 'session-token'; return true; }
      }
    }

    /* 3) 화면이 API 를 부를 때까지 대기 */
    say('<b style="color:#f5c451">인증 정보 대기 중…</b><br><br>'
      + '화면 <b>우측 상단 드롭다운</b>(전체 / 검수 필요 / 검수 완료 / 수정 요청)을<br>'
      + '<b>다른 값으로 한 번 바꿔주세요.</b><br><br>'
      + '<span style="font-size:11.5px">목록이 다시 불려오는 순간 자동으로 이어집니다.<br>'
      + '([검색] 버튼은 동작하지 않는 것으로 확인됐습니다)</span>');
    for (var i = 0; i < 150; i++) {                     /* 최대 약 5분 */
      if (window.__COLLECT_ABORT) return false;
      await new Promise(function (res) { setTimeout(res, 2000); });
      if (AUTH) {
        var r3 = await get(listUrl(1, 1));
        if (r3.status === 200 && r3.json) { OUT.authMode = 'intercepted'; return true; }
      }
    }
    return false;
  }

  (async function run() {
    var ok = await ensureAuth();
    if (window.__COLLECT_ABORT) { window.__COLLECT_RUNNING = false; return; }
    if (!ok) {
      say('<b style="color:#ff8f6b">인증 정보를 확보하지 못했습니다.</b><br><br>'
        + '드롭다운을 바꿔 목록을 다시 불러온 뒤, 즐겨찾기를 한 번 더 눌러주세요.<br>'
        + '<span style="font-size:11.5px">재실행하면 이전에 잡아둔 토큰을 이어서 씁니다.</span>');
      window.__COLLECT_RUNNING = false; return;
    }

    /* 1) 목록 전량 */
    var page = 1, all = [], total = 0;
    while (page <= 30) {
      say('목록 수집 중… <b>' + all.length + '</b>건');
      var r = await get(listUrl(page, 100));
      if (r.status !== 200 || !r.json) {
        say('<b style="color:#ff8f6b">목록 조회 실패 (HTTP ' + r.status + ')</b><br>' + r.text.slice(0, 150));
        window.__COLLECT_RUNNING = false; return;
      }
      total = r.json.totalCount || 0;
      var rows = r.json.result || [];
      all = all.concat(rows);
      if (rows.length < 100 || all.length >= total) break;
      page++;
    }
    OUT.totalCount = total; OUT.list = all;

    /* 2) 상세 엔드포인트 탐색 */
    if (all.length) {
      var id = all[0].id;
      var cands = [API + '/admin/reviews/' + id, API + '/admin/review/' + id, API + '/admin/reviews/' + id + '/detail'];
      for (var i = 0; i < cands.length; i++) {
        say('상세 조회 방식 확인 중… (' + (i + 1) + '/' + cands.length + ')');
        var pr = await get(cands[i]);
        OUT.probes.push({ url: cands[i].replace(String(id), '{id}'), status: pr.status,
                          keys: pr.json ? Object.keys(pr.json).slice(0, 40) : [], head: pr.text.slice(0, 200) });
        if (pr.status === 200 && pr.json) { OUT.detailEndpoint = cands[i].replace(String(id), '{id}'); break; }
      }
    }

    /* 3) 상세 수집 */
    if (OUT.detailEndpoint) {
      for (var k = 0; k < all.length; k++) {
        if (window.__COLLECT_ABORT) break;
        say('상세 수집 중… <b>' + (k + 1) + ' / ' + all.length + '</b>');
        var dr = await get(OUT.detailEndpoint.replace('{id}', all[k].id));
        OUT.details.push({ id: all[k].id, status: dr.status, data: dr.json });
        await new Promise(function (res) { setTimeout(res, 120); });
      }
    }

    /* 4) 저장 */
    var blob = new Blob([JSON.stringify(OUT, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cms-reviews-' + sd + '.json';
    document.body.appendChild(a); a.click(); a.remove();

    say('<b style="color:#3ddc97">✓ 수집 완료</b><br>목록 <b>' + OUT.list.length + '</b>건 · 상세 <b>'
      + OUT.details.length + '</b>건<br>인증 방식: ' + OUT.authMode
      + '<br>상세 방식: ' + (OUT.detailEndpoint ? '찾음' : '<span style="color:#ff8f6b">못 찾음</span>')
      + '<br><br><b>cms-reviews-' + sd + '.json</b> 내려받음 → 건무에게 전달');
    window.__COLLECT_RUNNING = false;
  })();
})();
