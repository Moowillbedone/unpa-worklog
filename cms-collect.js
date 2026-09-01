/* ============================================================
 * 리뷰 검수 수집기 — cms-collect.js   (읽기 전용 · GET만)
 *
 * 1) 페이지가 부르는 /admin/reviews 호출에서 인증 헤더를 가로챈다
 * 2) 그 헤더로 해당 날짜의 검수대기 목록을 전부 가져온다
 * 3) 각 리뷰의 상세를 GET 으로 조회해 제품 매칭 여부·본문·사진을 모은다
 * 4) 판정용 JSON 을 내려받는다
 *
 * 하지 않는 것: 승인/반려/수정 등 상태를 바꾸는 요청(POST/PUT/PATCH/DELETE).
 *              전 과정이 GET 뿐이다.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }
  if (window.__COLLECT) { alert('이미 실행 중입니다.'); return; }
  window.__COLLECT = true;

  var API = 'https://api-v2.unpa.me';
  var AUTH = null;          /* 가로챈 인증 헤더 */
  var OUT = { at: new Date().toISOString(), pageUrl: location.href, range: null,
              totalCount: 0, list: [], details: [], detailEndpoint: null, probes: [] };

  /* ── 패널 ── */
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0e1a16;color:#e8f1ed;'
    + 'border:1px solid #2fb87f;border-radius:13px;padding:15px 18px;'
    + 'font:12.5px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:340px';
  document.body.appendChild(box);
  function say(html) {
    box.innerHTML = '<b style="color:#3ddc97">📥 리뷰 수집</b><div style="margin-top:8px;color:#9fb4ab">'
      + html + '</div><div style="margin-top:8px;font-size:11px;color:#6b7f77">GET 전용 · 상태 변경 없음</div>';
  }
  say('인증 정보 확인 중…');

  /* ── 인증 헤더 가로채기 ── */
  function grab(headers) {
    try {
      if (!headers) return;
      var h = {};
      if (headers.forEach) headers.forEach(function (v, k) { h[k.toLowerCase()] = v; });
      else if (typeof headers === 'object') Object.keys(headers).forEach(function (k) { h[k.toLowerCase()] = headers[k]; });
      if (h.authorization) AUTH = h.authorization;
    } catch (e) {}
  }
  var oF = window.fetch;
  window.fetch = function () {
    var a = arguments, u = String((a[0] && a[0].url) || a[0] || '');
    try {
      if (u.indexOf('/admin/') >= 0) {
        if (a[0] && a[0].headers) grab(a[0].headers);
        if (a[1] && a[1].headers) grab(a[1].headers);
      }
    } catch (e) {}
    return oF.apply(this, a);
  };
  var OX = XMLHttpRequest.prototype.open, OSH = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return OX.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (String(k).toLowerCase() === 'authorization' && String(this.__u).indexOf('/admin/') >= 0) AUTH = v; } catch (e) {}
    return OSH.apply(this, arguments);
  };

  function H() {
    var h = { 'Accept': 'application/json' };
    if (AUTH) h['Authorization'] = AUTH;
    return h;
  }
  function get(url) {
    return oF.call(window, url, { headers: H(), credentials: 'include' })
      .then(function (r) { return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t.slice(0, 400) };
      }); });
  }

  /* ── 조회 조건 ── */
  var qs = new URLSearchParams(location.search);
  var sd = qs.get('startDate'), ed = qs.get('endDate');
  if (!sd || !ed) { say('<b style="color:#ff8f6b">날짜가 없는 화면입니다.</b><br>목록에서 날짜를 지정한 주소로 이동한 뒤 다시 실행해주세요.'); return; }
  OUT.range = { startDate: sd, endDate: ed, beforeApproval: qs.get('beforeApproval') === 'true' };

  /* ── [검색] 을 눌러 페이지가 API 를 부르게 하고, 그때 헤더를 잡는다 ── */
  say('인증 정보를 잡기 위해 <b>[검색]</b> 을 한 번 누릅니다…');
  var searchBtn = [].slice.call(document.querySelectorAll('button')).filter(function (b) {
    return (b.textContent || '').trim() === '검색';
  })[0];
  if (searchBtn) searchBtn.click();

  setTimeout(run, 2500);

  async function run() {
    if (!AUTH) {
      say('<b style="color:#ff8f6b">인증 정보를 못 잡았습니다.</b><br>화면에서 <b>[검색]</b> 을 직접 한 번 누른 뒤,'
        + ' 이 스크립트를 다시 실행해주세요.');
      return;
    }

    /* 1) 목록 — 페이지를 넘겨가며 전부 */
    var page = 1, all = [], total = 0;
    while (page <= 30) {
      var u = API + '/admin/reviews?pageSize=100&startDate=' + sd + '&endDate=' + ed
            + (OUT.range.beforeApproval ? '&beforeApproval=true' : '')
            + '&page=' + page + '&field=CREATED_AT&direction=desc';
      say('목록 수집 중… ' + all.length + '건');
      var r = await get(u);
      if (r.status !== 200 || !r.json) {
        say('<b style="color:#ff8f6b">목록 조회 실패 (HTTP ' + r.status + ')</b><br>' + r.text.slice(0, 150));
        return;
      }
      total = r.json.totalCount || 0;
      var rows = r.json.result || [];
      all = all.concat(rows);
      if (rows.length < 100 || all.length >= total) break;
      page++;
    }
    OUT.totalCount = total;
    OUT.list = all;

    /* 2) 상세 엔드포인트 탐색 — 첫 건으로 후보를 GET 해본다 */
    if (all.length) {
      var id = all[0].id;
      var cands = [
        API + '/admin/reviews/' + id,
        API + '/admin/review/' + id,
        API + '/admin/reviews/' + id + '/detail'
      ];
      for (var i = 0; i < cands.length; i++) {
        say('상세 조회 방식 확인 중… (' + (i + 1) + '/' + cands.length + ')');
        var pr = await get(cands[i]);
        OUT.probes.push({ url: cands[i].replace(String(id), '{id}'), status: pr.status,
                          keys: pr.json ? Object.keys(pr.json).slice(0, 40) : [], head: pr.text.slice(0, 200) });
        if (pr.status === 200 && pr.json) { OUT.detailEndpoint = cands[i].replace(String(id), '{id}'); break; }
      }
    }

    /* 3) 각 리뷰 상세 */
    if (OUT.detailEndpoint) {
      for (var k = 0; k < all.length; k++) {
        say('상세 수집 중… ' + (k + 1) + ' / ' + all.length);
        var du = OUT.detailEndpoint.replace('{id}', all[k].id);
        var dr = await get(du);
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
      + OUT.details.length + '</b>건<br>상세 방식: ' + (OUT.detailEndpoint ? '찾음' : '<span style="color:#ff8f6b">못 찾음</span>')
      + '<br><br><b>cms-reviews-' + sd + '.json</b> 내려받음 → 건무에게 전달');
  }
})();
