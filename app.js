// 너겟 작업 사이트 v0.8 - v0.6 3컬럼 그대로 + 3섹션만 활성 + 콘텐츠 탭
var WORKER_URL = 'https://nugget.rabett.workers.dev/';
var DAYS = ['일','월','화','수','목','금','토'];
var BEIGE = '#a8957a';

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[&<>"']/g, function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
function mtype(t) { return t === 8 ? '캐러셀' : (t === 2 ? '릴스' : '단일 포스트'); }

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
          tries++;
          setTimeout(attempt, 800);
        })
        .catch(function(e){
          if (tries >= 2) return reject(e);
          tries++;
          setTimeout(attempt, 800);
        });
    }
    attempt();
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
  var cur = hist[hist.length-1].count;
  $('followersNum').textContent = cur.toLocaleString();
  $('followersDelta').textContent = '';
  var sub = document.querySelector('.followers-mini .sub');
  if (sub) sub.textContent = '팔로워 · ' + hist[0].date + ' →';

  if (hist.length < 2) {
    $('followersChart').innerHTML =
      '<svg viewBox="0 0 100 36" preserveAspectRatio="none">' +
      '<line x1="0" y1="18" x2="100" y2="18" stroke="#d8d6d0" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<circle cx="96" cy="18" r="2.4" fill="' + BEIGE + '"/></svg>';
    return;
  }

  var w = 100, h = 36, padX = 2, padY = 6;
  var counts = hist.map(function(d){return d.count;});
  var max = Math.max.apply(null, counts), min = Math.min.apply(null, counts);
  var rng = (max - min) || 1;
  var pts = hist.map(function(d, i){
    return [
      padX + (i / (hist.length - 1)) * (w - padX * 2),
      h - padY - ((d.count - min) / rng) * (h - padY * 2)
    ];
  });
  var line = 'M ' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2);
  for (var i = 1; i < pts.length; i++) line += ' L ' + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
  var area = line + ' L ' + pts[pts.length-1][0].toFixed(2) + ',' + h + ' L ' + pts[0][0].toFixed(2) + ',' + h + ' Z';
  var dots = pts.map(function(p, i){
    var isLast = i === pts.length - 1;
    return '<circle cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + (isLast ? 2.4 : 1.8) + '" fill="' + BEIGE + '"/>';
  }).join('');
  $('followersChart').innerHTML =
    '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<path d="' + area + '" fill="' + BEIGE + '" fill-opacity="0.18"/>' +
    '<path d="' + line + '" fill="none" stroke="' + BEIGE + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots + '</svg>';
}

function renderHero(worker) {
  var posts = (worker.all_posts && worker.all_posts.length) ? worker.all_posts : (worker.recent_posts || []);
  if (!posts.length) return;
  var now = Date.now();
  var weekMs = 7 * 24 * 3600 * 1000;
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
  $('heroSummary').textContent = rest.length > 180 ? rest.substring(0, 177) + '...' : rest;
  $('heroLikes').textContent = (best.likes || 0).toLocaleString();
  $('heroComments').textContent = (best.views || 0).toLocaleString();
  if (best.thumbnail) {
    var hero = document.querySelector('.hero-image');
    if (hero) {
      hero.style.backgroundImage = 'linear-gradient(180deg, rgba(0,0,0,0.08) 35%, rgba(0,0,0,0.62) 100%), url("' + best.thumbnail + '")';
      hero.style.backgroundSize = 'cover';
      hero.style.backgroundPosition = 'center';
    }
  }
}

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
  var counts = weekly.map(function(d){return d.count;});
  var max = Math.max.apply(null, counts.concat([1]));
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

function renderLinks(links) {
  if (!links || !Array.isArray(links.categories)) return;
  $('linksGrid').innerHTML = links.categories.map(function(cat){
    var badgeClass = cat.region === '국내' ? 'kr' : 'intl';
    var rows = cat.items.map(function(it){
      return '<a class="link-row" href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
        '<div><div class="name">' + esc(it.name) + '</div><div class="note">' + esc(it.note || '') + '</div></div>' +
        '<span class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L17 7M17 7H8M17 7v9"/></svg></span>' +
        '</a>';
    }).join('');
    return '<div class="links-card">' +
      '<div class="head"><div class="title">' + esc(cat.label) + '</div>' +
      '<span class="badge ' + badgeClass + '">' + cat.region + ' · ' + cat.type + ' · ' + cat.items.length + '</span></div>' +
      rows + '</div>';
  }).join('');
}

setupTabs();
Promise.all([
  fetchWorker(),
  fetch('./data/followers_history.json').then(function(r){return r.json();}).catch(function(){return {history:[]};}),
  fetch('./data/links.json').then(function(r){return r.json();}).catch(function(){return {categories:[]};})
]).then(function(arr){
  var worker = arr[0], hist = arr[1], links = arr[2];
  renderFollowers(worker, hist);
  renderHero(worker);
  renderWeekly(worker);
  renderLinks(links);
}).catch(function(e){
  console.error(e);
  var n = $('dummyNotice');
  if (n) { n.textContent = '⚠️ 데이터 로드 실패: ' + e.message; n.classList.add('on'); }
});
