/* ============================================================
 * 제품검색 수집기 — cms-products.js   (읽기 전용 · GET만)
 *
 * 목적: 엑박(제품 매칭 실패) 리뷰들에 대해, 이미 확보한 brandId
 *       안에서 유저가 쓴 상품명을 분절 토큰으로 검색해 CMS에
 *       그 제품이 실제로 있는지 확인한다.
 *         - 있으면 → 정확한 상품명 복사해 "이미 있는 제품" 수정요청
 *         - 없으면 → 상품 등록 후 재등록 요청
 *
 * 하지 않는 것: 등록/승인/수정 등 상태 변경. 전부 GET 뿐.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }

  try { var old = document.getElementById('cmsProdBox'); if (old) old.remove(); } catch (e) {}
  if (window.__PROD_RUNNING) { window.__PROD_ABORT = true; }
  window.__PROD_RUNNING = true;
  window.__PROD_ABORT = false;

  var API = 'https://api-v2.unpa.me';
  var AUTH = window.__COLLECT_AUTH || window.__BRAND_AUTH || window.__PROD_AUTH || null;

  /* ── 대상 12건 (2026-08-24 엑박 · 정식 브랜드 확보분) ── */
  var TARGETS = [
    { reviewId: 466890, brand: '아이소이',     brandId: 732,    product: 'Pdrn 뚱하트 토닝패드' },
    { reviewId: 466889, brand: '원더바스',     brandId: 3035,   product: '붙이는 고농축 슬라이스세럼' },
    { reviewId: 466885, brand: '라이프프로젝트', brandId: 171040, product: '핸드크림 디어베이비' },
    { reviewId: 466852, brand: '올담',         brandId: 74348,  product: '올담미인 여성청결티슈' },
    { reviewId: 466815, brand: '남유네',       brandId: 59591,  product: '아이보들 수딩 젤' },
    { reviewId: 466814, brand: '남유네',       brandId: 59591,  product: '아이보들 로션 [레몬버베나]' },
    { reviewId: 466794, brand: '에이오유',     brandId: 69860,  product: '가루날림 쉐딩 토프핑' },
    { reviewId: 466786, brand: '닥터지',       brandId: 419,    product: '블랙 스네일 크림' },
    { reviewId: 466782, brand: '은율',         brandId: 157,    product: '마유 남자 올인원' },
    { reviewId: 466781, brand: '로레알파리',   brandId: 156,    product: '두피 딥클린 샴푸' },
    { reviewId: 466780, brand: '바를',         brandId: 158764, product: '바를 너리싱 베리어 크림' },
    { reviewId: 466775, brand: '위아바임',     brandId: 165397, product: '낙산균 프로바이오틱스 오' }
  ];

  var OUT = { at: new Date().toISOString(), pageUrl: location.href, authMode: null, items: [] };

  var box = document.createElement('div');
  box.id = 'cmsProdBox';
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0e1a16;color:#e8f1ed;'
    + 'border:1px solid #2fb87f;border-radius:13px;padding:15px 18px;'
    + 'font:12.5px/1.65 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:360px';
  document.body.appendChild(box);
  function say(html) {
    box.innerHTML = '<b style="color:#3ddc97">🔎 제품검색</b><div style="margin-top:8px;color:#9fb4ab">'
      + html + '</div><div style="margin-top:8px;font-size:11px;color:#6b7f77">GET 전용 · 상태 변경 없음</div>';
  }

  /* ── 인증 가로채기 ── */
  function grab(h) { try { if (!h) return; var o = {};
    if (h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; });
    else if (typeof h === 'object') Object.keys(h).forEach(function (k) { o[k.toLowerCase()] = h[k]; });
    if (o.authorization) { AUTH = o.authorization; window.__PROD_AUTH = AUTH; window.__COLLECT_AUTH = AUTH; } } catch (e) {} }
  var oF = window.__COLLECT_OF || window.fetch;
  window.__COLLECT_OF = oF;
  window.fetch = function () { var a = arguments;
    try { var u = String((a[0] && a[0].url) || a[0] || '');
      if (u.indexOf('/admin/') >= 0) { if (a[0] && a[0].headers) grab(a[0].headers); if (a[1] && a[1].headers) grab(a[1].headers); } } catch (e) {}
    return oF.apply(this, a); };
  if (!window.__COLLECT_XHOOK) { window.__COLLECT_XHOOK = true;
    var OSH = XMLHttpRequest.prototype.setRequestHeader, OX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return OX.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (String(k).toLowerCase() === 'authorization' && String(this.__u).indexOf('/admin/') >= 0) {
        AUTH = v; window.__PROD_AUTH = v; window.__COLLECT_AUTH = v; } } catch (e) {}
      return OSH.apply(this, arguments); }; }

  function H() { var h = { 'Accept': 'application/json' }; if (AUTH) h['Authorization'] = AUTH; return h; }
  function get(url) {
    return oF.call(window, url, { headers: H(), credentials: 'include' })
      .then(function (r) { return r.text().then(function (t) {
        var j = null; try { j = JSON.parse(t); } catch (e) {}
        return { status: r.status, json: j, text: t.slice(0, 200) }; }); })
      .catch(function (e) { return { status: 0, json: null, text: String(e && e.message || e) }; });
  }
  function listOf(j) { if (!j) return null;
    return Array.isArray(j.results) ? j.results : Array.isArray(j.result) ? j.result
      : Array.isArray(j.data) ? j.data : Array.isArray(j.content) ? j.content : Array.isArray(j) ? j : null; }
  function totalOf(j) { return (j && (j.totalCount || j.total || j.count)) || 0; }

  function purl(brandId, q, page, size) {
    return API + '/admin/products?approved=true&brandApproved=true&page=' + (page || 1)
      + '&pageSize=' + (size || 20) + '&brandId=' + brandId + (q ? '&q=' + encodeURIComponent(q) : '');
  }

  /* ── 상품명 → 분절 토큰 ── */
  function tokenize(name) {
    var clean = String(name).replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[0-9]+/g, ' ');
    var words = clean.split(/\s+/).filter(function (w) { return w.length >= 2; });
    var set = {};
    words.forEach(function (w) { set[w] = 1; });
    /* 긴 합성어는 앞 절반도 토큰으로 (예: 슬라이스세럼 → 슬라이스) */
    words.forEach(function (w) { if (w.length >= 6) set[w.slice(0, Math.ceil(w.length / 2))] = 1; });
    var t = Object.keys(set).slice(0, 6);
    if (!t.length) t = [String(name).slice(0, 4)];
    return t;
  }

  async function ensureAuth() {
    say('접근 방식 확인 중…');
    var r = await get(purl(TARGETS[0].brandId, null, 1, 1));
    if (r.status === 200 && listOf(r.json)) { OUT.authMode = AUTH ? 'header+cookie' : 'cookie'; return true; }
    var s = await get(location.origin + '/api/auth/session');
    if (s.json) { var found = null;
      (function walk(o) { if (!o || typeof o !== 'object' || found) return;
        Object.keys(o).forEach(function (k) { if (found) return; var v = o[k];
          if (typeof v === 'string' && v.length > 60 && /token/i.test(k)) found = v;
          else if (v && typeof v === 'object') walk(v); }); })(s.json);
      if (found) { AUTH = /^Bearer /i.test(found) ? found : 'Bearer ' + found; window.__PROD_AUTH = AUTH;
        var r2 = await get(purl(TARGETS[0].brandId, null, 1, 1));
        if (r2.status === 200 && listOf(r2.json)) { OUT.authMode = 'session-token'; return true; } } }
    say('<b style="color:#f5c451">인증 정보 대기 중…</b><br><br>제품/브랜드 관리 화면에서 <b>목록을 한 번 새로 불러</b>주세요.<br>'
      + '<span style="font-size:11.5px">요청이 잡히는 순간 자동으로 이어집니다.</span>');
    for (var i = 0; i < 150; i++) { if (window.__PROD_ABORT) return false;
      await new Promise(function (res) { setTimeout(res, 2000); });
      if (AUTH) { var r3 = await get(purl(TARGETS[0].brandId, null, 1, 1));
        if (r3.status === 200 && listOf(r3.json)) { OUT.authMode = 'intercepted'; return true; } } }
    return false;
  }

  (async function run() {
    var ok = await ensureAuth();
    if (window.__PROD_ABORT) { window.__PROD_RUNNING = false; return; }
    if (!ok) { say('<b style="color:#ff8f6b">인증 확보 실패</b><br>제품 관리 화면에서 목록을 새로 불러온 뒤 다시 실행해주세요.');
      window.__PROD_RUNNING = false; return; }

    for (var i = 0; i < TARGETS.length; i++) {
      if (window.__PROD_ABORT) break;
      var t = TARGETS[i];
      say('제품검색 중… <b>' + (i + 1) + ' / ' + TARGETS.length + '</b><br>' + t.brand + ' — ' + t.product);
      var rec = { reviewId: t.reviewId, brand: t.brand, brandId: t.brandId, product: t.product,
                  brandTotal: null, tokens: [], candidates: [] };
      /* 브랜드 전체 상품 수 */
      var base = await get(purl(t.brandId, null, 1, 1));
      rec.brandTotal = totalOf(base.json);
      var seen = {};
      var toks = tokenize(t.product);
      for (var k = 0; k < toks.length; k++) {
        if (window.__PROD_ABORT) break;
        var q = toks[k];
        var pr = await get(purl(t.brandId, q, 1, 20));
        var rows = listOf(pr.json) || [];
        rec.tokens.push({ q: q, status: pr.status, total: totalOf(pr.json), count: rows.length });
        rows.forEach(function (p) {
          if (p && p.id != null && !seen[p.id]) { seen[p.id] = 1;
            rec.candidates.push({ id: p.id, name: p.name || p.productName || p.title || '', matchedBy: q }); }
        });
        await new Promise(function (res) { setTimeout(res, 100); });
      }
      OUT.items.push(rec);
    }

    var blob = new Blob([JSON.stringify(OUT, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cms-products.json'; document.body.appendChild(a); a.click(); a.remove();

    var withHit = OUT.items.filter(function (x) { return x.candidates.length; }).length;
    say('<b style="color:#3ddc97">✓ 검색 완료</b><br>대상 <b>' + OUT.items.length + '</b>건 · 후보 잡힌 건 <b>'
      + withHit + '</b><br>인증: ' + OUT.authMode
      + '<br><br><b>cms-products.json</b> 내려받음 → 건무에게 전달');
    window.__PROD_RUNNING = false;
  })();
})();
