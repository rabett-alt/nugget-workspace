// 너겟 작업 사이트 v0.7 — 3섹션 + 콘텐츠 탭 / 실데이터만
const WORKER_URL = 'https://nugget.rabett.workers.dev/';
const DAY_LABELS_KR = ['일','월','화','수','목','금','토'];

function mediaTypeToFormat(t) {
  if (t === 8) return '캐러셀';
  if (t === 2) return '릴스';
  return '단일 포스트';
}

async function fetchWorkerWithRetry(maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const r = await fetch(WORKER_URL + '?t=' + Date.now(), { cache: 'no-store' });
      const d = await r.json();
      const postCount = (d.all_posts || d.recent_posts || []).length;
      if (postCount > 0 || i === maxRetries) return d;
      await new Promise(res => setTimeout(res, 900));
    } catch (e) {
      if (i === maxRetries) throw e;
      await new Promise(res => setTimeout(res, 900));
    }
  }
}

// ───────── 탭 ─────────
function bindTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const page = tab.dataset.page;
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab);
      });
      document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === 'page-' + page);
      });
    });
  });
}

// ───────── 진입점 ─────────
bindTabs();

Promise.all([
  fetchWorkerWithRetry(),
  fetch('./data/followers_history.json').then(r => r.json()),
  fetch('./data/links.json').then(r => r.json())
]).then(([worker, hist, links]) => {

  // 팔로워 history: 기록된 시계열 + 오늘 Worker 값
  const todayStr = new Date().toISOString().slice(0, 10);
  const history = [...(hist.history || [])];
  if (worker && typeof worker.followers === 'number') {
    const last = history[history.length - 1];
    if (!last || last.date !== todayStr) {
      history.push({ date: todayStr, count: worker.followers });
    } else if (last.date === todayStr) {
      // 같은 날이면 Worker 최신값으로 갱신 (페이지 새로고침 반영)
      last.count = worker.followers;
    }
  }

  renderFollowers(history, worker);
  renderWeekly(worker);
  renderHero(worker);
  renderLinks(links);

  // 메모리 안내 (시계열이 짧을 때)
  const notice = document.getElementById('dataNotice');
  if (history.length < 7) {
    notice.classList.add('on');
    notice.textContent = `ℹ️ 팔로워 시계열은 ${history.length}일치만 누적됨. 매일 자동 누적 시스템 셋업 후 정밀화 예정.`;
  }
}).catch(e => {
  console.error(e);
  const notice = document.getElementById('dataNotice');
  notice.classList.add('on');
  notice.textContent = '⚠️ 데이터 로드 실패: ' + e.message;
});

// ───────── 섹션 1. Hero ─────────
function renderHero(worker) {
  const posts = (worker.all_posts && worker.all_posts.length ? worker.all_posts : worker.recent_posts) || [];
  if (!posts.length) return;
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const recentWeek = posts.filter(p => p.taken_at && (now - p.taken_at) <= weekMs);
  const pool = recentWeek.length ? recentWeek : posts;
  const best = pool.slice().sort((a, b) => {
    const sa = (a.likes || 0) + (a.views || 0) / 100;
    const sb = (b.likes || 0) + (b.views || 0) / 100;
    return sb - sa;
  })[0];
  if (!best) return;

  const fmt = mediaTypeToFormat(best.media_type);
  const firstLine = (best.caption || '').split('\n')[0].trim() || '(캡션 없음)';
  const rest = (best.caption || '').split('\n').slice(1).join(' ').trim();
  document.getElementById('heroSource').textContent = `@${worker.handle || 'nugget_zine'} · ${fmt}`;
  document.getElementById('heroTitle').textContent = firstLine;
  document.getElementById('heroSummary').textContent = rest.length > 200 ? rest.substring(0, 197) + '...' : rest;
  document.getElementById('heroLikes').textContent = (best.likes || 0).toLocaleString();
  document.getElementById('heroViews').textContent = (best.views || 0).toLocaleString();

  if (best.thumbnail) {
    const hero = document.querySelector('.hero-image');
    if (hero) {
      hero.style.backgroundImage =
        `linear-gradient(180deg, rgba(0,0,0,0.08) 35%, rgba(0,0,0,0.62) 100%), url("${best.thumbnail}")`;
      hero.style.backgroundSize = 'cover';
      hero.style.backgroundPosition = 'center';
    }
  }
}

// ───────── 섹션 2. 팔로워 꺾은선 ─────────
function renderFollowers(history, worker) {
  const num = worker.followers || (history[history.length - 1] && history[history.length - 1].count) || 0;
  document.getElementById('followersNum').textContent = num.toLocaleString();

  // 델타: 시계열 2점 이상이면 (오늘 - 처음) / 처음 %
  const deltaEl = document.getElementById('followersDelta');
  if (history.length >= 2) {
    const first = history[0].count;
    const last = history[history.length - 1].count;
    const pct = ((last - first) / first * 100);
    const sign = pct >= 0 ? '+' : '';
    deltaEl.textContent = `${sign}${pct.toFixed(1)}%`;
    deltaEl.style.color = pct >= 0 ? 'var(--green)' : 'var(--warm-1)';
  } else {
    deltaEl.textContent = '';
  }

  // 범위 라벨
  if (history.length >= 1) {
    const f = history[0].date, l = history[history.length - 1].date;
    document.getElementById('followersRange').textContent = `${f} → ${l}`;
  }

  // 꺾은선 (탁한 베이지)
  const data = history.slice();
  const chart = document.getElementById('followersChart');
  if (data.length === 0) {
    chart.innerHTML = '';
    return;
  }
  if (data.length === 1) {
    // 1점만: 중앙에 점 + 라벨
    chart.innerHTML = `
      <svg viewBox="0 0 200 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="0" y1="40" x2="200" y2="40" stroke="var(--beige-soft)" stroke-width="1" stroke-dasharray="3 4"/>
        <circle cx="180" cy="40" r="3.5" fill="var(--beige-deep)"/>
        <text x="100" y="68" text-anchor="middle" font-size="9" fill="var(--text-3)" letter-spacing="0.5">데이터 1점 — 매일 누적 예정</text>
      </svg>`;
