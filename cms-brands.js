/* ============================================================
 * 브랜드 목록 수집기 — cms-brands.js   (읽기 전용 · GET만)
 *
 * 목적: 브랜드 관리의 검색창은 서버를 부르지 않고 화면에서만
 *       걸러내므로(클라이언트 필터), 전체 브랜드 목록을 한 번
 *       받아 이름·slug 로 로컬 매칭할 수 있게 통째로 수집한다.
 *
 * 방법: 후보 엔드포인트를 GET 으로 찔러보고, 200 + 목록이 오는
 *       것으로 페이지를 끝까지 넘겨 전량 수집한다.
 *
 * 하지 않는 것: 등록/노출토글/수정 등 상태 변경. 전부 GET 뿐.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }

  try { var old = document.getElementById('cmsBrandBox'); if (old) old.remove(); } catch (e) {}
  if (window.__BRAND_RUNNING) { window.__BRAND_ABORT = true; }
  window.__BRAND_RUNNING = true;
  window.__BRAND_ABORT = false;

  var API = 'https://api-v2.unpa.me';
  var AUTH = window.__COLLECT_AUTH || window.__BRAND_AUTH || null;   /* 다른 수집기와 토큰 공유 */
  var OUT = { at: new Date().toISOString(), pageUrl: location.href,
              listEndpoint: null, totalCount: 0, brands: [], probes: [], authMode: null,
              qSupported: null, qSample: null };

  var box = document.createElement('div');
  box.id = 'cmsBrandBox';
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0e1a16;color:#e8f1ed;'
    + 'border:1px solid #2fb87f;border-radius:13px;padding:15px 18px;'
    + 'font:12.5px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:350px';
  document.body.appendChild(box);
  function say(html) {
    box.innerHTML = '<b style="color:#3ddc97">🏷️ 브랜드 수집</b><div style="margin-top:8px;color:#9fb4ab">'
      + html + '</div><div style="margin-top:8px;font-size:11px;color:#6b7f77">GET 전용 · 상태 변경 없음</div>';
  }

  /* ── 인증 가로채기 (계속 켜둔다) ── */
  function grab(h) {
    try {
      if (!h) return; var o = {};
      if (h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; });
      else if (typeof h === 'object') Object.keys(h).forEach(function (k) { o[k.toLowerCase()] = h[k]; });
      if (o.authorization) { AUTH = o.authorization; window.__BRAND_AUTH = AUTH; window.__COLLECT_AUTH = AUTH; }
    } catch (e) {}
  }
  var oF = window.__COLLECT_OF || window.fetch;
  window.__COLLECT_OF = oF;
  window.fetch = function () {
    var a = arguments;
    try { var u = String((a[0] && a[0].url) || a[0] || '');
      if (u.indexOf('/admin/') >= 0) { if (a[0] && a[0].headers) grab(a[0].headers); if (a[1] && a[1].headers) grab(a[1].headers); }
    } catch (e) {}
    return oF.apply(this, a);
  };
  if (!window.__COLLECT_XHOOK) {
    window.__COLLECT_XHOOK = true;
    var OSH = XMLHttpRequest.prototype.setRequestHeader, OX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return OX.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (String(k).toLowerCase() === 'authorization' && String(this.__u).indexOf('/admin/') >= 0) {
        AUTH = v; window.__BRAND_AUTH = v; window.__COLLECT_AUTH = v; } } catch (e) {}
      return OSH.apply(this, arguments);
    };
  }

  function H() { var h = { 'Accept': 'application/json' }; if (AUTH) h['Authorization'] = AUTH; return h; }
  function get(url) {
    return oF.call(window, url, { headers: H(), credentials: 'include' })
      .then(function (r) { return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t.slice(0, 200) };
      }); })
      .catch(function (e) { return { status: 0, json: null, text: String(e && e.message || e) }; });
  }
  function listOf(j) {
    if (!j || typeof j !== 'object') return null;
    if (Array.isArray(j.results)) return j.results;
    if (Array.isArray(j.result)) return j.result;
    if (Array.isArray(j.data)) return j.data;
    if (Array.isArray(j.content)) return j.content;
    if (Array.isArray(j.list)) return j.list;
    if (Array.isArray(j)) return j;
    return null;
  }
  function totalOf(j) { return (j && (j.totalCount || j.total || j.totalElements || j.count)) || 0; }

  /* 후보 엔드포인트 — 제품검색이 approved=true&brandApproved=true 였으므로 그 계열을 우선 */
  function cands(page, size, q) {
    var qp = q ? '&q=' + encodeURIComponent(q) : '';
    var base = '&page=' + page + '&pageSize=' + size + qp;
    return [
      API + '/admin/brands?approved=true' + base,
      API + '/admin/brands?approved=true&brandApproved=true' + base,
      API + '/admin/brands?' + base.slice(1),
      API + '/admin/brands?visible=true' + base
    ];
  }

  async function ensureAuth() {
    say('접근 방식 확인 중… (1/3 쿠키)');
    var probe = cands(1, 1, null);
    for (var i = 0; i < probe.length; i++) {
      var r = await get(probe[i]);
      OUT.probes.push({ url: probe[i].split('?')[0] + '?' + probe[i].split('?')[1].replace(/&?page=1&?/, '').replace('pageSize=1', 'pageSize=1'), status: r.status, hasList: !!listOf(r.json) });
      if (r.status === 200 && listOf(r.json)) { OUT.listEndpoint = probe[i]; OUT.authMode = AUTH ? 'header+cookie' : 'cookie'; return true; }
    }
    /* 세션 토큰 */
    say('접근 방식 확인 중… (2/3 세션)');
    var s = await get(location.origin + '/api/auth/session');
    if (s.json) {
      var found = null;
      (function walk(o) { if (!o || typeof o !== 'object' || found) return;
        Object.keys(o).forEach(function (k) { if (found) return; var v = o[k];
          if (typeof v === 'string' && v.length > 60 && /token/i.test(k)) found = v;
          else if (v && typeof v === 'object') walk(v); }); })(s.json);
      if (found) { AUTH = /^Bearer /i.test(found) ? found : 'Bearer ' + found; window.__BRAND_AUTH = AUTH;
        for (var j = 0; j < probe.length; j++) { var r2 = await get(cands(1, 1, null)[j]);
          if (r2.status === 200 && listOf(r2.json)) { OUT.listEndpoint = cands(1, 1, null)[j]; OUT.authMode = 'session-token'; return true; } } }
    }
    /* 가로채기 대기 — 화면 새로고침/탭 전환하면 목록이 다시 불려온다 */
    say('<b style="color:#f5c451">인증 정보 대기 중…</b><br><br>상단 <b>[검수 완료 브랜드] / [검수 필요]</b> 탭을<br>'
      + '<b>한 번 눌러</b>주세요.<br><span style="font-size:11.5px">목록이 다시 불려오는 순간 자동으로 이어집니다.</span>');
    for (var t = 0; t < 150; t++) {
      if (window.__BRAND_ABORT) return false;
      await new Promise(function (res) { setTimeout(res, 2000); });
      if (AUTH) { var pc = cands(1, 1, null);
        for (var m = 0; m < pc.length; m++) { var r3 = await get(pc[m]);
          if (r3.status === 200 && listOf(r3.json)) { OUT.listEndpoint = pc[m]; OUT.authMode = 'intercepted'; return true; } } }
    }
    return false;
  }

  function withPage(tmpl, page, size, q) {
    var base = tmpl.split('?')[0], p = tmpl.split('?')[1] || '';
    var sp = new URLSearchParams(p);
    sp.set('page', page); sp.set('pageSize', size);
    if (q != null) sp.set('q', q); else sp.delete('q');
    return base + '?' + sp.toString();
  }

  (async function run() {
    var ok = await ensureAuth();
    if (window.__BRAND_ABORT) { window.__BRAND_RUNNING = false; return; }
    if (!ok) {
      say('<b style="color:#ff8f6b">인증/엔드포인트 확보 실패</b><br><br>브랜드 관리 탭을 한 번 눌러 목록을 다시 불러온 뒤,<br>즐겨찾기를 한 번 더 눌러주세요.');
      window.__BRAND_RUNNING = false; return;
    }

    /* 전량 수집 */
    var page = 1, all = [], total = 0;
    while (page <= 60) {
      say('브랜드 수집 중… <b>' + all.length + '</b>개');
      var r = await get(withPage(OUT.listEndpoint, page, 100, null));
      var rows = listOf(r.json);
      if (r.status !== 200 || !rows) { say('<b style="color:#ff8f6b">목록 조회 실패 (HTTP ' + r.status + ')</b>'); break; }
      total = totalOf(r.json) || total;
      all = all.concat(rows);
      if (rows.length < 100 || (total && all.length >= total)) break;
      page++;
    }
    OUT.totalCount = total || all.length;
    OUT.brands = all.map(function (b) {
      return { id: b.id, name: b.name, slug: b.slug, productCount: b.productCount,
               visible: b.visible, approved: b.approved, brandApproved: b.brandApproved };
    });

    /* q 지원 여부 확인 — 지원하면 전량 캐시 없이도 서버검색 가능 */
    say('서버 검색(q) 지원 확인 중…');
    var probeName = (all[0] && all[0].name) || null;
    if (probeName) {
      var token = probeName.slice(0, 2);
      var qr = await get(withPage(OUT.listEndpoint, 1, 20, token));
      var qrows = listOf(qr.json);
      OUT.qSample = { token: token, status: qr.status, count: qrows ? qrows.length : null, total: totalOf(qr.json) };
      OUT.qSupported = !!(qrows && (totalOf(qr.json) < OUT.totalCount || qrows.length < all.length));
    }

    var blob = new Blob([JSON.stringify(OUT, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cms-brands.json'; document.body.appendChild(a); a.click(); a.remove();

    say('<b style="color:#3ddc97">✓ 수집 완료</b><br>브랜드 <b>' + OUT.brands.length + '</b>개 · 전체 ' + OUT.totalCount
      + '<br>엔드포인트: ' + OUT.listEndpoint.split('?')[0].replace(API, '')
      + '<br>서버검색(q): ' + (OUT.qSupported ? '지원' : '미지원/불명')
      + '<br><br><b>cms-brands.json</b> 내려받음 → 건무에게 전달');
    window.__BRAND_RUNNING = false;
  })();
})();
