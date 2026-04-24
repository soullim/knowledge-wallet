const https = require('https');
const http = require('http');
const fs = require('fs');

// ── 설정 ──────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const RSS_SOURCES = [
  // 피그마 신기능
  { url: 'https://www.figma.com/blog/feed/', category: 'figma' },
  { url: 'https://feeds.feedburner.com/figma', category: 'figma' },

  // 어도비 신기능
  { url: 'https://blog.adobe.com/en/topics/design/feed.xml', category: 'adobe' },
  { url: 'https://www.adobe.com/products/photoshop/features.html', category: 'adobe' },

  // 업계동향
  { url: 'https://www.creativebloq.com/feeds/all', category: 'industry' },
  { url: 'https://uxdesign.cc/feed', category: 'industry' },
  { url: 'https://www.designweek.co.uk/feed/', category: 'industry' },

  // 디자인
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design' },
  { url: 'https://www.creativeboom.com/feed/', category: 'design' },

  // 트렌드
  { url: 'https://thenextweb.com/feed/', category: 'trend' },
  { url: 'https://www.fastcompany.com/design/rss', category: 'trend' },

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

    const title = get('title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const link  = get('link') || block.match(/<link[^>]*>([^<]+)<\/link>/)?.[1] || '';
    const desc  = get('description').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim().slice(0, 400);
    const date  = get('pubDate') || get('dc:date') || '';

    if (title && link && title.length > 5) {
      items.push({ title, link, desc, date });
    }
  }
  return items;
}

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 3) return reject(new Error('리다이렉트 초과'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
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
    const safeDesc = desc.replace(/"/g, "'").slice(0, 300);
    const safeTitle = title.replace(/"/g, "'").slice(0, 200);

    const prompt = `영문 디자인/기술 기사를 한국어로 요약해줘. JSON만 출력하고 다른 텍스트는 절대 쓰지 마.

제목: ${safeTitle}
내용: ${safeDesc}

출력형식(JSON만):
{"title":"한국어제목","summary":"2문장요약","summary_full":"4문장상세요약","keywords":["키워드1","키워드2","키워드3"]}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
          const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('JSON 없음: ' + text.slice(0, 100));
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

      if (items.length === 0) {
        console.log(`  ⚠️ 기사 없음`);
        continue;
      }

      const item = items[0];
      console.log(`  📰 "${item.title.slice(0, 60)}"`);

      if (!item.desc || item.desc.length < 20) {
        console.log(`  ⚠️ 본문 없음, 건너뜀`);
        continue;
      }

      console.log(`  🤖 Gemini 요약 중...`);
      await sleep(1500);

      const summarized = await summarizeWithGemini(item.title, item.desc);

      articles.push({
        category: source.category,
        title: summarized.title || item.title,
        summary: summarized.summary || item.desc.slice(0, 120),
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
}

main().catch(err => {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
});
