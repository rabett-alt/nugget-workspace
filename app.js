// 너겟 작업 사이트 v0.10 — 팔로워 차트 재설계 (D/W/M/Y + 두 시기 비교 + 이중 꺾은선)
var WORKER_URL = 'https://nugget.rabett.workers.dev/';
var DAYS = ['일','월','화','수','목','금','토'];
var BEIGE = '#a8957a';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function mtype(t) { return t === 8 ? '캐러셀' : (t === 2 ? '릴스' : '단일 포스트'); }
function fmtRel(ts) {
  if (!ts) return '';
  var diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return Math.floor(diff/60) + '분 전';
  if (diff < 86400) return Math.floor(diff/3600) + '시간 전';
  var d = Math.floor(diff/86400);
  if (d < 30) return d + '일 전';
  if (d < 365) return Math.floor(d/30) + '개월 전';
  return Math.floor(d/365) + '년 전';
}
function pad2(n){ return n<10?'0'+n:''+n; }
function fmtDate(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function parseDate(s){ var p=s.split('-'); return new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2])); }

// ─── 페이지 탭 (대시보드/콘텐츠) ───
function setupTabs() {
  document.querySelectorAll('.page-tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      var name = btn.dataset.page;
      document.querySelectorAll('.page-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.page-section').forEach(function(s){
        s.classList.toggle('active', s.dataset.pageSection === name);
      });
    });
  });
}

// ─── Worker (localStorage 캐시 + 점진 백오프 retry 6회) ───
var WORKER_CACHE_KEY = 'nugget_worker_cache_v1';

function loadWorkerCache() {
  try {
    var raw = localStorage.getItem(WORKER_CACHE_KEY);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    return obj && obj.data ? obj : null;
  } catch (e) { return null; }
}
function saveWorkerCache(data) {
  try { localStorage.setItem(WORKER_CACHE_KEY, JSON.stringify({at: Date.now(), data: data})); } catch (e) {}
}

// stale-while-revalidate: 캐시 있으면 즉시 resolve, fresh는 백그라운드 fetch 후 callback
function fetchOnce(timeoutMs) {
  return new Promise(function(resolve, reject){
    var ctrl = new AbortController();
    var t = setTimeout(function(){ ctrl.abort(); }, timeoutMs || 5000);
    fetch(WORKER_URL + '?t=' + Date.now(), { cache: 'no-store', signal: ctrl.signal })
      .then(function(r){ return r.json(); })
      .then(function(d){ clearTimeout(t); resolve(d); })
      .catch(function(e){ clearTimeout(t); reject(e); });
  });
}

// 백그라운드에서 fresh 시도 - 성공 시 onFresh(data) 콜백
function fetchFreshBackground(onFresh) {
  var tries = 0;
  var delays = [600, 1200, 2000, 3000, 4500];
  function attempt() {
    fetchOnce(6000).then(function(d){
      var n = ((d.all_posts || []).length) || ((d.recent_posts || []).length);
      var bad = (d && d.ok === false) || n === 0;
      if (!bad) {
        saveWorkerCache(d);
        if (typeof onFresh === 'function') onFresh(d);
        return;
      }
      if (tries < delays.length) { tries++; setTimeout(attempt, delays[tries-1]); }
    }).catch(function(){
      if (tries < delays.length) { tries++; setTimeout(attempt, delays[tries-1]); }
    });
  }
  attempt();
}

function fetchWorker() {
  // 1) 캐시가 있으면 즉시 resolve
  // 2) 동시에 백그라운드 fresh fetch → 성공 시 _onWorkerFresh 콜백 발동
  return new Promise(function(resolve, reject){
    var cached = loadWorkerCache();
    if (cached) {
      var ageMin = Math.round((Date.now() - cached.at) / 60000);
      // 즉시 캐시 응답
      resolve(Object.assign({}, cached.data, { _fromCache: true, _ageMin: ageMin }));
      // 백그라운드 fresh
      fetchFreshBackground(function(fresh){
        if (typeof window._onWorkerFresh === 'function') window._onWorkerFresh(fresh);
      });
      return;
    }
    // 캐시 없음 → 첫 방문자. 짧은 retry 후 결과 (성공 시 cache 저장)
    var tries = 0;
    var delays = [400, 800, 1500, 2500];
    function attempt() {
      fetchOnce(5000).then(function(d){
        var n = ((d.all_posts || []).length) || ((d.recent_posts || []).length);
        var bad = (d && d.ok === false) || n === 0;
        if (!bad) { saveWorkerCache(d); return resolve(d); }
        if (tries >= delays.length) return resolve(d);
        tries++; setTimeout(attempt, delays[tries-1]);
      }).catch(function(e){
        if (tries >= delays.length) return resolve({ ok:false, error:e.message, all_posts:[], recent_posts:[], followers: 0 });
        tries++; setTimeout(attempt, delays[tries-1]);
      });
    }
    attempt();
  });
}

