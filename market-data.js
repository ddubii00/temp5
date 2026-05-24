const NAVER_MARKET_SUM_URL = "https://finance.naver.com/sise/sise_market_sum.naver";
const WIKI_NASDAQ_100_URL = "https://en.wikipedia.org/wiki/Nasdaq-100";
const WIKI_DOW_URL = "https://en.wikipedia.org/wiki/Dow_Jones_Industrial_Average";
const MARKETCAP_NASDAQ_100_URL =
  "https://marketcap.company/stock-indices/nasdaq-100-index-market-cap/";
const MARKETCAP_DOW_URL =
  "https://marketcap.company/stock-indices/dow-jones-industrial-average-index-market-cap/";
const STOOQ_QUOTE_URL = "https://stooq.com/q/l/";
const CACHE_TTL_MS = 45_000;
const US_QUOTE_CONCURRENCY = 4;

const cache = new Map();
const inflightFetches = new Map();

const markets = {
  kospi: {
    id: "kospi",
    label: "KOSPI Top 100",
    title: "오늘 KOSPI 시가총액 Top 100",
    eyebrow: "Korea Market Cap",
    sourceName: "Naver Finance",
    sourceUrl: "https://finance.naver.com/sise/sise_market_sum.naver?sosok=0",
    timezone: "Asia/Seoul",
    rankLabel: "시총 순위",
    extraLabel: "시가총액(억)",
    extraType: "marketCap",
    metricLabel: "시총 합계",
    currency: "KRW",
  },
  kosdaq: {
    id: "kosdaq",
    label: "KOSDAQ Top 50",
    title: "오늘 KOSDAQ 시가총액 Top 50",
    eyebrow: "Korea Growth Market",
    sourceName: "Naver Finance",
    sourceUrl: "https://finance.naver.com/sise/sise_market_sum.naver?sosok=1",
    timezone: "Asia/Seoul",
    rankLabel: "시총 순위",
    extraLabel: "시가총액(억)",
    extraType: "marketCap",
    metricLabel: "시총 합계",
    currency: "KRW",
  },
  nasdaq100: {
    id: "nasdaq100",
    label: "NASDAQ 100",
    title: "NASDAQ 100 구성종목",
    eyebrow: "US Growth Index",
    sourceName: "MarketCap.Company + Stooq",
    sourceUrl: MARKETCAP_NASDAQ_100_URL,
    timezone: "America/New_York",
    rankLabel: "시총 순위",
    extraLabel: "시가총액",
    extraType: "marketCapUsd",
    metricLabel: "시총 합계",
    currency: "USD",
  },
  dow: {
    id: "dow",
    label: "Dow",
    title: "Dow Jones 구성종목",
    eyebrow: "US Blue Chips",
    sourceName: "MarketCap.Company + Stooq",
    sourceUrl: MARKETCAP_DOW_URL,
    timezone: "America/New_York",
    rankLabel: "시총 순위",
    extraLabel: "시가총액",
    extraType: "marketCapUsd",
    metricLabel: "시총 합계",
    currency: "USD",
  },
};

function decodeHtml(text) {
  return text.replace(/&(#\d+|#x[\da-fA-F]+|\w+);/g, (entity, code) => {
    if (code[0] === "#") {
      const value =
        code[1].toLowerCase() === "x"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    }

    const named = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"',
    };
    return named[code] || entity;
  });
}

