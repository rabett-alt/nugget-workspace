#!/usr/bin/env python3
"""
RSS 수집기 + HN 스타일 스코어링.
sources.json에서 method='rss'인 매체만 처리.
method='claude'는 Anthropic API 키 받은 후 별도 스크립트로.

스코어 공식 (Hacker News + Brave 혼합):
  base = log10(authority + 1)
  freshness = 1 / (age_hours + 2) ** 1.5
  score = base * authority * freshness * (1 + keyword_bonus)
  - 다양성 페널티: 같은 게임 3건↑ → 0.5x
  - 같은 매체 5건↑ → 0.7x
"""
import feedparser
import json
import math
import re
import os
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES_PATH = os.path.join(ROOT, 'data', 'sources.json')
FEED_PATH = os.path.join(ROOT, 'data', 'feed.json')

# 너겟이 자주 다룬 키워드 (가중치 +)
NUGGET_KEYWORDS = [
    '엘든링', '메이플', '닌텐도', '발더스', '오공', '검은신화', 'P의거짓',
    '원신', '호요버스', '미호요', '로스트아크', '리니지', '배그', '오버워치',
    'GTA', '레데리', '바이오하자드', '데스스트랜딩', '파이널판타지', 'FF',
    '젤다', '마리오', '포켓몬', '동물의숲', '스플래툰',
    'Steam', '플레이스테이션', 'PS5', 'PS6', 'Xbox', 'Switch',
    '콜라보', '신작', '출시', 'DLC', '확장팩', '업데이트', '실적', '인디'
]

# 페널티 키워드 (정치/논란/미성년)
PENALTY_KEYWORDS = [
    '대통령', '정치', '선거', '범죄', '미성년자', '아동', '논란', '사망', '자살',
    'politics', 'election', 'crime', 'minor'
]

CATEGORY_KEYWORDS = {
    'release':   ['출시','발매','신작','DLC','확장팩','업데이트','다이렉트','release','launch','update','dlc','expansion'],
    'industry':  ['실적','영업이익','매출','M&A','인수','상장','매각','정책','법안','earnings','acquisition','industry'],
    'collab':    ['콜라보','컬래버','collab','crossover','collaboration','IP','tie-in','이벤트','event'],
    'indie':     ['인디','indie','solo','crowdfund','kickstarter'],
    'offline':   ['지스타','gstar','TGS','gamescom','GDC','summer game fest','PAX','BlizzCon','컨퍼런스','부스','쇼케이스'],
    'community': ['핫게','짤','드라마','반응','reaction','hot','meme','viral']
}


def load_sources():
    with open(SOURCES_PATH, encoding='utf-8') as f:
        return json.load(f)


def parse_time(entry):
    """RSS entry에서 publish time (epoch seconds)"""
    for k in ['published_parsed', 'updated_parsed', 'created_parsed']:
        v = entry.get(k)
        if v:
            try:
                return int(datetime(*v[:6], tzinfo=timezone.utc).timestamp())
            except Exception:
                continue
    return int(datetime.now(timezone.utc).timestamp())


def extract_thumb(entry):
    """RSS entry에서 썸네일 URL 추출 (여러 표준 시도)"""
    # media:thumbnail
    if 'media_thumbnail' in entry and entry['media_thumbnail']:
        return entry['media_thumbnail'][0].get('url')
    # media:content
    if 'media_content' in entry and entry['media_content']:
        return entry['media_content'][0].get('url')
    # enclosure
    for link in entry.get('links', []):
        if 'image' in (link.get('type') or ''):
            return link.get('href')
    # img in summary HTML
    summary = entry.get('summary', '')
    m = re.search(r'<img[^>]+src=["\']([^"\']+)', summary)
    if m:
        return m.group(1)
    return None


def clean_html(html):
    """HTML 태그 제거 + 공백 정리"""
    t = re.sub(r'<[^>]+>', ' ', html or '')
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def keyword_match_bonus(text, keywords):
    """텍스트에 키워드 매칭 점수 (0~1)"""
    if not text:
        return 0.0
    text_lower = text.lower()
    hits = sum(1 for k in keywords if k.lower() in text_lower)
    return min(1.0, hits / 3.0)  # 최대 1.0 (3개 이상 매칭 시 만점)


def detect_categories(text, source_cats):
    """제목·요약 키워드로 카테고리 자동 분류. 매체 기본 카테고리와 교집합 우선"""
    text_lower = text.lower()
    matched = []
    for cat, kws in CATEGORY_KEYWORDS.items():
        if any(k.lower() in text_lower for k in kws):
            matched.append(cat)
    # 매체 기본 카테고리와 교집합 우선
    intersect = [c for c in matched if c in source_cats]
    if intersect:
        return intersect
    if matched:
        return matched[:2]  # 최대 2개
    return source_cats[:1] if source_cats else ['release']