// fresh 데이터 도착 시 화면 갱신 hook
window._onWorkerFresh = function(worker) {
  if (typeof renderHero === 'function') renderHero(worker);
  if (typeof renderWeekly === 'function') renderWeekly(worker);
  // followers 갱신
  if (typeof worker.followers === 'number') {
    var h = _state.hist.slice();
    var today = fmtDate(new Date());
    var last = h[h.length-1];
    if (!last || last.date !== today) h.push({date: today, count: worker.followers});
    else last.count = worker.followers;
    _state.hist = h;
    renderFollowersChart();
  }
  var n = $('dummyNotice');
  if (n) { n.classList.remove('on'); n.textContent = ''; }
};

// ─── 팔로워 차트 (D/W/M/Y) ───
var _state = { hist: [], period: 'Y' };

function periodBuckets(period) {
  // 각 period에 대한 prev/cur 범위 + 라벨
  var now = new Date(); now.setHours(0,0,0,0);
  if (period === 'D') {
    var yest = new Date(now); yest.setDate(now.getDate()-1);
    return {
      prevRange: [yest, yest], curRange: [now, now],
      prevLabel: '어제', curLabel: '오늘',
      footLabels: [fmtDate(yest), fmtDate(now)],
      bucketCount: 1
    };
  }
  if (period === 'W') {
    var weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());  // 이번 일요일 시작
    var lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate()-7);
    var lastWeekEnd = new Date(weekStart); lastWeekEnd.setDate(weekStart.getDate()-1);
    return {
      prevRange: [lastWeekStart, lastWeekEnd], curRange: [weekStart, now],
      prevLabel: '지난주', curLabel: '이번주',
      footLabels: DAYS,
      bucketCount: 7
    };
  }
  if (period === 'M') {
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var lastMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    var lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      prevRange: [lastMonthStart, lastMonthEnd], curRange: [monthStart, now],
      prevLabel: '지난달', curLabel: '이번달',
      footLabels: ['1', '8', '15', '22', '말'],
      bucketCount: 30
    };
  }
  // Y
  var yearStart = new Date(now.getFullYear(), 0, 1);
  var lastYearStart = new Date(now.getFullYear()-1, 0, 1);
  var lastYearEnd = new Date(now.getFullYear()-1, 11, 31);
  return {
    prevRange: [lastYearStart, lastYearEnd], curRange: [yearStart, now],
    prevLabel: (now.getFullYear()-1) + '년', curLabel: now.getFullYear() + '년',
    footLabels: ['J','F','M','A','M','J','J','A','S','O','N','D'],
    bucketCount: 12
  };
}

function inRange(dateStr, range) {
  var d = parseDate(dateStr);
  return d >= range[0] && d <= range[1];
}

function pickInRange(hist, range) {
  return hist.filter(function(h){ return inRange(h.date, range); });
}

function renderFollowersChart() {
  var period = _state.period;
  var hist = _state.hist;
  var b = periodBuckets(period);
  var prevData = pickInRange(hist, b.prevRange);
  var curData = pickInRange(hist, b.curRange);

  // 큰 숫자 두 칸
  $('prevLabel').textContent = b.prevLabel;
  $('curLabel').textContent = b.curLabel;
  if (prevData.length) {
    var pv = prevData[prevData.length-1].count;
    $('prevNum').textContent = pv.toLocaleString();
    $('prevMeta').textContent = prevData[0].date;
  } else {
    $('prevNum').textContent = '—';
    $('prevMeta').textContent = '데이터 누적 중';
  }
  if (curData.length) {
    var cv = curData[curData.length-1].count;
    $('curNum').textContent = cv.toLocaleString();
    $('curMeta').textContent = '현재까지 · ' + curData[curData.length-1].date;
  } else {
    $('curNum').textContent = '—';
    $('curMeta').textContent = '데이터 누적 중';
  }

  drawDualLine(prevData, curData, b);
}

