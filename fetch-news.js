const https = require('https');
const http = require('http');
const fs = require('fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── 크롤링 소스 (릴리즈노트 직접 수집) ──────────────
const CRAWL_SOURCES = [
  {
    category: 'figma',
    url: 'https://help.figma.com/hc/en-us/categories/360002051613-Release-Notes',
    selector: 'article',
    label: 'Figma 릴리즈노트'
  },
  {
    category: 'adobe',
    url: 'https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html',
    selector: 'article',
    label: 'Photoshop 릴리즈노트'
  },
  {
    category: 'adobe',
    url: 'https://helpx.adobe.com/illustrator/using/whats-new.html',
    selector: 'article',
    label: 'Illustrator 릴리즈노트'
  },
  {
    category: 'adobe',
    url: 'https://helpx.adobe.com/firefly/release-notes.html',
    selector: 'article',
    label: 'Firefly 릴리즈노트'
  },
];

// ── RSS 소스 ───────────────────────────────────────
const RSS_SOURCES = [
  { url: 'https://uxdesign.cc/feed', category: 'industry' },
  { url: 'https://thenextweb.com/feed/', category: 'industry' },
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design' },
  { url: 'https://alistapart.com/main/feed/', category: 'design' },
  { url: 'https://www.wired.com/feed/rss', category: 'trend' },
  { url: 'https://dev.to/feed/tag/design', category: 'trend' },
  { url: 'https://css-tricks.com/feed/', category: 'frontend' },
  { url: 'https://dev.to/feed/tag/webdev', category: 'frontend' },
];

const MAX_TOTAL = 10;
// ──────────────────────────────────────────────────

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) return reject(new Error('리다이렉트 초과'));
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

// HTML에서 텍스트 추출
function extractTextFromHTML(html, maxLen = 500) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// 페이지 타이틀 추출
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// RSS XML 파싱
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
    const decode = (s) => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    const title = decode(get('title'));
    const link  = get('link') || block.match(/<link[^>]*>([^<]+)<\/link>/)?.[1] || '';
    let desc = get('content:encoded') || get('description');
    desc = desc.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim().slice(0, 500);
    const date = get('pubDate') || get('dc:date') || '';
    if (title && link && title.length > 5) items.push({ title, link, desc, date });
  }
  return items;
}

// OpenAI 요약
function summarizeWithOpenAI(title, desc) {
  return new Promise((resolve, reject) => {
    const safeTitle = title.replace(/"/g,"'").slice(0, 200);
    const safeDesc  = desc.replace(/"/g,"'").slice(0, 400);

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '영문 디자인/기술 기사나 릴리즈노트를 한국어로 요약하는 전문가야. JSON만 출력하고 다른 텍스트는 절대 쓰지 마.'
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

const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

async function main() {
  console.log('🚀 지식지갑 뉴스 수집 시작...');
  const articles = [];

  // ── 1. 크롤링 소스 수집 ──────────────────────────
  console.log('\n📌 릴리즈노트 크롤링 시작...');
  for (const source of CRAWL_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;
    console.log(`📡 [${source.category}] ${source.label}`);
    try {
      const html = await fetchUrl(source.url);
      const title = extractTitle(html);
      const desc = extractTextFromHTML(html);

      if (!desc || desc.length < 50) {
        console.log(`  ⚠️ 본문 없음, 건너뜀`);
        continue;
      }

      console.log(`  🤖 OpenAI 요약 중...`);
      await sleep(500);

      const summarized = await summarizeWithOpenAI(
        `${source.label}: ${title}`,
        desc
      );

      articles.push({
        category: source.category,
        title: summarized.title || title,
        summary: summarized.summary || desc.slice(0, 120),
        summary_full: summarized.summary_full || desc,
        keywords: summarized.keywords || [],
        source: new URL(source.url).hostname.replace('www.',''),
        date: today,
        url: source.url
      });

      console.log(`  ✅ 완료`);
    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
    }
  }

  // ── 2. RSS 소스 수집 ─────────────────────────────
  console.log('\n📌 RSS 수집 시작...');
  const categoryCount = {};

  for (const source of RSS_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;
    const count = categoryCount[source.category] || 0;
    if (count >= 2) continue;

    console.log(`📡 [${source.category}] ${source.url}`);
    try {
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml);
      if (items.length === 0) { console.log(`  ⚠️ 기사 없음`); continue; }

      const item = items[0];
      console.log(`  📰 "${item.title.slice(0,60)}"`);
      if (!item.desc || item.desc.length < 20) { console.log(`  ⚠️ 본문 없음`); continue; }

      console.log(`  🤖 OpenAI 요약 중...`);
      await sleep(500);

      const summarized = await summarizeWithOpenAI(item.title, item.desc);

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
  if (articles.length === 0) console.log('⚠️ 수집된 기사 없음.');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
