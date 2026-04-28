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
  // 업계동향
  { url: 'https://uxdesign.cc/feed', category: 'industry', filterKeyword: false },
  { url: 'https://thenextweb.com/feed/', category: 'industry', filterKeyword: false },
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'ai', label: 'The Verge AI', filterKeyword: false },

  // 디자인
  { url: 'https://www.smashingmagazine.com/feed/', category: 'design', filterKeyword: false },
  { url: 'https://alistapart.com/main/feed/', category: 'design', filterKeyword: false },

  // AI 뉴스 (신규 카테고리)
  { url: 'https://bullrich.dev/tldr-rss/feeds/ai.xml', category: 'ai', label: 'TLDR AI', filterKeyword: false },
  { url: 'https://importai.substack.com/feed', category: 'ai', label: 'Import AI (Jack Clark)', filterKeyword: false },
  { url: 'https://openai.com/news/rss.xml', category: 'ai', label: 'OpenAI News', filterKeyword: false },

  // 트렌드
  { url: 'https://www.wired.com/feed/rss', category: 'trend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/design', category: 'trend', filterKeyword: false },

  // 프론트엔드
  { url: 'https://css-tricks.com/feed/', category: 'frontend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/webdev', category: 'frontend', filterKeyword: false },

  // 국내 사이트 (키워드 필터 적용)
  { url: 'https://ditoday.com/feed', category: 'industry', filterKeyword: true },
  { url: 'https://toss.tech/rss.xml', category: 'frontend', filterKeyword: true },
  { url: 'https://eopla.net/magazines/rss', category: 'design', filterKeyword: true },
  { url: 'https://channel.io/ko/team/blog/rss', category: 'industry', filterKeyword: true },
  { url: 'https://blog.gangnamunni.com/feed', category: 'design', filterKeyword: true },
  { url: 'https://news.google.com/rss/search?q=AI+디자인&hl=ko&gl=KR&ceid=KR:ko', category: 'trend', label: 'Google News AI', filterKeyword: true },
];

// ── 크롤링 소스 (RSS 없는 릴리즈 노트 전용) ──────
// main()에서 RSS 루프 전에 별도 실행됨
const SCRAPE_SOURCES = [
  {
    label: 'Figma Release Notes',
    category: 'figma',
    url: 'https://www.figma.com/release-notes/',
    // 파싱 전략: <h2> 날짜 + 이후 <p> 텍스트 블록
    parser: 'figma',
  },
  {
    label: 'Adobe CC Release Notes',
    category: 'adobe',
    url: 'https://helpx.adobe.com/kr/creative-cloud/apps/whats-new/release-notes.html',
    parser: 'adobe_helpx',
  },
  {
    label: 'Adobe Firefly Whats New',
    category: 'adobe',
    url: 'https://helpx.adobe.com/firefly/web/whats-new/new-features/whats-new.html',
    parser: 'adobe_helpx',
  },
];

const MAX_PER_CATEGORY = 2;
const MAX_TOTAL = 10;
// ──────────────────────────────────────────────────

function hasKeyword(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

// ── HTML 텍스트 정제 공통 함수 ──────────────────────
function cleanHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#[0-9]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Figma 릴리즈 노트 파싱 ──────────────────────────
// 구조: 날짜 텍스트 → 태그들 → 기능 설명 텍스트 블록
function parseFigmaReleaseNotes(html) {
  // 메인 콘텐츠 영역만 추출 (nav/header 제거 후)
  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  const body = mainMatch ? mainMatch[1] : html;

  // 날짜 패턴: Apr 24, 2026 / April 24, 2026
  const datePattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},\s+\d{4}\b/;

  // 텍스트 블록 단위로 분리 (div/section/article 경계)
  const blocks = body.split(/<\/(?:div|section|article|li)>/i);

  let latestDate = '';
  let latestTitle = '';
  let latestDesc = '';

  for (const block of blocks) {
    const text = cleanHtml(block).replace(/\s+/g, ' ').trim();
    if (text.length < 20) continue;

    // 날짜 발견 → 기록
    const dateMatch = text.match(datePattern);
    if (dateMatch && !latestDate) {
      latestDate = dateMatch[0];
    }

    // 날짜가 기록된 뒤 의미있는 설명 블록 찾기
    if (latestDate && !latestDesc && text.length > 60 && !text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/)) {
      // 너무 짧거나 메뉴/태그 텍스트 같은 건 제외
      const wordCount = text.split(' ').length;
      if (wordCount > 10) {
        latestTitle = text.slice(0, 80);
        latestDesc = text.slice(0, 400);
      }
    }

    if (latestDate && latestDesc) break;
  }

  if (!latestDesc) return null;

  return {
    title: latestTitle || 'Figma 업데이트',
    desc: latestDesc,
    date: latestDate || new Date().toISOString(),
    link: 'https://www.figma.com/release-notes/',
  };
}