function normalizeToBuckets(data, bucketCount) {
  // data: [{date,count}] → 길이 bucketCount, 각 인덱스에 (있으면 count, 없으면 null)
  if (!data.length) return new Array(bucketCount).fill(null);
  // 단순화: 마지막 N개를 균등 배치
  var arr = new Array(bucketCount).fill(null);
  if (data.length === 1) { arr[arr.length-1] = data[0].count; return arr; }
  if (data.length >= bucketCount) {
    for (var i = 0; i < bucketCount; i++) {
      var srcIdx = Math.round(i * (data.length-1) / (bucketCount-1));
      arr[i] = data[srcIdx].count;
    }
  } else {
    // 데이터를 끝 쪽으로 배치 (가장 최근 데이터가 우측 끝)
    var offset = bucketCount - data.length;
    for (var j = 0; j < data.length; j++) arr[offset+j] = data[j].count;
  }
  return arr;
}

function drawDualLine(prevData, curData, b) {
  var chartEl = $('followersChart');
  var footEl = $('followersFoot');
  // 빈 상태
  if (!prevData.length && !curData.length) {
    chartEl.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<line x1="0" y1="50" x2="100" y2="50" stroke="#d8d6d0" stroke-width="0.5" stroke-dasharray="2 3"/></svg>';
    footEl.className = 'fm-foot empty';
    footEl.textContent = '데이터 누적 중 (' + b.curLabel + ' 시작 후 자동 표시)';
    return;
  }

  var bucketCount = Math.max(b.bucketCount, 2);
  var prevArr = normalizeToBuckets(prevData, bucketCount);
  var curArr = normalizeToBuckets(curData, bucketCount);

  var allVals = prevArr.concat(curArr).filter(function(v){return v!==null;});
  var maxV = Math.max.apply(null, allVals);
  var minV = Math.min.apply(null, allVals);
  if (maxV === minV) { maxV += 1; minV = Math.max(0, minV-1); }
  var rng = maxV - minV;

  var w = 100, h = 60, padX = 2, padY = 6;
  function xAt(i){ return padX + (i/(bucketCount-1))*(w - padX*2); }
  function yAt(v){ return h - padY - ((v-minV)/rng)*(h - padY*2); }

  function pathFor(arr) {
    var s = '', started = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === null) continue;
      var cmd = started ? 'L' : 'M';
      s += cmd + ' ' + xAt(i).toFixed(2) + ',' + yAt(arr[i]).toFixed(2) + ' ';
      started = true;
    }
    return s.trim();
  }

  var prevPath = pathFor(prevArr);
  var curPath = pathFor(curArr);

  // 현재 라인 끝점 (마지막 non-null)
  var lastIdx = -1, lastVal = null;
  for (var k = curArr.length-1; k >= 0; k--) {
    if (curArr[k] !== null) { lastIdx = k; lastVal = curArr[k]; break; }
  }
  // 이전 라인 같은 X에서의 값 (없으면 마지막 non-null)
  var prevAtX = null;
  if (lastIdx >= 0 && prevArr[lastIdx] !== null) prevAtX = prevArr[lastIdx];
  else for (var k2 = prevArr.length-1; k2 >= 0; k2--) { if (prevArr[k2] !== null) { prevAtX = prevArr[k2]; break; } }

  var dotSvg = '';
  var bubbleHtml = '';
  if (lastVal !== null) {
    var cx = xAt(lastIdx), cy = yAt(lastVal);
    dotSvg = '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="2.4" fill="' + BEIGE + '" stroke="#fff" stroke-width="1"/>';
    if (prevAtX !== null) {
      var diff = lastVal - prevAtX;
      var sign = diff >= 0 ? '+' : '';
      var bubbleClass = diff >= 0 ? '' : ' neg';
      // 버블 위치는 % (svg viewBox 100x60 → % 변환)
      var leftPct = cx; // viewBox 100 == 100%
      var topPct = (cy/60)*100; // viewBox 60
      bubbleHtml = '<div class="delta-bubble' + bubbleClass + '" style="left:' + leftPct + '%;top:' + topPct + '%">' + sign + diff.toLocaleString() + '명</div>';
    }
  }

  // 영역 채움 (현재 라인)
  var areaPath = '';
  if (curPath) {
    var firstCur = -1; for (var f = 0; f < curArr.length; f++) if (curArr[f] !== null) { firstCur = f; break; }
    if (firstCur >= 0 && lastIdx >= 0) {
      areaPath = curPath + ' L ' + xAt(lastIdx).toFixed(2) + ',' + h + ' L ' + xAt(firstCur).toFixed(2) + ',' + h + ' Z';
    }
  }

  chartEl.innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      (areaPath ? '<path d="' + areaPath + '" fill="' + BEIGE + '" fill-opacity="0.15"/>' : '') +
      (prevPath ? '<path d="' + prevPath + '" fill="none" stroke="#c4c2bc" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0"/>' : '') +
      (curPath ? '<path d="' + curPath + '" fill="none" stroke="' + BEIGE + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
      dotSvg +
    '</svg>' + bubbleHtml;

  // foot 라벨
  footEl.className = 'fm-foot';
  footEl.innerHTML = b.footLabels.map(function(l){ return '<span>' + esc(l) + '</span>'; }).join('');
}

