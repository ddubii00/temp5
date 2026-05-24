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

async function handleApi(req, res, url) {
  if (url.pathname === "/api/markets") {
    sendJson(res, 200, { markets: getMarkets() });
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
