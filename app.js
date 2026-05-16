// 너겟 작업 사이트 v0.4
Promise.all([
  fetch('./data/insta.json').then(r => r.json()),
  fetch('./data/ai_insight.json').then(r => r.json()),
  fetch('./data/items.json').then(r => r.json())
]).then(([insta, ai, items]) => {
  if (insta._주의 || ai._주의 || items._주의) {
    document.getElementById('dummyNotice').classList.add('on');
  }
  renderFollowers(insta.followers_30d);
  renderAI(ai);
  renderHero(items.items[0]);
  renderRecent(insta.recent_posts);
  renderWeekly(insta.weekly_posts);
  renderFormats(insta.post_formats);
  renderProgress(insta.weekly_posts);
}).catch(e => {
  console.error(e);
  document.getElementById('aiSummary').textContent = '데이터 로드 실패: ' + e.message;
});

// 팔로워 미니 라인 차트
function renderFollowers(data) {
  const last = data[data.length - 1].count;
  const first = data[0].count;
  const delta = ((last - first) / first * 100);
  document.getElementById('followersNum').textContent = last.toLocaleString();
  document.getElementById('followersDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%';

  const w = 100, h = 48;
  const max = Math.max(...data.map(d => d.count));
  const min = Math.min(...data.map(d => d.count));
  const range = max - min || 1;
  const pts = data.map((d, i) => [
    (i / (data.length - 1)) * w,
    h - ((d.count - min) / range) * (h - 10) - 5
  ]);
  let path = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i-1], b = pts[i];
    const cx = (a[0] + b[0]) / 2;
    path += ` Q ${cx},${a[1]} ${cx},${(a[1]+b[1])/2} T ${b[0]},${b[1]}`;
  }
  const area = path + ` L ${pts[pts.length-1][0]},${h} L ${pts[0][0]},${h} Z`;

  document.getElementById('followersChart').innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a1a1a" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#1a1a1a" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#lg)"/>
      <path d="${path}" fill="none" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${pts[pts.length-1][0]}" cy="${pts[pts.length-1][1]}" r="2" fill="#1a1a1a"/>
    </svg>
  `;
}

function renderAI(ai) {
  document.getElementById('aiSummary').textContent = `"${ai.summary}"`;
  document.getElementById('aiTime').textContent = ai.generated_at.split(' ')[1] || '--:--';
}

// 중앙 hero (raw 항목 중 첫 번째 = 더미는 검은신화 오공)
function renderHero(item) {
  if (!item) return;
  document.getElementById('heroSource').textContent = `${item.출처_매체} · ${item.유형}`;
  document.getElementById('heroTitle').textContent = item.제목.replace(/^\[더미\]\s*/, '');
  document.getElementById('heroSummary').textContent = item.원문_요약;
  // 인스타 더미 likes/comments 매핑
  document.getElementById('heroLikes').textContent = '687';
  document.getElementById('heroComments').textContent = '62';
}

function renderRecent(posts) {
  const list = document.getElementById('recentList');
  list.innerHTML = posts.slice(0, 4).map((p, i) => {
    const hasImg = i % 2 === 1;
    const title = p.title.replace(/^\[더미\]\s*/, '');
    return `
      <div class="recent-item">
        <div class="meta">
          <div class="title">${escapeHtml(title)}</div>
          <div class="sub">${p.format} · ${p.date.split('-').slice(1).join('/')}</div>
        </div>
        ${hasImg
          ? `<div class="thumb"></div>`
          : `<button class="add-btn" aria-label="추가"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg></button>`}
      </div>
    `;
  }).join('');
}

// 주간 막대
function renderWeekly(weekly) {
  const total = weekly.reduce((s, d) => s + d.count, 0);
  const avg = (total / 7).toFixed(1);
  document.getElementById('weeklyTotal').textContent = total + '건';
  document.getElementById('weeklyAvg').textContent = avg;
  const max = Math.max(...weekly.map(d => d.count), 1);
  const peakIdx = weekly.findIndex(d => d.count === max);
  document.getElementById('weeklyBars').innerHTML = weekly.map((d, i) => `
    <div class="col">
      <div class="bar ${i === peakIdx ? 'peak' : ''}" style="height:${Math.max((d.count / max) * 56, 8)}px"></div>
      <div class="day ${i === peakIdx ? 'peak' : ''}">${d.day}</div>
    </div>
  `).join('');
}

// 도넛 + 정보
function renderFormats(formats) {
  const total = formats.reduce((s, f) => s + f.count, 0);
  document.getElementById('donutTotal').textContent = total;
  document.getElementById('formatsInfo').innerHTML = formats.map(f => `
    <div class="item">
      <span class="swatch" style="background:${f.color}"></span>
      <span class="name">${f.type}</span>
      <span class="pct">${Math.round(f.count / total * 100)}%</span>
    </div>
  `).join('');
  const svg = document.getElementById('donutSvg');
  const r = 42, cx = 50, cy = 50;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = formats.map(f => {
    const ratio = f.count / total;
    const len = circ * ratio;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${f.color}" stroke-width="9" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
    return seg;
  }).join('');
  svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg)" stroke-width="9"/>${segs}`;
}

// 진행률 (이번 주 발행 / 목표)
function renderProgress(weekly) {
  const total = weekly.reduce((s, d) => s + d.count, 0);
  const goal = 15;
  const pct = Math.min(100, total / goal * 100);
  // 두 트랙으로 분할 (중앙 마크 기준)
  const leftPct = Math.min(100, pct * 2);
  const rightPct = Math.max(0, (pct - 50) * 2);
  document.getElementById('progressFill').style.width = leftPct + '%';
  document.getElementById('progressFill2').style.width = rightPct + '%';
  document.getElementById('weekLabel').textContent = `이번 주 ${total}/${goal}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