function setupPeriodTabs() {
  document.querySelectorAll('.fm-tab').forEach(function(btn){
    btn.addEventListener('click', function(){
      _state.period = btn.dataset.period;
      document.querySelectorAll('.fm-tab').forEach(function(b){ b.classList.toggle('active', b === btn); });
      renderFollowersChart();
    });
  });
}

// ─── Hero ───
function renderHero(worker) {
  var posts = (worker.all_posts && worker.all_posts.length) ? worker.all_posts : (worker.recent_posts || []);
  if (!posts.length) return;
  var now = Date.now(), weekMs = 7 * 24 * 3600 * 1000;
  var recent = posts.filter(function(p){ return p.taken_at && (now - p.taken_at) <= weekMs; });
  var pool = recent.length ? recent : posts;
  var best = pool.slice().sort(function(a,b){
    return ((b.likes||0) + (b.views||0)/100) - ((a.likes||0) + (a.views||0)/100);
  })[0];
  if (!best) return;
  var lines = (best.caption || '').split('\n');
  var firstLine = (lines[0] || '').trim() || '(캡션 없음)';
  var rest = lines.slice(1).join(' ').trim();
  $('heroSource').textContent = '@' + (worker.handle || 'nugget_zine') + ' · ' + mtype(best.media_type);
  $('heroTitle').textContent = firstLine;
  $('heroSummary').textContent = rest.length > 140 ? rest.substring(0, 137) + '...' : rest;
  $('heroLikes').textContent = (best.likes || 0).toLocaleString();
  $('heroComments').textContent = (best.views || 0).toLocaleString();
  $('heroWhen').textContent = fmtRel(best.taken_at);
  if (best.code) $('heroLink').href = 'https://www.instagram.com/p/' + best.code + '/';
  if (best.thumbnail) {
    var hero = document.querySelector('.hero-image');
    if (hero) {
      hero.style.backgroundImage = 'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.72) 100%), url("' + best.thumbnail + '")';
      hero.style.backgroundSize = 'cover';
      hero.style.backgroundPosition = 'center';
    }
  }
}

// ─── 주간 발행 ───
function renderWeekly(worker) {
  var posts = (worker.all_posts && worker.all_posts.length) ? worker.all_posts : (worker.recent_posts || []);
  var now = Date.now(), weekMs = 7 * 24 * 3600 * 1000;
  var dayCount = [0,0,0,0,0,0,0];
  posts.forEach(function(p){
    if (!p.taken_at || (now - p.taken_at) > weekMs) return;
    dayCount[new Date(p.taken_at).getDay()] += 1;
  });
  var order = [1,2,3,4,5,6,0];
  var weekly = order.map(function(i){ return {day: DAYS[i], count: dayCount[i]}; });
  var total = weekly.reduce(function(s,d){return s+d.count;}, 0);
  $('weeklyTotal').textContent = total;
  $('weeklyAvg').textContent = (total/7).toFixed(1);
  var max = Math.max.apply(null, weekly.map(function(d){return d.count;}).concat([1]));
  var peakIdx = -1;
  for (var k = 0; k < weekly.length; k++) {
    if (weekly[k].count === max && max > 0) { peakIdx = k; break; }
  }
  $('weeklyBars').innerHTML = weekly.map(function(d, i){
    var bh = Math.max((d.count / max) * 56, 8);
    var peak = (i === peakIdx) ? ' peak' : '';
    return '<div class="col"><div class="bar' + peak + '" style="height:' + bh + 'px"></div><div class="day' + peak + '">' + d.day + '</div></div>';
  }).join('');
}

