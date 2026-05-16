// 너겟 작업 사이트 v0.3
Promise.all([
  fetch('./data/insta.json').then(r => r.json()),
  fetch('./data/ai_insight.json').then(r => r.json()),
  fetch('./data/items.json').then(r => r.json())
]).then(([insta, ai, items]) => {
  if (insta._주의 || ai._주의 || items._주의) {
    document.getElementById('dummyNotice').classList.add('on');
  }
  renderRecent(insta.recent_posts);
  renderFollowers(insta.followers_30d);
  renderAI(ai);
  renderFormats(insta.post_formats);
  renderWeekly(insta.weekly_posts);
}).catch(e => {
  console.error(e);
  document.getElementById('aiSummary').textContent = '데이터 로드 실패: ' + e.message;
});

function renderRecent(posts) {
  const offsets = ['', 'offset-1', 'offset-2', 'offset-3', 'offset-4'];
  const avatarSets = [
    '<div class="avatar-mini">M</div>',
    '<div class="avatar-mini b">K</div><div class="avatar-mini">L</div>',
    '<div class="avatar-mini c">J</div>',
    '<div class="avatar-mini">P</div><div class="avatar-mini b">N</div><div class="avatar-mini c">S</div>',
    '<div class="avatar-mini b">R</div>'
  ];
  const list = document.getElementById('recentList');
  list.innerHTML = posts.slice(0, 5).map((p, i) => `
    <div class="recent-row ${offsets[i] || ''}">
      <div class="day-label"></div>
      <div class="recent-bar">
        <span class="bar-title">${escapeHtml(p.title)}</span>
        <span class="bar-meta">· ${p.format}</span>
      </div>
      <div class="avatar-stack">${avatarSets[i] || ''}</div>
    </div>
  `).join('');
}

function renderFollowers(data) {
  const last = data[data.length - 1].count;
  const first = data[0].count;
  const delta = ((last - first) / first * 100);
  document.getElementById('followersNum').textContent = last.toLocaleString();
  document.getElementById('followersDelta').textContent = (delta >= 0 ? '+' : '') + delta.toFixed(1) + '%';

  const w = 100, h = 60;
  const max = Math.max(...data.map(d => d.count));
  const min = Math.min(...data.map(d => d.count));
  const range = max - min || 1;
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d.count - min) / range) * (h - 8) - 4;
    return [x, y];
  });
  let path = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i-1], curr = points[i];
    const cpx = (prev[0] + curr[0]) / 2;
    path += ` Q ${cpx},${prev[1]} ${cpx},${(prev[1]+curr[1])/2} T ${curr[0]},${curr[1]}`;
  }
  const area = path + ` L ${points[points.length-1][0]},${h} L ${points[0][0]},${h} Z`;

  document.getElementById('followersChart').innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a1a1a" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#1a1a1a" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#areaGrad)"/>
      <path d="${path}" fill="none" stroke="#1a1a1a" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  // 미니멀 레전드: 작은 점 + placeholder bar + 작은 숫자
  const items = [
    {dot: 'dot', label: '현재', val: last},
    {dot: 'dot mute', label: '신규', val: last - first},
    {dot: 'dot mute', label: '피크', val: max},
    {dot: 'dot mute', label: '최저', val: min}
  ];
  document.getElementById('followersLegend').innerHTML = items.map(it => `
    <div class="leg">
      <span class="${it.dot}"></span>
      <span class="placeholder-bar"></span>
      <span style="color:var(--text-2);">${it.val.toLocaleString()}</span>
    </div>
  `).join('');
}

function renderAI(ai) {
  document.getElementById('aiSummary').textContent = ai.summary;
  document.getElementById('aiTime').textContent = ai.generated_at;
}

function renderFormats(formats) {
  const total = formats.reduce((s, f) => s + f.count, 0);
  document.getElementById('formatList').innerHTML = formats.map(f => `
    <div class="format-row">
      <div class="format-swatch" style="background:${f.color}"></div>
      <div class="format-info">
        <div class="format-name">${f.type}</div>
        <div class="format-bar"></div>
      </div>
      <div class="format-count">${f.count}</div>
    </div>
  `).join('');
}

function renderWeekly(weekly) {
  const total = weekly.reduce((s, d) => s + d.count, 0);
  const avg = (total / 7).toFixed(1);
  const peak = weekly.reduce((max, d) => d.count > max.count ? d : max, weekly[0]);
  const goal = 15;

  document.getElementById('weeklyTotal').textContent = total;
  document.getElementById('weeklyAvg').textContent = avg;
  document.getElementById('weeklyFill').style.width = Math.min(100, total / goal * 100) + '%';
  document.getElementById('weeklyGoal').textContent = `목표 ${goal}건 · ${Math.round(total/goal*100)}%`;
  document.getElementById('peakDay').textContent = peak.day;
  document.getElementById('peakDayCount').textContent = peak.count + '건';

  const max = Math.max(...weekly.map(d => d.count), 1);
  document.getElementById('barsChart').innerHTML = weekly.map(d => `
    <div class="bar-col">
      <div class="bar ${d.count === 0 ? 'mute' : ''}" style="height:${Math.max((d.count / max) * 80, 4)}px"></div>
      <div class="bar-label">${d.day}</div>
    </div>
  `).join('');
}

function updateClock() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 30000);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'