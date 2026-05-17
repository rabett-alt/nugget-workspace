#!/usr/bin/env python3
"""
v0.16 RSS 수집기
- 한국 매체 가중치 ×1.5 (한국 우선)
- 영문 RSS 자동 번역 (Google Translate via deep-translator)
- 썸네일 fallback (RSS 없으면 article URL의 og:image)
- HN 스타일 스코어링
"""
import feedparser
import json, math, re, os, sys, time, html as ihtml
from datetime import datetime, timezone
from urllib.parse import urlparse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT, 'data', 'sources.json')
FEED_PATH = os.path.join(ROOT, 'data', 'feed.json')

# 번역기 (optional - 없으면 skip)
try:
    from deep_translator import GoogleTranslator
    _trans = GoogleTranslator(source='auto', target='ko')
    TRANS_OK = True
except Exception:
    _trans = None
    TRANS_OK = False

NUGGET_KEYWORDS = [
    '엘든링','메이플','닌텐도','발더스','오공','검은신화','P의거짓','원신','호요버스','미호요',
    '로스트아크','리니지','배그','오버워치','GTA','레데리','바이오하자드','데스스트랜딩','파이널판타지','FF',
    '젤다','마리오','포켓몬','동물의숲','스플래툰','Steam','플레이스테이션','PS5','PS6','Xbox','Switch',
    '콜라보','신작','출시','DLC','확장팩','업데이트','실적','인디','지스타','TGS','Gamescom'
]
PENALTY_KEYWORDS = ['대통령','정치','선거','범죄','미성년자','아동','논란','사망','자살','politics','election','crime','minor']
CATEGORY_KEYWORDS = {
    'release':   ['출시','발매','신작','DLC','확장팩','업데이트','다이렉트','release','launch','update','dlc','expansion','reveal','trailer'],
    'industry':  ['실적','영업이익','매출','M&A','인수','상장','매각','정책','법안','earnings','acquisition','industry','revenue','layoff'],
    'collab':    ['콜라보','컬래버','collab','crossover','collaboration','IP','tie-in','이벤트','event'],
    'indie':     ['인디','indie','solo','crowdfund','kickstarter'],
    'offline':   ['지스타','gstar','TGS','gamescom','GDC','summer game fest','PAX','BlizzCon','컨퍼런스','부스','쇼케이스'],
    'community': ['핫게','짤','드라마','반응','reaction','hot','meme','viral']
}

UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 NuggetBot/1.0'


def load_sources():
    with open(SOURCES_PATH, encoding='utf-8') as f:
        return json.load(f)


def parse_time(entry):
    for k in ['published_parsed','updated_parsed','created_parsed']:
        v = entry.get(k)
        if v:
            try:
                return int(datetime(*v[:6], tzinfo=timezone.utc).timestamp() * 1000)
            except Exception:
                continue
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def extract_thumb(entry):
    if 'media_thumbnail' in entry and entry['media_thumbnail']:
        return entry['media_thumbnail'][0].get('url')
    if 'media_content' in entry and entry['media_content']:
        for c in entry['media_content']:
            if c.get('url'): return c['url']
    for link in entry.get('links', []):
        if 'image' in (link.get('type') or ''):
            return link.get('href')
    summary = entry.get('summary', '') or entry.get('description','')
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', summary)
    if m: return m.group(1)
    return None


def fetch_og_image(url, timeout=4):
    """기사 URL에서 og:image 추출 (썸네일 없을 때만 호출)"""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            html_data = r.read(120000).decode('utf-8', errors='ignore')
        # og:image
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', html_data, re.I)
        if m: return m.group(1)
        # twitter:image
        m = re.search(r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)', html_data, re.I)
        if m: return m.group(1)
    except Exception:
        return None
    return None


def clean_html(t):
    t = ihtml.unescape(re.sub(r'<[^>]+>', ' ', t or ''))
    return re.sub(r'\s+', ' ', t).strip()


def is_korean(s):
    if not s: return False
    return bool(re.search(r'[가-힣]', s))


import signal
class _TOut(Exception): pass
def _alarm_h(s,f): raise _TOut()

def translate_to_ko(text, src_lang='auto'):
    if not TRANS_OK or not text or is_korean(text):
        return text
    try:
        signal.signal(signal.SIGALRM, _alarm_h)
        signal.alarm(4)
        if len(text) <= 4500:
            r = _trans.translate(text)
        else:
            chunks = [text[i:i+4500] for i in range(0, len(text), 4500)]
            r = ' '.join(_trans.translate(c) for c in chunks)
        signal.alarm(0)
        return r
    except Exception:
        try: signal.alarm(0)
        except: pass
        return text