// ─── 콘텐츠 페이지 ───
function renderLinks(links) {
  if (!links || !Array.isArray(links.categories)) return;
  $('linksGrid').innerHTML = links.categories.map(function(cat){
    var badgeClass = cat.region === '국내' ? 'kr' : 'intl';
    var rows = cat.items.map(function(it){
      return '<a class="link-row" data-name="' + esc((it.name + ' ' + (it.note||'')).toLowerCase()) + '" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
        '<div><div class="name">' + esc(it.name) + '</div><div class="note">' + esc(it.note || '') + '</div></div>' +
        '<span class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg></span></a>';
    }).join('');
    return '<div class="links-card"><div class="head"><div class="title">' + esc(cat.label) + '</div>' +
      '<span class="badge ' + badgeClass + '">' + cat.region + ' · ' + cat.type + ' · ' + cat.items.length + '</span></div>' +
      rows + '<div class="links-empty" style="display:none">필터 결과 없음</div></div>';
  }).join('');
}

function applyLinksFilter(q) {
  q = (q || '').trim().toLowerCase();
  var hint = $('linksFilterHint');
  var total = 0, visible = 0;
  document.querySelectorAll('.links-card').forEach(function(card){
    var rows = card.querySelectorAll('.link-row');
    var localVisible = 0;
    rows.forEach(function(row){
      var hit = !q || row.dataset.name.indexOf(q) !== -1;
      row.classList.toggle('filter-hidden', !hit);
      if (hit) localVisible++;
      total++; if (hit) visible++;
    });
    var empty = card.querySelector('.links-empty');
    if (empty) empty.style.display = (q && localVisible === 0) ? 'block' : 'none';
  });
  if (hint) hint.textContent = q ? (visible + '/' + total + ' 매칭') : '';
}

function updateSyncTime() {
  var t = new Date();
  setT('syncTime', '동기화 ' + pad2(t.getHours()) + ':' + pad2(t.getMinutes()));
}

// ─── 진입점 ───
setupTabs();
setupPeriodTabs();

function setT(id, txt) { var el = $(id); if (el) el.textContent = txt; }
function loadAll() {
  setT('syncTime', '동기화 중...');
  return Promise.all([
    fetchWorker(),
    fetch('./data/followers_history.json?t=' + Date.now()).then(function(r){return r.json();}).catch(function(){return {history:[]};}),
    fetch('./data/links.json?t=' + Date.now()).then(function(r){return r.json();}).catch(function(){return {categories:[]};})
  ]).then(function(arr){
    var worker = arr[0], hist = arr[1], links = arr[2];
    // history에 오늘 worker 값 push
    var h = (hist.history || []).slice();
    var today = fmtDate(new Date());
    if (worker && typeof worker.followers === 'number') {
      var last = h[h.length-1];
      if (!last || last.date !== today) h.push({date: today, count: worker.followers});
      else last.count = worker.followers;
    }
    _state.hist = h;
    renderFollowersChart();
    renderHero(worker);
    renderWeekly(worker);
    renderLinks(links);
    updateSyncTime();
    // 캐시·빈응답 안내
    var n = $('dummyNotice');
    var posts = (worker.all_posts || worker.recent_posts || []);
    if (worker._fromCache) {
      n.textContent = '⚠️ Worker 응답 지연. 캐시 데이터 표시 중 (' + worker._ageMin + '분 전 데이터). 새로고침으로 재시도.';
      n.classList.add('on');
    } else if (!posts.length) {
      n.textContent = '⚠️ 인스타 API 일시적 지연. 잠시 후 새로고침 ↻ 눌러주세요.';
      n.classList.add('on');
      $('heroTitle').textContent = '데이터 동기화 대기 중';
    } else {
      n.classList.remove('on');
      n.textContent = '';
    }
  }).catch(function(e){
    console.error(e);
    setT('syncTime', '동기화 실패');
    var n = $('dummyNotice');
    if (n) { n.textContent = '⚠️ 데이터 로드 실패: ' + e.message; n.classList.add('on'); }
  });
}