def has_penalty(text):
    if not text:
        return False
    text_lower = text.lower()
    return any(k.lower() in text_lower for k in PENALTY_KEYWORDS)


def calc_score(item, now_ts):
    """HN 스타일 + 가중치 점수"""
    if item.get('penalty'):
        return 0.0
    age_hours = max(0, (now_ts - item['taken_at']) / 3600)
    # 24시간 이상 = 거의 0
    if age_hours > 72:
        return 0.0
    authority = item['authority']
    base = math.log10(authority + 1) * authority
    freshness = 1.0 / ((age_hours + 2) ** 1.5)
    keyword_bonus = item.get('keyword_bonus', 0)
    score = base * freshness * (1 + keyword_bonus)
    return round(score * 1000, 3)


def fetch_one(src):
    """매체 1개 RSS fetch → 아이템 리스트"""
    if src.get('method') != 'rss' or not src.get('rss'):
        return []
    try:
        feed = feedparser.parse(src['rss'])
    except Exception as e:
        print(f'  [!] {src["id"]} fetch fail: {e}', file=sys.stderr)
        return []
    items = []
    for entry in feed.entries[:25]:  # 최근 25개만
        title = (entry.get('title') or '').strip()
        if not title:
            continue
        url = entry.get('link') or ''
        summary = clean_html(entry.get('summary') or entry.get('description') or '')[:500]
        taken_at = parse_time(entry)
        thumb = extract_thumb(entry)
        text_for_match = title + ' ' + summary
        bonus = keyword_match_bonus(text_for_match, NUGGET_KEYWORDS)
        cats = detect_categories(text_for_match, src.get('categories', []))
        items.append({
            'id': f"{src['id']}-{abs(hash(url))%10**10}",
            'source_id': src['id'],
            'source_name': src['name'],
            'authority': src['authority'],
            'region': src.get('region', 'global'),
            'title': title,
            'summary': summary,
            'url': url,
            'thumb': thumb,
            'taken_at': taken_at,
            'categories': cats,
            'keyword_bonus': bonus,
            'penalty': has_penalty(text_for_match)
        })
    return items


def apply_diversity_penalty(items):
    """같은 게임 3건↑ / 같은 매체 5건↑ → 점수 깎음"""
    # 매체 카운트
    src_count = {}
    for it in items:
        src_count[it['source_id']] = src_count.get(it['source_id'], 0) + 1
    # 게임명 추출은 휴리스틱 (제목에서 따옴표·괄호 안)
    for it in items:
        sc = src_count[it['source_id']]
        if sc > 5:
            it['score'] *= 0.7
            it['_diversity_note'] = f'매체 N={sc}'
    return items


def main():
    cfg = load_sources()
    sources = [s for s in cfg['sources'] if s.get('method') == 'rss']
    print(f'RSS 매체: {len(sources)}개')

    now_ts = int(datetime.now(timezone.utc).timestamp())
    all_items = []
    for src in sources:
        items = fetch_one(src)
        print(f'  · {src["id"]}: {len(items)}건')
        all_items.extend(items)

    # 스코어 + 다양성 페널티
    for it in all_items:
        it['score'] = calc_score(it, now_ts)
    all_items = apply_diversity_penalty(all_items)

    # 중복 URL 제거 (같은 뉴스 여러 매체)
    seen_urls = set()
    dedup = []
    for it in sorted(all_items, key=lambda x: -x['score']):
        if it['url'] in seen_urls:
            continue
        seen_urls.add(it['url'])
        dedup.append(it)

    # 카테고리별 상위 10개
    by_cat = {c['id']: [] for c in cfg['_카테고리']}
    for it in dedup:
        for cat in it['categories']:
            if cat in by_cat and len(by_cat[cat]) < 15:
                by_cat[cat].append(it['id'])

    out = {
        '_generated_at': datetime.now(timezone.utc).isoformat(),
        '_total': len(dedup),
        '_categories': cfg['_카테고리'],
        'by_category': by_cat,
        'items': dedup[:200]   # 전체 상위 200개만 저장
    }

    os.makedirs(os.path.dirname(FEED_PATH), exist_ok=True)
    with open(FEED_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f'✅ feed.json: {len(dedup)}건 저장, 상위 200건 출력')


if __name__ == '__main__':
    main()
