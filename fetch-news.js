const https = require('https');
const http = require('http');
const fs = require('fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── 키워드 필터 (국내 사이트용) ───────────────────
const KEYWORDS = [
  '디자인', '피그마', '어도비', '퍼블리싱', '트렌드', 'AI', '인공지능',
  '클로드', 'UX', 'UI', '프론트엔드', '웹디자인', '모션', '포토샵',
  '일러스트', 'figma', 'adobe', 'design', 'frontend', 'ux', 'ui',
  'ChatGPT', 'GPT', '생성형', '브랜드', '타이포그래피', '컬러'
];

// ── RSS 소스 ───────────────────────────────────────
const RSS_SOURCES = [

  // 피그마 신기능 (공식 릴리즈 노트 RSS)
  // 변경 전: YouTube RSS → 영상 제목만 수집, 기능 내용 파악 어려움
  // 변경 후: figma.com/release-notes → 실제 기능 업데이트 텍스트 직접 수집
  { url: 'https://www.figma.com/release-notes/rss.xml', category: 'figma', label: 'Figma Release Notes', filterKeyword: false },

  // ──────────────────────────────────────────────────────────────────────────
  // 어도비 신기능 (2025-04 개편)
  //   유튜브 RSS 전면 제거 → 채널 ID 오류 + 영상 제목만 수집되는 한계
  //   helpx.adobe.com 릴리즈 노트는 공식 RSS 미제공
  //   → Adobe 공식 블로그 RSS로 대체 (Creativity + AI/Firefly 토픽)
  // ──────────────────────────────────────────────────────────────────────────
  { url: 'https://blog.adobe.com/en/topics/creativity.rss', category: 'adobe', label: 'Adobe Blog - Creativity', filterKeyword: false },
  { url: 'https://blog.adobe.com/en/topics/artificial-intelligence.rss', category: 'adobe', label: 'Adobe Blog - AI / Firefly', filterKeyword: false },

  // 업계동향
  { url: 'https://uxdesign.cc/feed', category: 'industry', filterKeyword: false },
  { url: 'https://thenextweb.com/feed/', category: 'industry', filterKeyword: false },
  // ── 추가 (2025-04) ──
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'industry', label: 'The Verge AI', filterKeyword: false },
  { url: 'https://importai.substack.com/feed', category: 'industry', label: 'Import AI (Jack Clark)', filterKeyword: false },
  { url: 'https://openai.com/news/rss.xml', category: 'industry', label: 'OpenAI News', filterKeyword: false },

  // 디자인
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design', filterKeyword: false },
  { url: 'https://alistapart.com/main/feed/', category: 'design', filterKeyword: false },

  // 트렌드
  { url: 'https://www.wired.com/feed/rss', category: 'trend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/design', category: 'trend', filterKeyword: false },
  // ── 추가 (2025-04) ──
  { url: 'https://bullrich.dev/tldr-rss/feeds/ai.xml', category: 'trend', label: 'TLDR AI', filterKeyword: false },

  // 프론트엔드
  { url: 'https://css-tricks.com/feed/', category: 'frontend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/webdev', category: 'frontend', filterKeyword: false },

  // 국내 사이트 (키워드 필터 적용)
  { url: 'https://ditoday.com/feed', category: 'industry', filterKeyword: true },
  { url: 'https://toss.tech/rss.xml', category: 'frontend', filterKeyword: true },
  { url: 'https://eopla.net/magazines/rss', category: 'design', filterKeyword: true },
  { url: 'https://channel.io/ko/team/blog/rss', category: 'industry', filterKeyword: true },
  { url: 'https://blog.gangnamunni.com/feed', category: 'design', filterKeyword: true },
  // ── 추가 (2025-04): 구글 뉴스 AI 한국어 ──
  { url: 'https://news.google.com/rss/search?q=AI+디자인&hl=ko&gl=KR&ceid=KR:ko', category: 'trend', label: 'Google News AI', filterKeyword: true },
];

const MAX_PER_CATEGORY = 2;
const MAX_TOTAL = 10;
// ──────────────────────────────────────────────────

