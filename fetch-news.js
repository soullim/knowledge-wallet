const https = require('https');
const http = require('http');
const fs = require('fs');

// ── 설정 ──────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const RSS_SOURCES = [
  // 피그마 신기능
  { url: 'https://www.figma.com/blog/feed/', category: 'figma' },

  // 어도비 신기능
  { url: 'https://blog.adobe.com/en/topics/design/feed', category: 'adobe' },

  // 업계동향
  { url: 'https://www.creativebloq.com/rss', category: 'industry' },
  { url: 'https://uxdesign.cc/feed', category: 'industry' },

  // 디자인
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design' },
  { url: 'https://feeds.feedburner.com/alistapart/main', category: 'design' },

  // 트렌드
  { url: 'https://thenextweb.com/feed/', category: 'trend' },
  { url: 'https://www.wired.com/feed/rss', category: 'trend' },

  // 프론트엔드
  { url: 'https://css-tricks.com/feed/', category: 'frontend' },
  { url: 'https://web.dev/feed.xml', category: 'frontend' },
];

const MAX_PER_CATEGORY = 2; // 분류당 최대 기사 수
const MAX_TOTAL = 10;       // 전체 최대 카드 수
// ──────────────────────────────────────────────────


// RSS XML 파싱 (외부 라이브러리 없이 간단 파싱)
function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    const title = get('title');
    const link  = get('link') || block.match(/<link\s*\/?>(.*?)<\/link>|<link>(.*?)<\/link>/)?.[1] || '';
    const desc  = get('description').replace(/<[^>]+>/g, '').slice(0, 300);
    const date  = get('pubDate') || get('dc:date') || '';

    if (title && link) {
      items.push({ title, link, desc, date });
    }
  }
  return items;
}

// URL fetch (http/https 자동 판별)
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // 리다이렉트 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Gemini API로 한국어 요약
function summarizeWithGemini(title, desc) {
  return new Promise((resolve, reject) => {
    const prompt = `다음 영문 디자인/기술 기사를 한국어로 요약해줘.
반드시 JSON 형식으로만 응답하고, 다른 텍스트는 절대 포함하지 마.

기사 제목: ${title}
기사 내용: ${desc}

응답 형식:
{
  "title": "한국어로 번역한 제목",
  "summary": "2-3문장 요약 (카드에 표시될 짧은 요약)",
  "summary_full": "4-5문장 상세 요약 (클릭시 모달에 표시)",
  "keywords": ["키워드1", "키워드2", "키워드3"]
}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const clean = text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(clean);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Gemini 파싱 실패: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Gemini timeout')); });
    req.write(body);
    req.end();
  });
}

// 날짜 포맷 (한국어)
function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) throw new Error();
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  } catch {
    return new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  }
}

// 잠깐 대기 (API 과호출 방지)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 메인 실행
async function main() {
  console.log('🚀 지식지갑 뉴스 수집 시작...');

  const categoryCount = {};
  const articles = [];

  for (const source of RSS_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;

    const count = categoryCount[source.category] || 0;
    if (count >= MAX_PER_CATEGORY) continue;

    console.log(`📡 수집 중: [${source.category}] ${source.url}`);

    try {
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml);

      if (items.length === 0) {
        console.log(`  ⚠️ 기사 없음`);
        continue;
      }

      // 최신 기사 1개만 처리
      const item = items[0];
      console.log(`  📰 "${item.title}"`);
      console.log(`  🤖 Gemini 요약 중...`);

      await sleep(1000); // API 호출 간격

      const summarized = await summarizeWithGemini(item.title, item.desc);

      articles.push({
        category: source.category,
        title: summarized.title || item.title,
        summary: summarized.summary || item.desc.slice(0, 100),
        summary_full: summarized.summary_full || item.desc,
        keywords: summarized.keywords || [],
        source: new URL(source.url).hostname.replace('www.', ''),
        date: formatDate(item.date),
        url: item.link
      });

      categoryCount[source.category] = count + 1;
      console.log(`  ✅ 완료`);

    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
    }
  }

  // news.json 저장
  const output = {
    updated: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    count: articles.length,
    articles
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✨ 완료! 총 ${articles.length}개 카드 생성 → news.json 저장됨`);
}

main().catch(err => {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
});