// ── Adobe helpx 릴리즈 노트 파싱 ───────────────────
// 구조: 버전/날짜 heading → ul 목록으로 변경사항 나열
function parseAdobeHelpxReleaseNotes(html) {
  // 사이드바/메뉴 제거 후 메인 영역 추출
  const articleMatch = html.match(/<(?:article|main|div[^>]*?class="[^"]*content[^"]*")[^>]*>([\s\S]*?)<\/(?:article|main|div)>/i);
  const body = articleMatch ? articleMatch[1] : html;

  // h2/h3 기준으로 섹션 분할
  const sections = body.split(/<h[23][^>]*>/i);

  let bestTitle = '';
  let bestDesc = '';
  let bestDate = '';

  const datePattern = /\b(20\d{2})\b.*?([\d]{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+20\d{2})/i;

  for (const section of sections.slice(1)) { // 첫 번째는 헤딩 이전 내용
    const headingEnd = section.indexOf('<');
    const headingText = headingEnd > 0 ? cleanHtml(section.slice(0, headingEnd + 50)).trim() : '';
    const bodyText = cleanHtml(section).replace(/\s+/g, ' ').trim();

    if (bodyText.length < 30) continue;

    // 날짜 있는 섹션 우선
    const dateMatch = bodyText.match(datePattern);
    if (dateMatch) {
      bestDate = dateMatch[0].slice(0, 30);
    }

    // 첫 번째 실질적인 섹션 내용 사용
    if (!bestDesc && bodyText.length > 80) {
      bestTitle = headingText.slice(0, 80) || bodyText.slice(0, 60);
      bestDesc = bodyText.slice(0, 400);
      if (bestDate) break;
    }
  }

  if (!bestDesc) return null;

  return {
    title: bestTitle || 'Adobe 업데이트',
    desc: bestDesc,
    date: bestDate || new Date().toISOString(),
    link: 'https://helpx.adobe.com/kr/creative-cloud/apps/whats-new/release-notes.html',
  };
}

// ── 크롤링 실행 함수 ────────────────────────────────
async function scrapeReleaseNote(source) {
  console.log(`🕷️  [${source.category}] 크롤링: ${source.label}`);
  try {
    const html = await fetchUrl(source.url);

    let item = null;
    if (source.parser === 'figma') {
      item = parseFigmaReleaseNotes(html);
    } else if (source.parser === 'adobe_helpx') {
      item = parseAdobeHelpxReleaseNotes(html);
    }

    if (!item) {
      console.log(`  ⚠️ 파싱 결과 없음`);
      return null;
    }

    console.log(`  📰 "${item.title.slice(0, 60)}"`);
    console.log(`  🤖 OpenAI 요약 중...`);
    await sleep(500);

    const summarized = await summarizeWithOpenAI(item.title, item.desc);

    console.log(`  ✅ 완료`);
    return {
      category: source.category,
      title: summarized.title || item.title,
      summary: summarized.summary || item.desc.slice(0, 120),
      summary_full: summarized.summary_full || item.desc,
      keywords: summarized.keywords || [],
      source: source.label,
      date: formatDate(item.date),
      url: item.link,
    };
  } catch (err) {
    console.log(`  ❌ 실패: ${err.message}`);
    return null;
  }
}

// ── YouTube Atom 피드 파싱 ──────────────────────────
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

// ── RSS XML 파싱 ────────────────────────────────────
function parseRSS(xml) {
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
        'Accept': 'text/html,application/rss+xml,application/atom+xml,application/xml,text/xml,*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8'
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

  // ── 1단계: 크롤링 소스 (Figma / Adobe 릴리즈 노트) ──
  console.log('\n── 크롤링 소스 수집 중 ──');
  for (const source of SCRAPE_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;
    const count = categoryCount[source.category] || 0;
    if (count >= MAX_PER_CATEGORY) continue;

    const result = await scrapeReleaseNote(source);
    if (result) {
      articles.push(result);
      categoryCount[source.category] = count + 1;
    }
    await sleep(1000); // 크롤링 간 텀
  }

  // ── 2단계: RSS 소스 ──────────────────────────────────
  console.log('\n── RSS 소스 수집 중 ──');
  for (const source of RSS_SOURCES) {
    if (articles.length >= MAX_TOTAL) break;
    const count = categoryCount[source.category] || 0;
    if (count >= MAX_PER_CATEGORY) continue;

    console.log(`📡 [${source.category}] ${source.label || source.url}`);
    try {
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml);

      if (items.length === 0) { console.log(`  ⚠️ 기사 없음`); continue; }

      const filtered = source.filterKeyword
        ? items.filter(item => hasKeyword(item.title + ' ' + item.desc))
        : items;

      if (filtered.length === 0) { console.log(`  ⚠️ 키워드 매칭 기사 없음`); continue; }

      const item = filtered[0];
      console.log(`  📰 "${item.title.slice(0,60)}"`);

      if (!item.desc || item.desc.length < 10) item.desc = item.title;

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
