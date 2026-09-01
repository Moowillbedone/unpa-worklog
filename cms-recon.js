/* ============================================================
 * CMS 구조 정찰기 — cms-recon.js   (읽기 전용)
 *
 * 목적: 리뷰 검수 자동화를 만들기 전에, 목록/상세 페이지가
 *       어떤 API를 쓰고 화면이 어떻게 구성돼 있는지 파악한다.
 *
 * 하지 않는 것: 클릭, 폼 전송, 새 요청 생성, 상태 변경.
 *              페이지가 스스로 부르는 것만 관찰해 기록한다.
 * ============================================================ */
(function () {
  'use strict';
  if (!location.host.includes('cms.unpa.me')) { alert('cms.unpa.me 에서 실행해주세요.'); return; }
  if (window.__RECON) { var b = document.getElementById('rcDl'); if (b) b.click(); return; }

  var L = window.__RECON = { url: location.href, at: new Date().toISOString(), calls: [], mutations: [], dom: {} };

  /* ── 네트워크 관찰 ── */
  function rec(method, url, status, body, reqBody) {
    var top = [], keys = [], sample = null, items = null;
    try {
      var j = typeof body === 'string' ? JSON.parse(body) : body;
      if (j && typeof j === 'object') {
        top = Object.keys(j).slice(0, 30);
        var arr = Array.isArray(j) ? j
          : (j.data && j.data.length ? j.data
          : (j.content && j.content.length ? j.content
          : (j.list && j.list.length ? j.list
          : (j.items && j.items.length ? j.items : null))));
        if (arr && arr.length) {
          keys = Object.keys(arr[0] || {});
          sample = arr[0];
          items = arr.slice(0, 200);            /* 전체 목록 보관 */
        } else sample = j;
      }
    } catch (e) {}
    var trim = function (o) {
      try {
        return JSON.parse(JSON.stringify(o, function (k, v) {
          return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
        }));
      } catch (e) { return null; }
    };
    L.calls.push({
      method: method, url: String(url).split('?')[0], query: String(url).split('?')[1] || '',
      status: status, topKeys: top, itemKeys: keys, sample: sample ? trim(sample) : null,
      itemCount: items ? items.length : 0,
      items: items ? trim(items) : null,
      reqBody: reqBody ? String(reqBody).slice(0, 500) : null
    });
    if (method && !/^GET$/i.test(method) && method !== '(이미로드됨)') {
      L.mutations.push({ method: method, url: String(url).split('?')[0],
                         query: String(url).split('?')[1] || '', status: status,
                         reqBody: reqBody ? String(reqBody).slice(0, 800) : null,
                         response: typeof body === 'string' ? body.slice(0, 800) : null });
    }
    draw();
  }

  var oF = window.fetch;
  window.fetch = function () {
    var a = arguments, u = (a[0] && a[0].url) || a[0];
    var p = oF.apply(this, a);
    try {
      p.then(function (r) {
        r.clone().text().then(function (t) {
          rec((a[1] && a[1].method) || 'GET', u, r.status, t, a[1] && a[1].body);
        }).catch(function () {});
      });
    } catch (e) {}
    return p;
  };

  var OX = XMLHttpRequest.prototype.open, OS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return OX.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    var x = this;
    this.addEventListener('load', function () {
      try { rec(x.__m || 'GET', x.__u, x.status, x.responseText, b); } catch (e) {}
    });
    return OS.apply(this, arguments);
  };

  try {
    performance.getEntriesByType('resource').forEach(function (e) {
      if (/\/api\/|\/admin\/|api-v2\.unpa\.me|\.json/.test(e.name)) {
        L.calls.push({ method: '(이미로드됨)', url: e.name.split('?')[0], query: e.name.split('?')[1] || '',
                       status: '-', topKeys: [], itemKeys: [], sample: null });
      }
    });
  } catch (e) {}

  /* ── 화면 구조 ── */
  function scanDom() {
    var d = {};
    d.title = document.title;
    d.path = location.pathname;
    d.isDetail = /\/review\/detail\//.test(location.pathname);
    d.isList = /\/review\/list\//.test(location.pathname);
    d.reviewId = (location.pathname.match(/detail\/(\d+)/) || [])[1] || null;

    d.detailLinks = [].slice.call(document.querySelectorAll('a[href*="/review/detail/"]'))
      .map(function (a) { return a.getAttribute('href'); }).slice(0, 80);

    var tb = document.querySelector('table');
    if (tb) {
      d.tableHead = [].slice.call(tb.querySelectorAll('thead th')).map(function (t) { return t.textContent.trim(); });
      d.tableRowCount = tb.querySelectorAll('tbody tr').length;
      d.tableRows = [].slice.call(tb.querySelectorAll('tbody tr')).slice(0, 5).map(function (tr) {
        return [].slice.call(tr.querySelectorAll('td')).map(function (td) { return td.textContent.trim().slice(0, 60); });
      });
    }

    /* 이미지 — 깨짐 여부까지 (좌측 상단 판별에 위치도 함께) */
    d.images = [].slice.call(document.images).slice(0, 40).map(function (im) {
      var r = im.getBoundingClientRect();
      return {
        src: (im.currentSrc || im.src || '').slice(0, 220), alt: im.alt || '',
        naturalW: im.naturalWidth, naturalH: im.naturalHeight,
        broken: !!(im.complete && im.naturalWidth === 0),
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height)
      };
    });

    /* 버튼 후보 — 클릭하지 않고 목록만 */
    d.buttons = [].slice.call(document.querySelectorAll(
        'button,a[role=button],input[type=button],input[type=submit],[class*=btn],[class*=Btn]'))
      .map(function (b) {
        return { tag: b.tagName.toLowerCase(), text: (b.textContent || b.value || '').trim().slice(0, 40),
                 cls: String(b.className || '').slice(0, 100), id: b.id || '', disabled: !!b.disabled };
      })
      .filter(function (b) { return b.text; }).slice(0, 60);

    /* 본문 후보 */
    d.textBlocks = [].slice.call(document.querySelectorAll('p,div,span,td,li'))
      .filter(function (e) { return e.children.length === 0 && e.textContent.trim().length > 25; })
      .slice(0, 30).map(function (e) {
        return { tag: e.tagName.toLowerCase(), cls: String(e.className || '').slice(0, 70),
                 text: e.textContent.trim().slice(0, 250) };
      });

    L.dom = d;
  }

  /* ── 패널 ── */
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;background:#0e1a16;color:#e8f1ed;'
    + 'border:1px solid #2fb87f;border-radius:13px;padding:14px 17px;'
    + 'font:12.5px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;'
    + 'box-shadow:0 10px 40px rgba(0,0,0,.5);max-width:330px';
  document.body.appendChild(box);

  function draw() {
    var api = L.calls.filter(function (c) { return c.itemKeys.length || c.topKeys.length; }).length;
    box.innerHTML =
      '<b style="color:#3ddc97">🔍 CMS 정찰 중</b>'
      + '<div style="margin-top:7px;color:#9fb4ab">API 기록 <b style="color:#f5c451">' + L.calls.length + '</b>건'
      + ' (구조 파악 ' + api + ')<br>상태변경 요청 <b style="color:#ff8f6b">' + L.mutations.length + '</b>건<br>페이지: '
      + (L.dom.isDetail ? '상세 #' + L.dom.reviewId : L.dom.isList ? '목록' : '기타')
      + '<br><span style="font-size:11.5px">목록 → 상세를 2~3개 열어보면 더 정확해집니다.</span></div>'
      + '<button id="rcDl" style="margin-top:10px;background:#3ddc97;color:#04130c;border:0;border-radius:8px;'
      + 'padding:8px 14px;font-weight:800;cursor:pointer;width:100%">JSON 내려받기</button>'
      + '<div style="margin-top:7px;font-size:11px;color:#6b7f77">읽기 전용 · 클릭/전송 없음</div>';
    var btn = document.getElementById('rcDl');
    if (btn) btn.onclick = dl;
  }

  function dl() {
    scanDom();
    var blob = new Blob([JSON.stringify(L, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cms-recon-' + (L.dom.reviewId || 'list') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  }

  scanDom(); draw();
  setInterval(scanDom, 3000);
})();
