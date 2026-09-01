/* ============================================================
 * 리뷰 검수 적용기 — cms-apply.js   (상태 변경 · 운영환경)
 *
 *  ⚠️ 이 도구는 실제로 CMS 상태를 바꿉니다(수정요청/미노출/검수완료).
 *     그래서 기본은 "미리보기"이고, 아무것도 전송하지 않습니다.
 *     [실제 전송] 버튼을 눌러야만 순차 실행합니다.
 *
 *  안전장치
 *   - 기본 미리보기: 로드 시 전송 0건. 계획만 보여줌.
 *   - 명시적 대상 목록만 처리(아래 TARGETS). 화면을 훑어 임의 실행 안 함.
 *   - [1건만] / [전체] 분리. 각 버튼 클릭 + confirm 2중 확인.
 *   - 건별 로그. 에러 시 즉시 중단.
 *   - 개수 상한(MAX). 초과 시 실행 거부.
 *   - 이미 처리된 건은 서버가 막아도(중복) 로그에 남김.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }

  try { var old = document.getElementById('cmsApplyBox'); if (old) old.remove(); } catch (e) {}
  if (window.__APPLY_RUNNING) { alert('이미 실행 중입니다. 잠시 후 다시 시도해주세요.'); return; }

  var API = 'https://api-v2.unpa.me';
  var MAX = 20;                              /* 안전 상한 */
  var AUTH = window.__COLLECT_AUTH || window.__BRAND_AUTH || window.__PROD_AUTH || window.__APPLY_AUTH || null;

  /* ── 처리 대상 (2026-08-24 · 제품 있음 → 수정요청) ──
     466786(닥터지)은 건무가 수동 처리 완료 → 제외 */
  var TARGETS = [
    { reviewId: 466814, action: 'revise', template: 'product_match', product: '아이보들 로션',       note: '남유네 · 아이보들 로션 [레몬버베나]' },
    { reviewId: 466780, action: 'revise', template: 'product_match', product: '너리싱 베리어 크림',   note: '바를 · 바를 너리싱 베리어 크림' }
  ];

  var TPL_URL = 'https://moowillbedone.github.io/unpa-worklog/templates.json';

  /* ── 인증 가로채기 ── */
  function grab(h) { try { if (!h) return; var o = {};
    if (h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; });
    else if (typeof h === 'object') Object.keys(h).forEach(function (k) { o[k.toLowerCase()] = h[k]; });
    if (o.authorization) { AUTH = o.authorization; window.__APPLY_AUTH = AUTH; window.__COLLECT_AUTH = AUTH; } } catch (e) {} }
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
        AUTH = v; window.__APPLY_AUTH = v; window.__COLLECT_AUTH = v; } } catch (e) {}
      return OSH.apply(this, arguments); }; }

  function H() { var h = { 'Accept': 'application/json', 'Content-Type': 'application/json' }; if (AUTH) h['Authorization'] = AUTH; return h; }

  /* GET (읽기) — 대상 리뷰 현재 상태 확인용 */
  function getJson(url) {
    return oF.call(window, url, { headers: { 'Accept': 'application/json', 'Authorization': AUTH || '' }, credentials: 'include' })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j }; }); })
      .catch(function (e) { return { status: 0, json: null }; });
  }
  /* 실제 상태변경 요청 */
  function send(method, url, body) {
    return oF.call(window, url, { method: method, headers: H(), credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, text: t.slice(0, 300) }; }); })
      .catch(function (e) { return { status: 0, json: null, text: String(e && e.message || e) }; });
  }

  /* 액션 → 요청 정의 */
  function buildReq(t, tplMap) {
    if (t.action === 'revise') {
      var tpl = tplMap[t.template];
      var body = tpl ? tpl.body.replace(/\{제품명\}/g, t.product) : null;
      return { method: 'POST', url: API + '/admin/reviews/' + t.reviewId + '/revise', body: { content: [body] }, human: '수정요청', preview: body };
    }
    if (t.action === 'hide')    return { method: 'PUT',  url: API + '/admin/reviews/' + t.reviewId, body: { visible: false }, human: '미노출', preview: 'visible=false' };
    if (t.action === 'approve') return { method: 'POST', url: API + '/admin/reviews/' + t.reviewId + '/approve', body: {}, human: '검수완료', preview: 'approve {}' };
    return null;
  }

  /* ── 패널 ── */
  var box = document.createElement('div');
  box.id = 'cmsApplyBox';
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#12100a;color:#f3ede0;'
    + 'border:1px solid #d99b2b;border-radius:13px;padding:16px 18px;'
    + 'font:12.5px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 12px 44px rgba(0,0,0,.55);max-width:400px;max-height:88vh;overflow:auto';
  document.body.appendChild(box);

  var tplMap = {};
  var plan = [];
  var logLines = [];

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>]/g, function (c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }

  function renderPreview() {
    var rows = plan.map(function (p, i) {
      return '<div style="border:1px solid #3a3320;border-radius:8px;padding:9px 11px;margin-top:8px;background:#1b1810">'
        + '<b style="color:#f5c451">#' + p.t.reviewId + '</b> · ' + esc(p.req.human)
        + '<div style="color:#c7bda6;font-size:11.5px;margin-top:2px">' + esc(p.t.note || '') + '</div>'
        + (p.req.preview ? '<div style="color:#9fd7b6;font-size:11px;margin-top:5px;white-space:pre-wrap;border-top:1px dashed #3a3320;padding-top:5px">' + esc(p.req.preview) + '</div>' : '')
        + '</div>';
    }).join('');
    box.innerHTML =
      '<b style="color:#f0b429">⚙️ 리뷰 검수 적용기</b>'
      + '<div style="margin-top:6px;color:#d99b2b;font-weight:700;font-size:11.5px">⚠️ 실제 CMS를 변경합니다 · 지금은 미리보기(전송 0)</div>'
      + '<div style="margin-top:4px;color:#c7bda6;font-size:11.5px">대상 <b style="color:#fff">' + plan.length + '</b>건 · 인증 ' + (AUTH ? '<span style="color:#3ddc97">확보</span>' : '<span style="color:#ff8f6b">없음</span>') + '</div>'
      + rows
      + '<div style="display:flex;gap:7px;margin-top:12px;flex-wrap:wrap">'
      + '<button id="ap1" style="flex:1;background:#2b2410;color:#f5c451;border:1px solid #d99b2b;border-radius:8px;padding:9px;font-weight:800;cursor:pointer">1건만 전송</button>'
      + '<button id="apAll" style="flex:1;background:#d99b2b;color:#1a1408;border:0;border-radius:8px;padding:9px;font-weight:800;cursor:pointer">전체 ' + plan.length + '건 전송</button>'
      + '</div>'
      + '<div id="apLog" style="margin-top:10px;font-size:11.5px;color:#c7bda6"></div>'
      + '<div style="margin-top:8px;font-size:10.5px;color:#7a7360">에러 발생 시 즉시 중단 · 각 건 로그 기록</div>';
    document.getElementById('ap1').onclick = function () { runGuarded(1); };
    document.getElementById('apAll').onclick = function () { runGuarded(plan.length); };
  }

  function log(html) { logLines.push(html); var el = document.getElementById('apLog'); if (el) el.innerHTML = logLines.join('<br>'); }

  async function runGuarded(n) {
    if (window.__APPLY_RUNNING) return;
    if (!AUTH) { alert('인증 정보가 없습니다. 관리 화면에서 목록을 한 번 불러온 뒤 다시 실행해주세요.'); return; }
    if (plan.length > MAX) { alert('대상이 상한(' + MAX + ')을 초과했습니다. 실행을 거부합니다.'); return; }
    var slice = plan.slice(0, n);
    var summary = slice.map(function (p) { return '#' + p.t.reviewId + ' ' + p.req.human; }).join('\n');
    if (!confirm('실제로 다음 ' + slice.length + '건을 전송합니다. 되돌릴 수 없습니다.\n\n' + summary + '\n\n진행할까요?')) return;

    window.__APPLY_RUNNING = true;
    document.getElementById('ap1').disabled = true;
    document.getElementById('apAll').disabled = true;
    var results = [];
    for (var i = 0; i < slice.length; i++) {
      var p = slice[i];
      log('▶ #' + p.t.reviewId + ' ' + p.req.human + ' 전송…');
      var r = await send(p.req.method, p.req.url, p.req.body);
      var okStatus = (r.status >= 200 && r.status < 300);
      results.push({ reviewId: p.t.reviewId, action: p.t.action, status: r.status, ok: okStatus, response: r.json || r.text });
      if (okStatus) {
        log('&nbsp;&nbsp;<span style="color:#3ddc97">✓ ' + r.status + ' 완료</span>');
      } else {
        log('&nbsp;&nbsp;<span style="color:#ff8f6b">✗ ' + r.status + ' 실패 — 중단</span>');
        log('&nbsp;&nbsp;<span style="color:#c7bda6;font-size:11px">' + esc((r.text || '').slice(0, 160)) + '</span>');
        break;
      }
      await new Promise(function (res) { setTimeout(res, 300); });
    }
    /* 로그 저장 */
    var out = { at: new Date().toISOString(), results: results };
    var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'cms-apply-log-' + Date.now() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    var okN = results.filter(function (x) { return x.ok; }).length;
    log('<b style="color:' + (okN === results.length ? '#3ddc97' : '#ff8f6b') + '">완료: ' + okN + '/' + results.length + ' 성공 · 로그 내려받음</b>');
    window.__APPLY_RUNNING = false;
  }

  /* ── 초기화: 템플릿 로드 → 계획 수립 → 미리보기 ── */
  box.innerHTML = '<b style="color:#f0b429">⚙️ 적용기</b><div style="margin-top:8px;color:#c7bda6">템플릿 불러오는 중…</div>';
  oF.call(window, TPL_URL + '?t=' + Date.now()).then(function (r) { return r.json(); }).then(function (d) {
    (d.templates || []).forEach(function (t) { tplMap[t.key] = t; });
    plan = TARGETS.map(function (t) { return { t: t, req: buildReq(t, tplMap) }; }).filter(function (p) { return p.req; });
    var bad = plan.filter(function (p) { return p.t.action === 'revise' && (!p.req.body || !p.req.body.content[0]); });
    if (bad.length) { box.innerHTML = '<b style="color:#ff8f6b">템플릿 매칭 실패</b><div style="color:#c7bda6;margin-top:6px">템플릿 키가 templates.json과 맞지 않습니다.</div>'; return; }
    renderPreview();
  }).catch(function (e) {
    box.innerHTML = '<b style="color:#ff8f6b">템플릿 로드 실패</b><div style="color:#c7bda6;margin-top:6px">' + esc(String(e && e.message || e)) + '</div>';
  });
})();