// 키워드 필터 함수
function hasKeyword(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

// YouTube Atom 피드 파싱
function parseAtom(xml) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const title = getTag('title').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const link  = (block.match(/rel="alternate"[^>]*href="([^"]+)"/) || block.match(/href="([^"]+)"/))?.[1] || '';
    const desc  = getTag('media:description') || getTag('summary') || getTag('content') || '';
    const date  = getTag('published') || getTag('updated') || '';
    if (title && link) items.push({ title, link, desc: desc.replace(/<[^>]+>/g,'').slice(0,400), date });
  }
  return items;
}

// RSS XML 파싱
function parseRSS(xml) {
  // Atom 피드 감지
  if (xml.includes('<feed') && xml.includes('<entry>')) return parseAtom(xml);

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const decode = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    const title = decode(get('title'));
    const link  = get('link') || block.match(/<link[^>]*>([^<]+)<\/link>/)?.[1] || '';
    let desc = get('content:encoded') || get('description');
    desc = desc.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
    const date = get('pubDate') || get('dc:date') || '';
    if (title && link && title.length > 5) items.push({ title, link, desc, date });
  }
  return items;
}

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) return reject(new Error('리다이렉트 초과'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return fetchUrl(next, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function summarizeWithOpenAI(title, desc) {
  return new Promise((resolve, reject) => {
    const safeTitle = title.replace(/"/g,"'").slice(0, 200);
    const safeDesc  = desc.replace(/"/g,"'").slice(0, 400);

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '영문 또는 국문 디자인/기술 기사나 영상 제목을 한국어로 요약하는 전문가야. JSON만 출력하고 다른 텍스트는 절대 쓰지 마.'
        },
        {
          role: 'user',
          content: `제목: ${safeTitle}\n내용: ${safeDesc}\n\n{"title":"한국어제목","summary":"2문장요약","summary_full":"4문장상세요약","keywords":["키워드1","키워드2","키워드3"]}`
        }
      ],
      temperature: 0.3,
      max_tokens: 600
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error('OpenAI API 오류: ' + json.error.message);
          const text = json.choices?.[0]?.message?.content || '';
          if (!text) throw new Error('빈 응답');
          const cleaned = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('JSON 없음');
          const parsed = JSON.parse(jsonMatch[0]);
          if (!parsed.title) throw new Error('title 필드 없음');
          resolve(parsed);
        } catch (e) {
          reject(new Error('OpenAI 파싱 실패: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('OpenAI timeout')); });
    req.write(body);
    req.end();
  });
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) throw new Error();
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  } catch {
    return new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 지식지갑 뉴스 수집 시작...');
  const categoryCount = {};
  const articles = [];

  for (const source of RSS_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;
    const count = categoryCount[source.category] || 0;
    if (count >= MAX_PER_CATEGORY) continue;

    console.log(`📡 [${source.category}] ${source.label || source.url}`);
    try {
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml);

      if (items.length === 0) { console.log(`  ⚠️ 기사 없음`); continue; }

      // 키워드 필터 적용 (국내 사이트)
      const filtered = source.filterKeyword
        ? items.filter(item => hasKeyword(item.title + ' ' + item.desc))
        : items;

      if (filtered.length === 0) {
        console.log(`  ⚠️ 키워드 매칭 기사 없음`);
        continue;
      }

      const item = filtered[0];
      console.log(`  📰 "${item.title.slice(0,60)}"`);

      if (!item.desc || item.desc.length < 10) {
        // YouTube는 desc가 짧아도 제목만으로 요약 가능
        item.desc = item.title;
      }

      console.log(`  🤖 OpenAI 요약 중...`);
      await sleep(500);

      const summarized = await summarizeWithOpenAI(item.title, item.desc);

      articles.push({
        category: source.category,
        title: summarized.title || item.title,
        summary: summarized.summary || item.desc.slice(0, 120),
        summary_full: summarized.summary_full || item.desc,
        keywords: summarized.keywords || [],
        source: source.label || new URL(source.url).hostname.replace('www.',''),
        date: formatDate(item.date),
        url: item.link
      });

      categoryCount[source.category] = count + 1;
      console.log(`  ✅ 완료`);

    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
    }
  }

  const output = {
    updated: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    count: articles.length,
    articles
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✨ 완료! 총 ${articles.length}개 카드 → news.json 저장됨`);
  if (articles.length === 0) console.log('⚠️ 수집된 기사 없음.');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