loadAll();
var refreshBtn = $('refreshBtn');
if (refreshBtn) refreshBtn.addEventListener('click', loadAll);
var filterInput = $('linksFilter');
if (filterInput) filterInput.addEventListener('input', function(e){ applyLinksFilter(e.target.value); });


// ─── v0.11: 전역 검색 ───
var _searchIndex = [];

function buildSearchIndex(worker, links) {
  var idx = [];
  // 게시물 (Worker)
  var posts = (worker && (worker.all_posts || worker.recent_posts)) || [];
  posts.forEach(function(p){
    var first = (p.caption || '').split('\n')[0].trim();
    idx.push({
      group: '인스타 게시물',
      label: first || '(캡션 없음)',
      meta: mtype(p.media_type) + ' · ' + (p.likes || 0).toLocaleString() + '♥',
      target: 'hero',
      payload: p,
      hay: (first + ' ' + (p.caption || '')).toLowerCase()
    });
  });
  // 매체/커뮤니티
  if (links && links.categories) {
    links.categories.forEach(function(cat){
      cat.items.forEach(function(it){
        idx.push({
          group: cat.label,
          label: it.name,
          meta: it.note || '',
          target: 'link',
          payload: { url: it.url, name: it.name, region: cat.region },
          hay: (it.name + ' ' + (it.note || '') + ' ' + cat.label).toLowerCase()
        });
      });
    });
  }
  // 섹션 키워드
  ['팔로워 추이', '주간 발행', '이번 주 베스트', '발행 형태', '최근 발행'].forEach(function(k){
    idx.push({
      group: '대시보드',
      label: k,
      meta: '섹션으로 이동',
      target: 'section',
      payload: { key: k },
      hay: k.toLowerCase()
    });
  });
  _searchIndex = idx;
}

function flashHighlight(el) {
  if (!el) return;
  el.classList.remove('search-highlight');
  void el.offsetWidth;
  el.classList.add('search-highlight');
  setTimeout(function(){ el.classList.remove('search-highlight'); }, 3100);
}

function navigateTo(item) {
  // 콘텐츠 페이지 항목이면 콘텐츠 탭 활성
  var sectionMap = {
    '팔로워 추이': '.followers-mini',
    '주간 발행': '.weekly-card',
    '이번 주 베스트': '.hero-card',
    '발행 형태': '.formats-row',
    '최근 발행': '.recent-list'
  };
  if (item.target === 'hero') {
    document.querySelector('.page-tab[data-page="dashboard"]').click();
    var hero = document.querySelector('.hero-card');
    hero.scrollIntoView({behavior:'smooth', block:'center'});
    flashHighlight(hero);
  } else if (item.target === 'section') {
    document.querySelector('.page-tab[data-page="dashboard"]').click();
    var sel = sectionMap[item.payload.key];
    var el = sel ? document.querySelector(sel) : null;
    if (el) { el.scrollIntoView({behavior:'smooth', block:'center'}); flashHighlight(el); }
  } else if (item.target === 'link') {
    document.querySelector('.page-tab[data-page="content"]').click();
    setTimeout(function(){
      // 콘텐츠 페이지에서 해당 link-row 찾기
      var rows = document.querySelectorAll('.link-row');
      for (var i = 0; i < rows.length; i++) {
        var nameEl = rows[i].querySelector('.name');
        if (nameEl && nameEl.textContent === item.payload.name) {
          rows[i].scrollIntoView({behavior:'smooth', block:'center'});
          flashHighlight(rows[i]);
          break;
        }
      }
    }, 120);
  }
}