def keyword_match_bonus(text, kws):
    if not text: return 0.0
    tl = text.lower()
    hits = sum(1 for k in kws if k.lower() in tl)
    return min(1.0, hits / 3.0)


def detect_categories(text, src_cats):
    tl = text.lower()
    matched = [cat for cat, kws in CATEGORY_KEYWORDS.items() if any(k.lower() in tl for k in kws)]
    intersect = [c for c in matched if c in src_cats]
    if intersect: return intersect
    if matched: return matched[:2]
    return src_cats[:1] if src_cats else ['release']


def has_penalty(text):
    if not text: return False
    tl = text.lower()
    return any(k.lower() in tl for k in PENALTY_KEYWORDS)


def calc_score(it, now_ms):
    if it.get('penalty'): return 0.0
    age_h = max(0, (now_ms - it['taken_at']) / 1000 / 3600)
    if age_h > 72: return 0.0
    authority = it['authority']
    # 한국 가중치 ×1.5
    region_boost = 1.5 if it.get('region') == 'kr' else 1.0
    base = math.log10(authority + 1) * authority
    freshness = 1.0 / ((age_h + 2) ** 1.5)
    kbonus = it.get('keyword_bonus', 0)
    score = base * region_boost * freshness * (1 + kbonus)
    return round(score * 1000, 3)


def fetch_one(src, do_translate=True, do_og=True):
    if src.get('method') != 'rss' or not src.get('rss'):
        return []
    try:
        feed = feedparser.parse(src['rss'])
    except Exception as e:
        print(f'  [!] {src["id"]} fail: {e}', file=sys.stderr)
        return []
    items = []
    is_kr = src.get('region') == 'kr'
    for entry in feed.entries[:20]:
        title_orig = (entry.get('title') or '').strip()
        if not title_orig: continue
        url = entry.get('link') or ''
        summary_orig = clean_html(entry.get('summary') or entry.get('description') or '')[:400]
        taken_at = parse_time(entry)
        thumb = extract_thumb(entry)

        # 영문 → 한국어 번역 (한국 매체는 skip)
        if is_kr or is_korean(title_orig):
            title_ko, summary_ko = title_orig, summary_orig
        elif do_translate:
            title_ko = translate_to_ko(title_orig)
            summary_ko = translate_to_ko(summary_orig) if summary_orig else ''
        else:
            title_ko, summary_ko = title_orig, summary_orig

        text_for_match = title_ko + ' ' + summary_ko + ' ' + title_orig
        bonus = keyword_match_bonus(text_for_match, NUGGET_KEYWORDS)
        cats = detect_categories(text_for_match, src.get('categories', []))

        items.append({
            'id': f"{src['id']}-{abs(hash(url))%10**10}",
            'source_id': src['id'],
            'source_name': src['name'],
            'authority': src['authority'],
            'region': src.get('region', 'global'),
            'title': title_ko,
            'title_original': title_orig if title_ko != title_orig else None,
            'summary': summary_ko,
            'url': url,
            'thumb': thumb,
            'taken_at': taken_at,
            'categories': cats,
            'keyword_bonus': bonus,
            'penalty': has_penalty(text_for_match),
            'lang': 'ko' if is_kr or is_korean(title_orig) else 'en'
        })
    return items


def main():
    cfg = load_sources()
    sources = [s for s in cfg['sources'] if s.get('method') == 'rss']
    print(f'RSS sources: {len(sources)}')
    print(f'번역기: {"OK" if TRANS_OK else "X (skip)"}')

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    all_items = []
    for src in sources:
        items = fetch_one(src)
        print(f'  · {src["id"]} ({src.get("region","-")}): {len(items)}건' + (' [번역]' if src.get('region')!='kr' and items else ''))
        all_items.extend(items)

    # og:image 보강 (썸네일 없는 것만, 너무 많으면 부담이라 상위 80개만)
    missing_thumb = [it for it in all_items if not it.get('thumb')][:80]
    print(f'썸네일 누락 {len(missing_thumb)}건 → og:image 추출 시도')
    for it in missing_thumb:
        og = fetch_og_image(it['url'])
        if og: it['thumb'] = og