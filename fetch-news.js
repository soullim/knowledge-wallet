const https = require('https');
const http = require('http');
const fs = require('fs');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── RSS 소스 (검증된 것만) ─────────────────────────
const RSS_SOURCES = [
  // 피그마 신기능
  { url: 'https://feeds.feedburner.com/FigmaBlog', category: 'figma' },
  { url: 'https://www.figma.com/blog/feed/', category: 'figma' },

  // 어도비 신기능
  { url: 'https://blog.adobe.com/en/feed', category: 'adobe' },

  // 업계동향
  { url: 'https://uxdesign.cc/feed', category: 'industry' },
  { url: 'https://thenextweb.com/feed/', category: 'industry' },

  // 디자인
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design' },
  { url: 'https://alistapart.com/main/feed/', category: 'design' },

  // 트렌드
  { url: 'https://www.wired.com/feed/rss', category: 'trend' },
  { url: 'https://feeds.feedburner.com/Co_Design', category: 'trend' },

  // 프론트엔드
  { url: 'https://css-tricks.com/feed/', category: 'frontend' },
  { url: 'https://dev.to/feed/tag/webdev', category: 'frontend' },
];

const MAX_PER_CATEGORY = 2;
const MAX_TOTAL = 10;
// ──────────────────────────────────────────────────

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };
    const decode = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'");
    const title = decode(get('title'));
    const link  = get('link') || block.match(/<link[^>]*>([^<]+)<\/link>/)?.[1] || '';
    // 본문: description 또는 content:encoded 시도
    let desc = get('content:encoded') || get('description');
    desc = desc.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0, 500);
    const date = get('pubDate') || get('dc:date') || '';
    if (title && link && title.length > 5) {
      items.push({ title, link, desc, date });
    }
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
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
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

function summarizeWithGemini(title, desc) {
  return new Promise((resolve, reject) => {
    const safeTitle = title.replace(/"/g,"'").slice(0, 200);
    const safeDesc  = desc.replace(/"/g,"'").slice(0, 400);

    const prompt = `영문 디자인/기술 기사를 한국어로 요약해줘. JSON만 출력하고 다른 텍스트는 절대 쓰지 마. 마크다운 코드블록도 쓰지 마.

제목: ${safeTitle}
내용: ${safeDesc}

{"title":"한국어제목","summary":"2문장요약","summary_full":"4문장상세요약","keywords":["키워드1","키워드2","키워드3"]}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      // -latest 붙여서 항상 최신 무료 안정 버전 자동 사용
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
          if (json.error) throw new Error('Gemini API 오류: ' + json.error.message);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (!text) throw new Error('빈 응답');
          const cleaned = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('JSON 없음');
          const parsed = JSON.parse(jsonMatch[0]);
          if (!parsed.title) throw new Error('title 필드 없음');
          resolve(parsed);
        } catch (e) {
          reject(new Error('Gemini 파싱 실패: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Gemini timeout')); });
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

    console.log(`📡 [${source.category}] ${source.url}`);
    try {
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml);

      if (items.length === 0) { console.log(`  ⚠️ 기사 없음`); continue; }

      const item = items[0];
      console.log(`  📰 "${item.title.slice(0,60)}"`);

      if (!item.desc || item.desc.length < 20) {
        console.log(`  ⚠️ 본문 없음, 건너뜀`);
        continue;
      }

      console.log(`  🤖 Gemini 요약 중...`);
      await sleep(2000); // 쿼터 초과 방지용 딜레이

      const summarized = await summarizeWithGemini(item.title, item.desc);

      articles.push({
        category: source.category,
        title: summarized.title || item.title,
        summary: summarized.summary || item.desc.slice(0, 120),
        summary_full: summarized.summary_full || item.desc,
        keywords: summarized.keywords || [],
        source: new URL(source.url).hostname.replace('www.',''),
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
  if (articles.length === 0) console.log('⚠️ 수집된 기사 없음. RSS 소스 확인 필요.');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