function runGlobalSearch(q) {
  var res = $('gsResults');
  q = (q || '').trim().toLowerCase();
  if (!q) { res.hidden = true; $('gsClear').style.display='none'; return; }
  $('gsClear').style.display = 'inline-block';
  var hits = _searchIndex.filter(function(it){ return it.hay.indexOf(q) !== -1; }).slice(0, 30);
  if (!hits.length) {
    res.innerHTML = '<div class="gs-empty">검색 결과 없음</div>';
    res.hidden = false;
    return;
  }
  // group별
  var groups = {};
  hits.forEach(function(h){ (groups[h.group] = groups[h.group] || []).push(h); });
  var html = '';
  Object.keys(groups).forEach(function(g){
    html += '<div class="gs-group-title">' + esc(g) + '</div>';
    groups[g].forEach(function(h, i){
      var lbl = h.label.length > 60 ? h.label.substring(0,57) + '...' : h.label;
      html += '<div class="gs-item" data-grp="' + esc(g) + '" data-idx="' + i + '"><span class="name">' + esc(lbl) + '</span><span class="meta">' + esc(h.meta) + '</span></div>';
    });
  });
  res.innerHTML = html;
  res.hidden = false;
  res.querySelectorAll('.gs-item').forEach(function(el){
    el.addEventListener('click', function(){
      var grp = el.dataset.grp, idx = parseInt(el.dataset.idx, 10);
      var item = groups[grp][idx];
      navigateTo(item);
      res.hidden = true;
      $('globalSearch').value = '';
      $('gsClear').style.display = 'none';
    });
  });
}

(function(){
  var input = $('globalSearch');
  if (input) {
    input.addEventListener('input', function(e){ runGlobalSearch(e.target.value); });
    document.addEventListener('click', function(e){
      var wrap = e.target.closest('.global-search-wrap');
      if (!wrap) $('gsResults').hidden = true;
    });
  }
  var clear = $('gsClear');
  if (clear) clear.addEventListener('click', function(){
    $('globalSearch').value = '';
    runGlobalSearch('');
    $('globalSearch').focus();
  });
})();

var _origLoadAll = loadAll;
loadAll = function(){
  return _origLoadAll().then(function(){
    return Promise.all([
      fetch(WORKER_URL + '?t='+Date.now(), {cache:'no-store'}).then(function(r){return r.json();}).catch(function(){return {};}),
      fetch('./data/links.json?t='+Date.now()).then(function(r){return r.json();}).catch(function(){return {categories:[]};})
    ]).then(function(arr){ buildSearchIndex(arr[0], arr[1]); });
  });
};
setTimeout(function(){
  Promise.all([
    fetch(WORKER_URL + '?t='+Date.now(), {cache:'no-store'}).then(function(r){return r.json();}).catch(function(){return {};}),
    fetch('./data/links.json?t='+Date.now()).then(function(r){return r.json();}).catch(function(){return {categories:[]};})
  ]).then(function(arr){ buildSearchIndex(arr[0], arr[1]); });
}, 2000);

// ─── v0.12: silent refresh (30초마다 + 탭 가시화 시) + 검색 키보드 네비 ───
var _silentTimer = null;
function startSilentRefresh() {
  if (_silentTimer) clearInterval(_silentTimer);
  _silentTimer = setInterval(function(){
    if (document.hidden) return;
    if (typeof loadAll === 'function') loadAll();
  }, 30000);
}
document.addEventListener('visibilitychange', function(){
  if (!document.hidden && typeof loadAll === 'function') loadAll();
});
startSilentRefresh();

// 검색 키보드 네비 (↑↓ Enter ESC)
(function(){
  var inp = $('globalSearch');
  var res = $('gsResults');
  if (!inp || !res) return;
  var activeIdx = -1;
  function items(){ return res.querySelectorAll('.gs-item'); }
  function setActive(idx){
    var its = items();
    its.forEach(function(el, i){ el.classList.toggle('kbd-active', i === idx); });
    var el = its[idx];
    if (el) el.scrollIntoView({block:'nearest'});
    activeIdx = idx;
  }
  inp.addEventListener('keydown', function(e){
    var its = items();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (res.hidden) return;
      setActive(Math.min(its.length-1, activeIdx+1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(0, activeIdx-1));
    } else if (e.key === 'Enter') {
      var el = its[activeIdx >= 0 ? activeIdx : 0];
      if (el) { e.preventDefault(); el.click(); }
    } else if (e.key === 'Escape') {
      res.hidden = true; inp.blur();
    } else {
      activeIdx = -1;
    }
  });
  // 입력 후 첫 항목 자동 활성화
  inp.addEventListener('input', function(){
    setTimeout(function(){ var its = items(); if (its.length) setActive(0); }, 60);
  });
})();
