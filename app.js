// 너겟 작업 사이트 v0.9 - hero 9:16 + 차트 월별 클릭 + (한 발 더) 게시일/원본링크/동기화/콘텐츠 검색
var WORKER_URL = 'https://nugget.rabett.workers.dev/';
var DAYS = ['일','월','화','수','목','금','토'];
var BEIGE = '#a8957a';
var MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

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

function fetchWorker() {
  return new Promise(function(resolve, reject){
    var tries = 0;
    function attempt() {
      fetch(WORKER_URL + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(d){
          var n = ((d.all_posts || []).length) || ((d.recent_posts || []).length);
          if (n > 0 || tries >= 2) return resolve(d);
          tries++; setTimeout(attempt, 800);
        })
        .catch(function(e){
          if (tries >= 2) return reject(e);
          tries++; setTimeout(attempt, 800);
        });
    }
    attempt();
  });
}

// 팔로워 - 일 단위 점 + 월 라벨 + 클릭 툴팁
var _historyState = [];

function showTooltip(item) {
  var box = $('followersTooltip');
  if (!box) return;
  box.classList.remove('placeholder');
  box.innerHTML = '<span class="ttl-date">' + item.date + '</span><span class="ttl-count">' + item.count.toLocaleString() + '명</span>';
  document.querySelectorAll('#followersChart svg circle.point').forEach(function(c){
    c.classList.toggle('active', c.dataset.date === item.date);
  });
}

function renderFollowers(worker, history) {
  var hist = (history && history.history) ? history.history.slice() : [];
  var today = new Date().toISOString().slice(0,10);
  if (worker && typeof worker.followers === 'number') {
    var last = hist[hist.length - 1];
    if (!last || last.date !== today) hist.push({date: today, count: worker.followers});
    else last.count = worker.followers;
  }
  if (!hist.length) return;
  _historyState = hist;
  var cur = hist[hist.length-1].count;
  $('followersNum').textContent = cur.toLocaleString();
  $('followersDelta').textContent = '';
  var sub = document.querySelector('.followers-mini .sub');
  if (sub) sub.textContent = '팔로워 · ' + hist[0].date + '부터';

  if (hist.length < 2) {
    $('followersChart').innerHTML =
      '<svg viewBox="0 0 100 36" preserveAspectRatio="none" width="100%" height="100%">' +
      '<line x1="0" y1="18" x2="100" y2="18" stroke="#d8d6d0" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<circle class="point" data-date="' + hist[0].date + '" data-idx="0" cx="96" cy="18" r="2.8" fill="' + BEIGE + '"/></svg>';
    $('followersMonths').innerHTML = '<span>' + hist[0].date.substring(5) + '</span>';
    bindChartClicks(hist);
    return;
  }

  var w = 100, h = 36, padX = 2, padY = 6;
  var counts = hist.map(function(d){return d.count;});
  var max = Math.max.apply(null, counts), min = Math.min.apply(null, counts);
  var rng = (max - min) || 1;
  var pts = hist.map(function(d, i){
    return [padX + (i / (hist.length - 1)) * (w - padX * 2), h - padY - ((d.count - min) / rng) * (h - padY * 2)];
  });
  var line = 'M ' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
  for (var i = 1; i < pts.length; i++) line += ' L ' + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
  var area = line + ' L ' + pts[pts.length-1][0].toFixed(2) + ',' + h + ' L ' + pts[0][0].toFixed(2) + ',' + h + ' Z';
  var dots = pts.map(function(p, i){
    return '<circle class="point" data-idx="' + i + '" data-date="' + hist[i].date + '" cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="2.2" fill="' + BEIGE + '"><title>' + hist[i].date + ' · ' + hist[i].count.toLocaleString() + '명</title></circle>';
  }).join('');
  $('followersChart').innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" width="100%" height="100%">' +
    '<path d="' + area + '" fill="' + BEIGE + '" fill-opacity="0.18"/>' +
    '<path d="' + line + '" fill="none" stroke="' + BEIGE + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots + '</svg>';

  // 월별 라벨 - hist에서 등장한 월들 가져옴
  var seenMonths = [];
  hist.forEach(function(d){
    var ym = d.date.substring(0, 7);
    if (seenMonths.indexOf(ym) === -1) seenMonths.push(ym);
  });
  $('followersMonths').innerHTML = seenMonths.map(function(ym){
    var m = parseInt(ym.split('-')[1], 10);
    return '<span>' + MONTHS[m-1] + '</span>';
  }).join('');

  bindChartClicks(hist);
}

