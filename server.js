const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { getMarketPayload, getMarkets } = require("./market-data");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  send(res, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function parseNumeric(text) {
  const normalized = String(text || "").replace(/,/g, "").replace(/%/g, "").trim();
  if (!normalized || /^N\/?[AD]$/i.test(normalized)) {
    return null;
  }
  const value = Number(normalized.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  let prev = null;
  return values.map((value) => {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (prev === null) {
      prev = value;
      return value;
    }
    prev = (value - prev) * multiplier + prev;
    return prev;
  });
}

async function fetchKoreanOhlcv(code, days) {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${encodeURIComponent(
    code,
  )}&timeframe=day&count=${days + 240}&requestType=0`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Naver chart responded with ${response.status}`);
  }
  const xml = await response.text();
  const rows = [...xml.matchAll(/item data="([^"]+)"/g)]
    .map((m) => m[1].split("|"))
    .map((parts) => ({
      date: parts[0],
      open: parseNumeric(parts[1]),
      high: parseNumeric(parts[2]),
      low: parseNumeric(parts[3]),
      close: parseNumeric(parts[4]),
      volume: parseNumeric(parts[5]),
    }))
    .filter((x) => x.open !== null && x.high !== null && x.low !== null && x.close !== null);
  return rows.slice(-days);
}

async function fetchUsOhlcv(code, days) {
  const symbol = code.toUpperCase();
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol,
    )}?range=2y&interval=1d`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Yahoo chart responded with ${response.status}`);
  }
  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const stamps = result?.timestamp || [];
  const rows = stamps
    .map((stamp, i) => ({
      date: new Date(stamp * 1000).toISOString().slice(0, 10).replace(/-/g, ""),
      open: quote?.open?.[i] ?? null,
      high: quote?.high?.[i] ?? null,
      low: quote?.low?.[i] ?? null,
      close: quote?.close?.[i] ?? null,
      volume: quote?.volume?.[i] ?? null,
    }))
    .filter((x) => Number.isFinite(x.open) && Number.isFinite(x.high) && Number.isFinite(x.low) && Number.isFinite(x.close));
  return rows.slice(-days);
}

function toTime(dateYYYYMMDD) {
  return `${dateYYYYMMDD.slice(0, 4)}-${dateYYYYMMDD.slice(4, 6)}-${dateYYYYMMDD.slice(6, 8)}`;
}

