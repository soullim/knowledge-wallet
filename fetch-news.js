const https = require('https');
const http = require('http');
const fs = require('fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── 키워드 필터 (국내 사이트용) ───────────────────
const KEYWORDS = [
  '디자인', '피그마', '어도비', '퍼블리싱', '트렌드', 'AI', '인공지능',
  '클로드','클로드디자인','UX', 'UI', '프론트엔드', '웹디자인', '모션', '포토샵','파이어플라이','firefly',
  '일러스트', 'figma', 'adobe', 'design', 'frontend', 'ux', 'ui',
  'ChatGPT', 'GPT', '생성형', '브랜드', '타이포그래피', '컬러'
];

// ── RSS 소스 ───────────────────────────────────────
const RSS_SOURCES = [

  // ── AI 뉴스 ──────────────────────────────────────
  // 다양한 AI 기업 공식 블로그 + 큐레이션 미디어
  // Anthropic: 공식 RSS 없음 → Google News 쿼리로 대체
  { url: 'https://openai.com/news/rss.xml',                                                       category: 'ai', label: 'OpenAI News',              filterKeyword: false },
  { url: 'https://deepmind.google/blog/rss.xml',                                                  category: 'ai', label: 'Google DeepMind Blog',     filterKeyword: false },
  { url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_mistral.xml',      category: 'ai', label: 'Mistral AI',               filterKeyword: false },
  { url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_research.xml', category: 'ai', label: 'Anthropic Research', filterKeyword: false },
  { url: 'https://www.theverge.com/rss/index.xml',                                                category: 'ai', label: 'The Verge',               filterKeyword: true  },  // 전체 피드 + AI 키워드 필터
  { url: 'https://tldrnewsletter.com/tag/ai/rss',                                                 category: 'ai', label: 'TLDR AI',                  filterKeyword: false },
  { url: 'https://huggingface.co/blog/feed.xml',                                                  category: 'ai', label: 'HuggingFace Blog',         filterKeyword: false },
  { url: 'https://news.google.com/rss/search?q=Anthropic+Claude+AI&hl=ko&gl=KR&ceid=KR:ko',      category: 'ai', label: 'Google News Anthropic',    filterKeyword: false },
  { url: 'https://news.google.com/rss/search?q=AI+인공지능+LLM+출시&hl=ko&gl=KR&ceid=KR:ko',    category: 'ai', label: 'Google News AI (KR)',       filterKeyword: true  },

  // ── 업계동향 ─────────────────────────────────────
  { url: 'https://uxdesign.cc/feed',                                                          category: 'industry', filterKeyword: false },
  { url: 'https://thenextweb.com/feed/',                                                      category: 'industry', filterKeyword: false },
  // 국내
  { url: 'https://byline.network/feed',                                                       category: 'industry', label: '바이라인네트워크', filterKeyword: true },
  { url: 'https://channel.io/ko/blog/rss',                                                     category: 'industry', label: 'Channel.io Blog', filterKeyword: true },

  // ── 디자인 ───────────────────────────────────────
  { url: 'https://www.smashingmagazine.com/feed/',                                            category: 'design', filterKeyword: false },
  { url: 'https://alistapart.com/main/feed/',                                                 category: 'design', filterKeyword: false },
  // 국내
  { url: 'https://eopla.net/magazines/rss',                                                   category: 'design', filterKeyword: true },
  { url: 'https://news.google.com/rss/search?q=디자인+UX+UI+트렌드&hl=ko&gl=KR&ceid=KR:ko', category: 'design', label: 'Google News Design (KR)', filterKeyword: true },

  // ── 트렌드 ───────────────────────────────────────
  { url: 'https://www.wired.com/feed/rss',                                                   category: 'trend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/design',                                                   category: 'trend', filterKeyword: false },

  // ── 프론트엔드 ────────────────────────────────────
  { url: 'https://css-tricks.com/feed/',                                                      category: 'frontend', filterKeyword: false },
  { url: 'https://dev.to/feed/tag/webdev',                                                   category: 'frontend', filterKeyword: false },
  { url: 'https://toss.tech/rss.xml',                                                        category: 'frontend', filterKeyword: true },
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
  // ── 새 크롤링 소스 (RSS 없는 국내 디자인/문화 사이트) ──
  {
    label: 'TMSS 매거진',
    category: 'design',
    url: 'https://www.tmssmag.com/',
    parser: 'generic_list',   // <a> 링크 목록에서 제목 추출
  },
  {
    label: 'Secondbrush Blog',
    category: 'design',
    url: 'https://blog.secondbrush.co.kr/',
    parser: 'generic_list',
  },
  {
    label: '오늘의집 Culture',
    category: 'industry',
    url: 'https://www.bucketplace.com/culture/',
    parser: 'generic_list',
  },
];

const MAX_PER_CATEGORY = 10; // 카테고리당 최대 수집
const MAX_TOTAL = 70;          // 하루 전체 최대 (7카테고리 × 10개)
const MAX_KEEP_DAYS = 30;  // 최대 보관 일수 (오래된 기사 자동 삭제)
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

// ── 일반 목록 페이지 파싱 (RSS 없는 블로그/매거진) ──
// 전략: <a href> 링크 중 본문 글 링크처럼 보이는 것을 뽑아 제목+URL 추출
function parseGenericList(html, baseUrl) {
  // 불필요한 블록 제거 (정규식 변수로 분리)
  const rScript = new RegExp('<script[\\s\\S]*?<\\/script>', 'gi');
  const rStyle  = new RegExp('<style[\\s\\S]*?<\\/style>',  'gi');
  const rNav    = new RegExp('<nav[\\s\\S]*?<\\/nav>',      'gi');
  const rHeader = new RegExp('<header[\\s\\S]*?<\\/header>','gi');
  const rFooter = new RegExp('<footer[\\s\\S]*?<\\/footer>','gi');
  const cleaned = html
    .replace(rScript, '').replace(rStyle, '').replace(rNav, '')
    .replace(rHeader, '').replace(rFooter, '');

  const rLink = new RegExp('<a[^>]+href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>', 'gi');
  const candidates = [];
  let match;

  while ((match = rLink.exec(cleaned)) !== null) {
    let href = match[1];
    const rawText = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (rawText.length < 15 || rawText.length > 200) continue;
    if (href.startsWith('#') || href.startsWith('javascript') || href.startsWith('mailto')) continue;
    if (href.startsWith('/')) {
      try { href = new URL(href, baseUrl).href; } catch { continue; }
    }
    if (!href.startsWith('http')) continue;
    try {
      const baseDomain = new URL(baseUrl).hostname.replace('www.', '');
      if (!new URL(href).hostname.includes(baseDomain)) continue;
    } catch { continue; }
    if (candidates.some(c => c.href === href)) continue;
    candidates.push({ href, text: rawText });
  }

  if (!candidates.length) return null;
  const best = candidates[0];
  return {
    title: best.text.slice(0, 120),
    desc: best.text,
    date: new Date().toISOString(),
    link: best.href,
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
    } else if (source.parser === 'generic_list') {
      item = parseGenericList(html, source.url);
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
      publishedAt: toISODate(item.date),   // 정렬용 ISO 날짜
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

// 정렬용 ISO 날짜 문자열 반환 (파싱 실패 시 오늘)
function toISODate(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) throw new Error();
    return d.toISOString();
  } catch {
    return new Date().toISOString();
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
        publishedAt: toISODate(item.date),   // 정렬용 ISO 날짜
        url: item.link
      });

      categoryCount[source.category] = count + 1;
      console.log(`  ✅ 완료`);

    } catch (err) {
      console.log(`  ❌ 실패: ${err.message}`);
    }
  }

  // ── 기존 데이터 병합 ──────────────────────────────
  let existingArticles = [];
  try {
    const existing = JSON.parse(fs.readFileSync('news.json', 'utf-8'));
    existingArticles = existing.articles || [];
    console.log(`\n📂 기존 기사 ${existingArticles.length}개 로드됨`);
  } catch {
    console.log('\n📂 기존 news.json 없음 → 새로 생성');
  }

  // 오늘 날짜 태그 (YYYY-MM-DD) 부여
  const todayTag = new Date().toISOString().slice(0, 10);
  const taggedNew = articles.map(a => ({ ...a, collectedAt: todayTag }));

  // 중복 제거: URL 기준 (오늘 새로 수집된 것이 우선)
  const newUrls = new Set(taggedNew.map(a => a.url));
  const deduped = [
    ...taggedNew,
    ...existingArticles.filter(a => !newUrls.has(a.url))
  ];

  // 날짜 오래된 것 자동 삭제 (MAX_KEEP_DAYS 초과분)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_KEEP_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const merged = deduped.filter(a => !a.collectedAt || a.collectedAt >= cutoffStr);

  // 최신순 정렬: publishedAt(원본 발행일) 우선, 없으면 collectedAt(수집일) 사용
  merged.sort((a, b) => {
    const da = a.publishedAt || a.collectedAt || '';
    const db = b.publishedAt || b.collectedAt || '';
    return db.localeCompare(da);
  });

  console.log(`📊 병합 결과: 오늘 ${taggedNew.length}개 + 기존 ${existingArticles.length}개 → 총 ${merged.length}개`);

  const output = {
    updated: new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }),
    count: merged.length,
    articles: merged
  };

  fs.writeFileSync('news.json', JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✨ 완료! 총 ${merged.length}개 카드 저장 (오늘 ${taggedNew.length}개 신규)`);
  if (articles.length === 0) console.log('⚠️ 오늘 수집된 기사 없음.');
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