function cleanText(fragment = "") {
  return decodeHtml(fragment)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumeric(text) {
  const normalized = String(text || "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  if (!normalized || /^N\/?[AD]$/i.test(normalized)) {
    return null;
  }

  const value = Number(normalized.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function formatUsd(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
    : "";
}

function formatUsdMarketCap(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }

  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  return `$${value.toLocaleString("en-US")}`;
}

function parseUsdMarketCap(text) {
  const value = parseNumeric(text);
  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("trillion") || /\bt\b/.test(normalized)) {
    return value * 1_000_000_000_000;
  }
  if (normalized.includes("billion") || /\bb\b/.test(normalized)) {
    return value * 1_000_000_000;
  }
  if (normalized.includes("million") || /\bm\b/.test(normalized)) {
    return value * 1_000_000;
  }
  return value;
}

function signedText(value, formatter = (number) => String(number)) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatter(value)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function signedRate(rateText, direction) {
  const absolute = parseNumeric(rateText);
  if (absolute === null) {
    return null;
  }

  if (String(rateText).includes("-") || direction === "하락") {
    return -Math.abs(absolute);
  }

  if (String(rateText).includes("+") || direction === "상승") {
    return Math.abs(absolute);
  }

  return 0;
}

function parseMarketCapPage(html) {
  const rows = [];
  const rowRegex =
    /<tr[^>]*onMouseOver=["']mouseOver\(this\)["'][^>]*>([\s\S]*?)<\/tr>/gi;

  for (const rowMatch of html.matchAll(rowRegex)) {
    const row = rowMatch[1];
    const rankMatch = /<td[^>]*class=["']no["'][^>]*>(\d+)<\/td>/i.exec(row);
    const nameMatch =
      /<a\s+href=["']\/item\/main\.naver\?code=([a-zA-Z0-9]+)["']\s+class=["']tltle["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        row,
      );

    if (!rankMatch || !nameMatch) {
      continue;
    }

    const numberCells = [...row.matchAll(/<td[^>]*class=["']number["'][^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => cleanText(match[1]),
    );
    const direction =
      cleanText(row.match(/<span[^>]*class=["']blind["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "") ||
      (numberCells[2]?.includes("-") ? "하락" : numberCells[2]?.includes("+") ? "상승" : "보합");
    const code = nameMatch[1];

    rows.push({
      rank: Number(rankMatch[1]),
      code,
      name: cleanText(nameMatch[2]),
      price: parseNumeric(numberCells[0]),
      priceText: numberCells[0] || "",
      change: parseNumeric(numberCells[1]),
      changeText: numberCells[1] || "",
      changeDirection: direction,
      changeRate: signedRate(numberCells[2], direction),
      changeRateText: numberCells[2] || "",
      parValue: parseNumeric(numberCells[3]),
      marketCap: parseNumeric(numberCells[4]),
      marketCapText: numberCells[4] || "",
      listedShares: parseNumeric(numberCells[5]),
      foreignRatio: parseNumeric(numberCells[6]),
      volume: parseNumeric(numberCells[7]),
      volumeText: numberCells[7] || "",
      per: parseNumeric(numberCells[8]),
      roe: parseNumeric(numberCells[9]),
      detailUrl: `https://finance.naver.com/item/main.naver?code=${code}`,
    });
  }

  return rows;
}

async function fetchMarketCapPage(sosok, page) {
  const params = new URLSearchParams({
    page: String(page),
    sosok: String(sosok),
  });
  const response = await fetch(`${NAVER_MARKET_SUM_URL}?${params.toString()}`, {
    headers: {
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Naver Finance responded with ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const html = new TextDecoder("euc-kr").decode(buffer);
  return parseMarketCapPage(html);
}

async function getKospiTop100(forceRefresh = false) {
  return getKoreanMarket("kospi", 0, 100, forceRefresh);
}

async function getKosdaqTop50(forceRefresh = false) {
  return getKoreanMarket("kosdaq", 1, 50, forceRefresh);
}

async function getKoreanMarket(marketId, sosok, count, forceRefresh = false) {
  return getCachedMarket(marketId, forceRefresh, async () => {
    const pageCount = Math.ceil(count / 50);
    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, index) => fetchMarketCapPage(sosok, index + 1)),
    );
    const items = pages.flat().sort((a, b) => a.rank - b.rank).slice(0, count);

    if (items.length < count) {
      throw new Error(`Expected ${count} rows, received ${items.length}`);
    }
    const config = markets[marketId];
    return {
      ...config,
      market: config.label,
      count: items.length,
      items,
    };
  });
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} responded with ${response.status}`);
  }

  return response.text();
}

function parseHtmlRows(tableHtml) {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  return [...tableHtml.matchAll(rowRegex)]
    .map((rowMatch) =>
      [...rowMatch[1].matchAll(cellRegex)].map((cellMatch) =>
        cleanText(cellMatch[1].replace(/<sup[\s\S]*?<\/sup>/gi, "")),
      ),
    )
    .filter((cells) => cells.some(Boolean));
}

function findWikiTable(html, matcher) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((candidate) => matcher(cleanText(candidate)));

  if (!table) {
    throw new Error("구성종목 표를 찾지 못했습니다.");
  }

  return table;
}

function parseMarketCapCompanyRows(html, limit) {
  const rowRegex = /<tr[^>]*class=["'][^"']*constituent-row[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];

  for (const match of html.matchAll(rowRegex)) {
    const row = match[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
      cleanText(cell[1]),
    );
    const name = cleanText(row.match(/class=["']company-link["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const symbolCell = cleanText(
      row.match(/class=["']company-symbol["'][^>]*>([\s\S]*?)<\/small>/i)?.[1] || "",
    );
    const code = symbolCell.split(":").pop();
    const rank = parseNumeric(cells[0]);
    const marketCapText = cells[3] || "";
    const marketCap = parseUsdMarketCap(marketCapText);

    if (!code || !name || !Number.isFinite(rank)) {
      continue;
    }

    rows.push({
      rank,
      code,
      name,
      sector: cells[4] || "",
      industry: cells[5] || "",
      marketCap,
      marketCapText: marketCapText.replace(/\s+/g, " "),
      price: parseNumeric(cells[6]),
      priceText: cells[6]?.replace(/^\$/, "") || "",
      changeRate: parseNumeric(cells[7]),
      changeRateText: cells[7] || "",
      changeDirection: String(cells[7] || "").includes("-") ? "하락" : "상승",
      currency: "USD",
    });
  }

  return rows
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      marketCapText: item.marketCapText || formatUsdMarketCap(item.marketCap),
    }));
}

async function fetchUsMarketCapRanking(marketId) {
  const url = marketId === "nasdaq100" ? MARKETCAP_NASDAQ_100_URL : MARKETCAP_DOW_URL;
  const limit = marketId === "nasdaq100" ? 100 : 30;
  const pageCount = Math.ceil(limit / 50);
  const pages = await Promise.all(
    Array.from({ length: pageCount }, async (_, index) => {
      if (index === 0) {
        return fetchHtml(url);
      }
      const pageUrl = `${url}?page=${index + 1}`;
      return fetchHtml(pageUrl);
    }),
  );
  const rows = pages
    .flatMap((html) => parseMarketCapCompanyRows(html, 1000))
    .filter(
      (item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index,
    )
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

  if (rows.length < limit) {
    throw new Error(`Expected ${limit} ${marketId} market-cap rows, received ${rows.length}`);
  }

  return rows;
}

async function fetchNasdaq100Constituents() {
  const html = await fetchHtml(WIKI_NASDAQ_100_URL);
  const table = findWikiTable(
    html,
    (text) => text.includes("Ticker Company") && text.includes("ICB Industry"),
  );

  return parseHtmlRows(table)
    .filter((cells) => /^[A-Z][A-Z0-9.-]*$/.test(cells[0]) && cells[0] !== "Ticker")
    .slice(0, 100)
    .map((cells, index) => ({
      rank: index + 1,
      code: cells[0],
      name: cells[1],
      sector: cells[2] || "",
    }));
}

async function fetchDowConstituents() {
  const html = await fetchHtml(WIKI_DOW_URL);
  const table = findWikiTable(
    html,
    (text) => text.includes("DJIA component companies") && text.includes("Symbol"),
  );

  return parseHtmlRows(table)
    .filter((cells) => /^[A-Z][A-Z0-9.-]*$/.test(cells[2]) && cells[2] !== "Symbol")
    .map((cells, index) => ({
      rank: index + 1,
      code: cells[2],
      name: cells[0],
      sector: cells[3] || "",
    }));
}

function stooqSymbol(symbol) {
  return `${symbol.toLowerCase().replace(/\./g, "-")}.us`;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

async function fetchStooqQuote(symbol) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchStooqQuoteOnce(symbol);
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

async function fetchStooqQuoteOnce(symbol) {
  const stooqCode = stooqSymbol(symbol);
  const params = new URLSearchParams({
    e: "csv",
    f: "sd2t2ohlcvp",
    h: "",
    s: stooqCode,
  });
  const response = await fetch(`${STOOQ_QUOTE_URL}?${params.toString()}`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`${symbol} quote responded with ${response.status}`);
  }

  const csv = await response.text();
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error(`${symbol} quote row missing`);
  }

  const cells = parseCsvLine(lines[1]);
  const price = parseNumeric(cells[6]);
  const previousClose = parseNumeric(cells[8]);
  const change = Number.isFinite(price) && Number.isFinite(previousClose) ? price - previousClose : null;
  const changeRate =
    Number.isFinite(change) && previousClose !== 0 ? (change / previousClose) * 100 : null;

  return {
    price,
    priceText: formatUsd(price),
    change,
    changeText: signedText(change, (value) => formatUsd(value)),
    changeDirection: change > 0 ? "상승" : change < 0 ? "하락" : "보합",
    changeRate,
    changeRateText: signedText(changeRate, (value) => `${formatUsd(value)}%`),
    volume: parseNumeric(cells[7]),
    volumeText: Number.isFinite(parseNumeric(cells[7]))
      ? parseNumeric(cells[7]).toLocaleString("en-US")
      : "",
    currency: "USD",
    detailUrl: `https://stooq.com/q/?s=${encodeURIComponent(stooqCode)}`,
  };
}

async function mapWithLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function enrichUsMarket(contributors, marketId) {
  const quotes = await mapWithLimit(contributors, US_QUOTE_CONCURRENCY, async (item) => {
    try {
      return await fetchStooqQuote(item.code);
    } catch (error) {
      return {
        price: null,
        priceText: "",
        change: null,
        changeText: "",
        changeDirection: "보합",
        changeRate: null,
        changeRateText: "",
        volume: null,
        volumeText: "",
        currency: "USD",
        detailUrl: `https://stooq.com/q/?s=${encodeURIComponent(stooqSymbol(item.code))}`,
        quoteError: error.message,
      };
    }
  });

  return contributors.map((item, index) => ({
    ...item,
    market: marketId,
    ...quotes[index],
  }));
}

async function getUsMarket(marketId, forceRefresh = false) {
  return getCachedMarket(marketId, forceRefresh, async () => {
    const constituents = await fetchUsMarketCapRanking(marketId);
    const items = await enrichUsMarket(constituents, marketId);
    const config = markets[marketId];

    return {
      ...config,
      market: config.label,
      count: items.length,
      items: items
        .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
        .map((item, index) => ({
          ...item,
          rank: index + 1,
          marketCapText: item.marketCapText || formatUsdMarketCap(item.marketCap),
        })),
    };
  });
}

async function getCachedMarket(marketId, forceRefresh, fetcher) {
  const current = cache.get(marketId);
  const isFresh = current && Date.now() - current.cachedAt < CACHE_TTL_MS;
  if (!forceRefresh && isFresh) {
    return current.payload;
  }

  if (!forceRefresh && inflightFetches.has(marketId)) {
    return inflightFetches.get(marketId);
  }

  const inflight = fetcher()
    .then((payload) => {
      const nextPayload = {
        ...payload,
        retrievedAt: new Date().toISOString(),
      };
      cache.set(marketId, {
        cachedAt: Date.now(),
        payload: nextPayload,
      });
      return nextPayload;
    })
    .finally(() => {
      inflightFetches.delete(marketId);
    });

  inflightFetches.set(marketId, inflight);
  return inflight;
}

async function getMarketPayload(marketId, forceRefresh = false) {
  if (marketId === "kospi") {
    return getKospiTop100(forceRefresh);
  }

  if (marketId === "kosdaq") {
    return getKosdaqTop50(forceRefresh);
  }

  if (marketId === "nasdaq100" || marketId === "dow") {
    return getUsMarket(marketId, forceRefresh);
  }

  throw new Error(`Unknown market: ${marketId}`);
}

function getMarkets() {
  return Object.values(markets);
}

module.exports = {
  getMarketPayload,
  getMarkets,
};