function aggregateRows(rows, timeframe) {
  if (timeframe === "day") return rows;
  const groups = new Map();
  for (const row of rows) {
    const d = row.date;
    const year = d.slice(0, 4);
    const month = d.slice(4, 6);
    const day = d.slice(6, 8);
    let key;
    if (timeframe === "month") {
      key = `${year}${month}`;
    } else {
      const dt = new Date(`${year}-${month}-${day}T00:00:00Z`);
      const start = new Date(dt);
      const wd = (dt.getUTCDay() + 6) % 7;
      start.setUTCDate(dt.getUTCDate() - wd);
      key = start.toISOString().slice(0, 10).replace(/-/g, "");
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const [k, arr] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({
      date: timeframe === "month" ? `${k}01` : k,
      open: arr[0].open,
      high: Math.max(...arr.map((x) => x.high)),
      low: Math.min(...arr.map((x) => x.low)),
      close: arr[arr.length - 1].close,
      volume: arr.reduce((s, x) => s + (x.volume || 0), 0),
    });
  }
  return out;
}

function buildIndicators(rows) {
  const closes = rows.map((r) => r.close);
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);
  const maPeriods = [5, 10, 20, 60, 120, 240];
  const mas = Object.fromEntries(
    maPeriods.map((p) => [
      p,
      closes.map((_, i) => {
        if (i < p - 1) return null;
        const window = closes.slice(i - p + 1, i + 1);
        const avg = window.reduce((a, b) => a + b, 0) / p;
        return avg;
      }),
    ]),
  );
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = closes.map((_, i) =>
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : null,
  );
  const signal = ema(macd.map((x) => (x === null ? 0 : x)), 9).map((x, i) =>
    macd[i] === null ? null : x,
  );
  const histogram = macd.map((x, i) =>
    x !== null && signal[i] !== null ? x - signal[i] : null,
  );
  const mid = (arrH, arrL, i, p) => {
    if (i < p - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - p + 1; k <= i; k += 1) {
      hi = Math.max(hi, arrH[k]);
      lo = Math.min(lo, arrL[k]);
    }
    return (hi + lo) / 2;
  };
  const tenkan = highs.map((_, i) => mid(highs, lows, i, 9));
  const kijun = highs.map((_, i) => mid(highs, lows, i, 26));
  const senkouA = highs.map((_, i) =>
    tenkan[i] !== null && kijun[i] !== null ? (tenkan[i] + kijun[i]) / 2 : null,
  );
  const senkouB = highs.map((_, i) => mid(highs, lows, i, 52));
  return { mas, macd, signal, histogram, tenkan, kijun, senkouA, senkouB };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/markets") {
    sendJson(res, 200, { markets: getMarkets() });
    return;
  }

  if (url.pathname === "/api/ohlcv") {
    try {
      const marketId = url.searchParams.get("market") || "kospi";
      const code = (url.searchParams.get("code") || "").toUpperCase();
      const days = Math.max(30, Math.min(1200, Number(url.searchParams.get("days") || 800)));
      const timeframe = (url.searchParams.get("timeframe") || "day").toLowerCase();
      if (!code) {
        sendJson(res, 400, { error: "code is required" });
        return;
      }
      const isKorean = marketId === "kospi" || marketId === "kosdaq";
      const lookbackDays =
        timeframe === "month"
          ? Math.min(10000, Math.max(days * 31 + 800, 2200))
          : timeframe === "week"
            ? Math.min(4000, Math.max(days * 7 + 400, 900))
          : Math.min(2400, days + 400);
      const rows = isKorean
        ? await fetchKoreanOhlcv(code, lookbackDays)
        : await fetchUsOhlcv(code, lookbackDays);
      const periodRows = aggregateRows(rows, timeframe);
      const indicators = buildIndicators(periodRows);
      const start = Math.max(0, periodRows.length - days);
      const viewRows = periodRows.slice(start);
      const items = viewRows.map((r, i) => {
        const idx = start + i;
        return {
        time: toTime(r.date),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        ma5: indicators.mas[5][idx],
        ma10: indicators.mas[10][idx],
        ma20: indicators.mas[20][idx],
        ma60: indicators.mas[60][idx],
        ma120: indicators.mas[120][idx],
        ma240: indicators.mas[240][idx],
        macd: indicators.macd[idx],
        signal: indicators.signal[idx],
        histogram: indicators.histogram[idx],
        tenkan: indicators.tenkan[idx],
        kijun: indicators.kijun[idx],
        senkouA: indicators.senkouA[idx],
        senkouB: indicators.senkouB[idx],
      };
      });
      sendJson(res, 200, { market: marketId, code, days, timeframe, items });
    } catch (error) {
      sendJson(res, 502, { error: "차트 데이터를 가져오지 못했습니다.", detail: error.message });
    }
    return;
  }

  if (url.pathname !== "/api/market" && url.pathname !== "/api/kospi-top100") {
    sendJson(res, 404, { error: "API endpoint not found" });
    return;
  }

  try {
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const marketId =
      url.pathname === "/api/kospi-top100" ? "kospi" : url.searchParams.get("market") || "kospi";
    const payload = await getMarketPayload(marketId, forceRefresh);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "시장 데이터를 가져오지 못했습니다.",
      detail: error.message,
    });
  }
}

async function handleStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, requestedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(file);
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  await handleStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Market board app running at http://${HOST}:${PORT}`);
});
