// 너겟 작업 사이트 v0.6 — Cloudflare Worker로 인스타 실데이터 연결
const WORKER_URL = 'https://nugget.rabett.workers.dev/';
const DAY_LABELS = ['일','월','화','수','목','금','토'];
const FORMAT_COLORS = { '캐러셀': '#1a1a1a', '릴스': '#6b6b6b', '단일 포스트': '#c4c4c4' };

// media_type: 1=이미지, 2=비디오/릴스, 8=캐러셀
function mediaTypeToFormat(t) {
  if (t === 8) return '캐러셀';
  if (t === 2) return '릴스';
  return '단일 포스트';
}

// Worker 응답 → 사이트가 쓰는 insta 구조로 변환
function transformWorker(w) {
  const posts = Array.isArray(w.all_posts) ? w.all_posts : (w.recent_posts || []);
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;

  // 요일별 카운트 (최근 7일)
  const dayCount = [0,0,0,0,0,0,0];
  posts.forEach(p => {
    const t = p.taken_at;
    if (!t) return;
    if (now - t > weekMs) return;
    const d = new Date(t).getDay();
    dayCount[d] += 1;
  });
  // 월~일 순서로
  const order = [1,2,3,4,5,6,0];
  const weekly_posts = order.map(i => ({ day: DAY_LABELS[i], count: dayCount[i] }));

  // 발행 형태 (최근 30건 기준)
  const formatMap = { '캐러셀': 0, '릴스': 0, '단일 포스트': 0 };
  posts.slice(0, 30).forEach(p => {
    formatMap[mediaTypeToFormat(p.media_type)] += 1;
  });
  const post_formats = Object.keys(formatMap)
    .filter(k => formatMap[k] > 0)
    .map(k => ({ type: k, count: formatMap[k], color: FORMAT_COLORS[k] }));

  // 최근 게시물 4건 (사이트가 쓰는 필드명으로 매핑)
  const recent_posts = (w.recent_posts || posts.slice(0, 6)).slice(0, 5).map(p => ({
    id: p.code || p.pk,
    title: (p.caption || '').split('\n')[0].trim() || '(캡션 없음)',
    format: mediaTypeToFormat(p.media_type),
    date: new Date(p.taken_at).toISOString().slice(0, 10),
    likes: p.likes || 0,
    views: p.views || 0,
    thumbnail: p.thumbnail
  }));

  // 베스트 게시물 (최근 7일 중 likes+views/100 최대)
  const recentWeek = posts.filter(p => p.taken_at && (now - p.taken_at <= weekMs));
  const pool = recentWeek.length ? recentWeek : posts;
  const best = pool.slice().sort((a, b) => {
    const sa = (a.likes || 0) + (a.views || 0) / 100;
    const sb = (b.likes || 0) + (b.views || 0) / 100;
    return sb - sa;
  })[0];

  return {
    handle: w.handle,
    followers_now: w.followers,
    following: w.following,
    posts_total: w.posts,
    profile_pic_url: w.profile_pic_url,
    full_name: w.full_name,
    weekly_posts,
    post_formats,
    recent_posts,
    best_post: best,
    raw_posts: posts
  };
}

// ─── 진입점 ─────────────────────────────────────────────────────────
Promise.all([
  fetch(WORKER_URL, { cache: 'no-store' }).then(r => r.json()),
  fetch('./data/ai_insight.json').then(r => r.json())
]).then(([workerData, ai]) => {
  const insta = transformWorker(workerData);

  // 인스타 실데이터 + AI 더미 = AI만 더미 알림
  if (ai._주의) {
    document.getElementById('dummyNotice').classList.add('on');
    document.getElementById('dummyNotice').textContent =
      '⚠️ 인스타 데이터는 실시간이지만, AI 비서 인사이트·hero 좌측 raw 항목은 더미입니다.';
  }

  renderFollowersSingle(insta);
  renderAI(ai);
  renderHeroFromInsta(insta.best_post);
  renderRecentFromInsta(insta.recent_posts);
  renderWeekly(insta.weekly_posts);
  renderFormats(insta.post_formats);
  renderProgress(insta.weekly_posts);
}).catch(e => {
  console.error('Worker fetch 실패:', e);
  // 폴백: 로컬 더미
  Promise.all([
    fetch('./data/insta.json').then(r => r.json()),
    fetch('./data/ai_insight.json').then(r => r.json()),
    fetch('./data/items.json').then(r => r.json())
  ]).then(([insta, ai, items]) => {
    document.getElementById('dummyNotice').classList.add('on');
    document.getElementById('dummyNotice').textContent =
      '⚠️ Worker 연결 실패 — 더미 데이터로 폴백 중. (' + e.message + ')';
    renderFollowersLegacy(insta.followers_30d);
    renderAI(ai);
    renderHeroLegacy(items.items[0]);
    renderRecentLegacy(insta.recent_posts);
    renderWeekly(insta.weekly_posts);
    renderFormats(insta.post_formats);
    renderProgress(insta.weekly_posts);
  });
});

// ─── 팔로워 (실데이터: 1시점) ─────────────────────────────────────
function renderFollowersSingle(insta) {
  document.getElementById('followersNum').textContent = (insta.followers_now || 0).toLocaleString();
  const delta = document.getElementById('followersDelta');
  delta.textContent = `게시물 ${insta.posts_total || 0}`;
  delta.style.background = 'rgba(0,0,0,0.05)';
  delta.style.color = 'var(--text-3)';
  // 추이 차트 영역: 1점만 있으므로 가는 점선으로 안내
  document.getElementById('followersChart').innerHTML = `
    <svg viewBox="0 0 100 36" preserveAspectRatio="none" style="width:100%;height:100%">
      <line x1="0" y1="18" x2="100" y2="18" stroke="var(--placeholder)" stroke-width="1" stroke-dasharray="3 3"/>
      <circle cx="98" cy="18" r="2.4" fill="var(--text)"/>
      <text x="50" y="32" text-anchor="middle" font-size="7" fill="var(--text-3)" letter-spacing="0.6">30일 추이 수집 중</text>
    </svg>
  `;
}

// ─── 팔로워 (폴백: 30일 더미 라인) ─────────────────────────────────
function renderFollowersLegacy(data) {
  const last = data[data.length - 1].count;
  const first = data[0].count;
  const delta = ((last - first) / first * 100);
  document.getElementById('followersNum').textContent = last.toLocaleString();
  document.getElementById('followersDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%';

  const w = 100, h = 36;
  const max = Math.max(...data.map(d => d.count));
  const min = Math.min(...data.map(d => d.count));
  const range = max - min || 1;
  const pts = data.map((d, i) => [
    (i / (data.length - 1)) * w,
    h - ((d.count - min) / range) * (h - 8) - 4
  ]);
  let path = `M ${pts[0