function bindChartClicks(hist) {
  var chart = $('followersChart');
  if (!chart) return;
  chart.onclick = function(e){
    var t = e.target;
    if (t.tagName.toLowerCase() === 'circle' && t.classList.contains('point')) {
      var idx = parseInt(t.dataset.idx, 10);
      if (!isNaN(idx) && hist[idx]) showTooltip(hist[idx]);
    }
  };
  // 월 라벨 클릭 → 그 월 마지막 데이터 표시
  var ax = $('followersMonths');
  if (ax) {
    ax.onclick = function(e){
      if (e.target.tagName.toLowerCase() !== 'span') return;
      var label = e.target.textContent;
      var monthIdx = MONTHS.indexOf(label);
      if (monthIdx === -1) return;
      var pad = (monthIdx+1).toString().padStart(2,'0');
      var monthHist = hist.filter(function(d){ return d.date.substring(5,7) === pad; });
      if (monthHist.length) showTooltip(monthHist[monthHist.length-1]);
    };
  }
}

// Hero - 베스트 게시물 + 게시일 + 원본 링크
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

// 주간 발행
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

// 콘텐츠 리스트
var _linksState = null;
function renderLinks(links) {
  _linksState = links;
  if (!links || !Array.isArray(links.categories)) return;
  $('linksGrid').innerHTML = links.categories.map(function(cat){
    var badgeClass = cat.region === '국내' ? 'kr' : 'intl';
    var rows = cat.items.map(function(it){
      return '<a class="link-row" data-name="' + esc((it.name + ' ' + (it.note||'')).toLowerCase()) + '" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
        '<div><div class="name">' + esc(it.name) + '</div><div class="note">' + esc(it.note || '') + '</div></div>' +
        '<span class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg></span>' +
        '</a>';
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

// 동기화 시각
function updateSyncTime() {
  var t = new Date();
  var pad = function(n){return n<10?'0'+n:n;};
  $('syncTime').textContent = '동기화 ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
}

// 진입점
setupTabs();
function loadAll() {
  $('syncTime').textContent = '동기화 중...';
  return Promise.all([
    fetchWorker(),
    fetch('./data/followers_history.json?t=' + Date.now()).then(function(r){return r.json();}).catch(function(){return {history:[]};}),
    fetch('./data/links.json?t=' + Date.now()).then(function(r){return r.json();}).catch(function(){return {categories:[]};})
  ]).then(function(arr){
    renderFollowers(arr[0], arr[1]);
    renderHero(arr[0]);
    renderWeekly(arr[0]);
    renderLinks(arr[2]);
    updateSyncTime();
  }).catch(function(e){
    console.error(e);
    $('syncTime').textContent = '동기화 실패';
    var n = $('dummyNotice');
    if (n) { n.textContent = '⚠️ 데이터 로드 실패: ' + e.message; n.classList.add('on'); }
  });
}

loadAll();

// 새로고침 버튼
var refreshBtn = $('refreshBtn');
if (refreshBtn) refreshBtn.addEventListener('click', loadAll);

// 콘텐츠 필터
var filterInput = $('linksFilter');
if (filterInput) filterInput.addEventListener('input', function(e){ applyLinksFilter(e.target.value); });
