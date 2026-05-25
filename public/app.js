const state = {
  items: [],
  meta: {
    currency: "KRW",
    extraLabel: "시가총액(억)",
    extraType: "marketCap",
    eyebrow: "Korea Market Cap",
    metricLabel: "시총 합계",
    rankLabel: "시총 순위",
    title: "오늘 KOSPI 시가총액 Top 100",
    timezone: "Asia/Seoul",
  },
  sourceName: "",
  sourceUrl: "",
  retrievedAt: "",
  query: "",
  direction: "all",
  error: "",
  sort: "rank",
  market: "kospi",
  selectedCode: "",
  selectedName: "",
  chartDays: 200,
  chartFetchDays: 700,
  chartTimeframe: "day",
  ichimokuDays: 200,
  ichimokuTimeframe: "day",
  loading: false,
  searchSuggestions: [],
};

const marketLabels = {
  dow: "Dow",
  kosdaq: "KOSDAQ Top 50",
  kospi: "KOSPI Top 100",
  nasdaq100: "NASDAQ 100",
};

const els = {
  avgRate: document.querySelector("#avgRate"),
  directionFilter: document.querySelector("#directionFilter"),
  downCount: document.querySelector("#downCount"),
  eyebrow: document.querySelector("#eyebrow"),
  extraHeader: document.querySelector("#extraHeader"),
  fourthMetricLabel: document.querySelector("#fourthMetricLabel"),
  marketButtons: document.querySelectorAll(".market-tab"),
  message: document.querySelector("#message"),
  pageTitle: document.querySelector("#pageTitle"),
  rankHeader: document.querySelector("#rankHeader"),
  refreshButton: document.querySelector("#refreshButton"),
  rows: document.querySelector("#stockRows"),
  searchInput: document.querySelector("#searchInput"),
  searchSuggestions: document.querySelector("#searchSuggestions"),
  searchSuggestionMenu: document.querySelector("#searchSuggestionMenu"),
  sortSelect: document.querySelector("#sortSelect"),
  sourceLabel: document.querySelector("#sourceLabel"),
  totalMarketCap: document.querySelector("#totalMarketCap"),
  updatedAt: document.querySelector("#updatedAt"),
  upCount: document.querySelector("#upCount"),
  visibleCount: document.querySelector("#visibleCount"),
  chartTitle: document.querySelector("#chartTitle"),
  daysInput: document.querySelector("#daysInput"),
  applyDaysButton: document.querySelector("#applyDaysButton"),
  ichimokuDaysInput: document.querySelector("#ichimokuDaysInput"),
  applyIchimokuDaysButton: document.querySelector("#applyIchimokuDaysButton"),
  priceChart: document.querySelector("#priceChart"),
  volumeChart: document.querySelector("#volumeChart"),
  macdChart: document.querySelector("#macdChart"),
  ichimokuChart: document.querySelector("#ichimokuChart"),
  priceLegend: document.querySelector("#priceLegend"),
  ichimokuLegend: document.querySelector("#ichimokuLegend"),
  chartModal: document.querySelector("#chartModal"),
  chartBackdrop: document.querySelector("#chartBackdrop"),
  closeChartButton: document.querySelector("#closeChartButton"),
  periodButtons: document.querySelectorAll("[data-timeframe]"),
  ichimokuPeriodButtons: document.querySelectorAll("[data-ichi-timeframe]"),
};

const numberFormatter = new Intl.NumberFormat("ko-KR");
const rateFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
let requestSerial = 0;
let chartRuntime = null;
let searchTimer = null;

function makeLegend(container, items) {
  container.innerHTML = "";
  container.style.display = "flex";
  container.style.visibility = "visible";
  container.style.opacity = "1";
  container.style.position = "relative";
  container.style.zIndex = "5";
  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "legend-btn";
    btn.textContent = item.label;
    btn.style.borderColor = item.color;
    btn.addEventListener("click", () => {
      item.visible = !item.visible;
      item.series.applyOptions({ visible: item.visible });
      btn.classList.toggle("is-off", !item.visible);
    });
    container.appendChild(btn);
  });
}

function renderSearchSuggestions(items) {
  state.searchSuggestions = items;
  els.searchSuggestions.innerHTML = items
    .map((x) => `<option value="${escapeHtml(`${x.name} (${x.code})`)}"></option>`)
    .join("");
  if (!items.length) {
    els.searchSuggestionMenu.style.display = "none";
    els.searchSuggestionMenu.innerHTML = "";
    return;
  }
  els.searchSuggestionMenu.innerHTML = items
    .map(
      (x) =>
        `<button type="button" class="search-suggestion-item" data-code="${escapeHtml(
          x.code,
        )}" data-name="${escapeHtml(x.name)}">${escapeHtml(x.name)} (${escapeHtml(x.code)})</button>`,
    )
    .join("");
  els.searchSuggestionMenu.style.display = "block";
  els.searchSuggestionMenu.querySelectorAll(".search-suggestion-item").forEach((button) => {
    button.addEventListener("mousedown", async (event) => {
      event.preventDefault();
      const code = button.dataset.code || "";
      const name = button.dataset.name || "";
      els.searchInput.value = `${name} (${code})`;
      els.searchSuggestionMenu.style.display = "none";
      try {
        await openChartByCode(code, name);
      } catch (error) {
        state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
        render();
      }
    });
  });
}

async function loadSearchSuggestions(query) {
  if (!query || query.trim().length < 1) {
    renderSearchSuggestions([]);
    return;
  }
  try {
    const params = new URLSearchParams({ market: state.market, q: query.trim() });
    const response = await fetch(`/api/search?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) return;
    renderSearchSuggestions(payload.items || []);
  } catch {
    renderSearchSuggestions([]);
  }
}

async function openChartByCode(code, name) {
  state.selectedCode = code;
  state.selectedName = name || code;
  await loadChartData();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  return Number.isFinite(value) ? numberFormatter.format(value) : "-";
}

function formatRate(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback || "-";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${rateFormatter.format(value)}%`;
}

function formatPlainNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatUnavailableMetric(value, suffix = "") {
  if (!Number.isFinite(value)) {
    return "N/A";
  }

  return `${formatPlainNumber(value)}${suffix}`;
}

function formatPrice(stock) {
  if (stock.priceText) {
    return stock.currency === "USD" ? `$${stock.priceText}` : stock.priceText;
  }

  if (!Number.isFinite(stock.price)) {
    return "-";
  }

  if (stock.currency === "USD") {
    return `$${stock.price.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }

  return formatNumber(stock.price);
}

function formatChange(stock) {
  if (!Number.isFinite(stock.change)) {
    return "-";
  }

  const sign = stock.change > 0 ? "+" : stock.change < 0 ? "-" : "";
  if (stock.currency === "USD") {
    return `${sign}$${Math.abs(stock.change).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }

  return `${sign}${formatNumber(Math.abs(stock.change))}`;
}

function rateClass(stock) {
  if (stock.changeRate > 0 || stock.changeDirection === "상승") {
    return "up";
  }
  if (stock.changeRate < 0 || stock.changeDirection === "하락") {
    return "down";
  }
  return "flat";
}

function marketCapToJo(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${rateFormatter.format(value / 10000)}조`;
}

function eokToJo(value) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${rateFormatter.format(value / 10000)}조`;
}

function formatUsdMarketCap(value) {
  if (!Number.isFinite(value)) {
    return "-";
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

  return `$${formatNumber(Math.round(value))}`;
}

function averageVolumeText(items) {
  const volumes = items.map((item) => item.volume).filter((value) => Number.isFinite(value));
  if (!volumes.length) {
    return "-";
  }

  const average = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
  return formatNumber(Math.round(average));
}

function currentSortOptions() {
  const options = [
    { label: state.meta.rankLabel || "순서", value: "rank" },
    { label: "등락률", value: "changeRate" },
    { label: "현재가", value: "price" },
    { label: "거래량", value: "volume" },
    { label: "PER", value: "per" },
    { label: "ROE", value: "roe" },
    { label: "PBR", value: "pbr" },
    { label: "종목명", value: "name" },
  ];

  if (state.meta.extraType === "marketCap" || state.meta.extraType === "marketCapUsd") {
    options.splice(3, 0, { label: "시가총액", value: "marketCap" });
  }

  return options;
}

function updateSortOptions() {
  const options = currentSortOptions();
  if (!options.some((option) => option.value === state.sort)) {
    state.sort = "rank";
  }

  els.sortSelect.innerHTML = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === state.sort ? " selected" : ""}>${escapeHtml(
          option.label,
        )}</option>`,
    )
    .join("");
}

function getFilteredItems() {
  const query = state.query.trim().toLowerCase();
  let items = state.items.filter((item) => {
    const matchesQuery =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.code.toLowerCase().includes(query) ||
      String(item.sector || "").toLowerCase().includes(query);
    const direction = rateClass(item);
    const matchesDirection = state.direction === "all" || state.direction === direction;
    return matchesQuery && matchesDirection;
  });

  items = [...items].sort((a, b) => {
    if (state.sort === "name") {
      return a.name.localeCompare(b.name, "ko");
    }

    if (state.sort === "rank") {
      return a.rank - b.rank;
    }

    const aValue = a[state.sort];
    const bValue = b[state.sort];
    if (!Number.isFinite(aValue) && !Number.isFinite(bValue)) {
      return a.rank - b.rank;
    }
    if (!Number.isFinite(aValue)) {
      return 1;
    }
    if (!Number.isFinite(bValue)) {
      return -1;
    }
    return bValue - aValue || a.rank - b.rank;
  });

  return items;
}

function updateMetrics(visibleItems) {
  const up = state.items.filter((item) => rateClass(item) === "up").length;
  const down = state.items.filter((item) => rateClass(item) === "down").length;
  const rates = state.items
    .map((item) => item.changeRate)
    .filter((value) => Number.isFinite(value));
  const averageRate = rates.length
    ? rates.reduce((sum, value) => sum + value, 0) / rates.length
    : 0;

  els.upCount.textContent = numberFormatter.format(up);
  els.downCount.textContent = numberFormatter.format(down);
  els.avgRate.textContent = formatRate(averageRate);
  els.avgRate.className = averageRate > 0 ? "up" : averageRate < 0 ? "down" : "flat";
  els.visibleCount.textContent = `${numberFormatter.format(visibleItems.length)}개`;

  if (state.meta.extraType === "marketCap") {
    const marketCapTotal = state.items.reduce(
      (sum, item) => sum + (Number.isFinite(item.marketCap) ? item.marketCap : 0),
      0,
    );
    els.totalMarketCap.textContent = marketCapToJo(marketCapTotal);
  } else if (state.meta.extraType === "marketCapUsd") {
    const marketCapTotal = state.items.reduce(
      (sum, item) => sum + (Number.isFinite(item.marketCap) ? item.marketCap : 0),
      0,
    );
    els.totalMarketCap.textContent = formatUsdMarketCap(marketCapTotal);
  } else {
    els.totalMarketCap.textContent = averageVolumeText(state.items);
  }
}

function extraCell(stock) {
  if (state.meta.extraType === "marketCap") {
    return `<td class="numeric">${marketCapToJo(stock.marketCap)}</td>`;
  }

  if (state.meta.extraType === "marketCapUsd") {
    return `<td class="numeric">${escapeHtml(stock.marketCapText || formatUsdMarketCap(stock.marketCap))}</td>`;
  }

  return `<td><span class="sector">${escapeHtml(stock.sector || "-")}</span></td>`;
}

function renderRows(items) {
  els.rows.innerHTML = items
    .map((stock) => {
      const movement = rateClass(stock);
      return `
        <tr>
          <td class="rank">${formatNumber(stock.rank)}</td>
          <td>
            <div class="stock-name">
              <a href="#" data-code="${escapeHtml(stock.code)}" data-name="${escapeHtml(stock.name)}" class="stock-link">
                ${escapeHtml(stock.name)}
              </a>
              <span class="code">${escapeHtml(stock.code)}</span>
            </div>
          </td>
          <td class="numeric">${formatPrice(stock)}</td>
          <td class="numeric">
            <span class="rate-pill ${movement}">${formatRate(stock.changeRate, stock.changeRateText)}</span>
          </td>
          <td class="numeric ${movement}">${escapeHtml(formatChange(stock))}</td>
          ${extraCell(stock)}
          <td class="numeric muted-value">${eokToJo(stock.sales)}</td>
          <td class="numeric muted-value">${eokToJo(stock.operatingProfit)}</td>
          <td class="numeric">${formatPlainNumber(stock.per)}</td>
          <td class="numeric">${Number.isFinite(stock.roe) ? `${formatPlainNumber(stock.roe)}%` : "-"}</td>
          <td class="numeric muted-value">${formatUnavailableMetric(stock.pbr)}</td>
          <td class="numeric">${formatNumber(stock.volume)}</td>
        </tr>`;
    })
    .join("");
}

function destroyCharts() {
  if (!chartRuntime) return;
  chartRuntime.priceChart.remove();
  chartRuntime.volumeChart.remove();
  chartRuntime.macdChart.remove();
  if (chartRuntime.ichimokuChart) {
    chartRuntime.ichimokuChart.remove();
  }
  chartRuntime = null;
}

function openChartModal() {
  els.chartModal.classList.add("is-open");
  els.chartModal.setAttribute("aria-hidden", "false");
}

function closeChartModal() {
  els.chartModal.classList.remove("is-open");
  els.chartModal.setAttribute("aria-hidden", "true");
}

function syncCrosshair(sourceChart, targetDefs) {
  sourceChart.subscribeCrosshairMove((param) => {
    if (!param || !param.time) {
      for (const target of targetDefs) {
        if (typeof target.chart.clearCrosshairPosition === "function") {
          target.chart.clearCrosshairPosition();
        }
      }
      return;
    }
    // param.time can be a string "YYYY-MM-DD" or a number; normalise to string key
    const timeKey = typeof param.time === "object"
      ? `${param.time.year}-${String(param.time.month).padStart(2,"0")}-${String(param.time.day).padStart(2,"0")}`
      : String(param.time);
    for (const target of targetDefs) {
      const value = target.valueByTime.get(timeKey);
      if (!Number.isFinite(value)) continue;
      if (typeof target.chart.setCrosshairPosition === "function") {
        target.chart.setCrosshairPosition(value, param.time, target.series);
      }
    }
  });
}

function syncTimeScales(charts) {
  let syncing = false;
  charts.forEach((source) => {
    source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncing) return;
      syncing = true;
      charts.forEach((target) => {
        if (target !== source) {
          target.timeScale().setVisibleLogicalRange(range);
        }
      });
      syncing = false;
    });
  });
}

function addSeries(chart, color, values) {
  const series = chart.addLineSeries({
    color,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  series.setData(values.filter((x) => Number.isFinite(x.value)));
  return series;
}

function buildCloudBands(ichiSource, ichi) {
  const upBand = [];
  const downBand = [];
  for (let i = 0; i < ichiSource.length; i += 1) {
    const a = ichi[i]?.senkouA ?? null;
    const b = ichi[i]?.senkouB ?? null;
    const t = ichiSource[i].time;
    if (a === null || b === null) {
      upBand.push({ time: t, value: null, color: "rgba(0,0,0,0)" });
      downBand.push({ time: t, value: null, color: "rgba(0,0,0,0)" });
      continue;
    }
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    if (a > b) {
      upBand.push({ time: t, value: high, color: "rgba(239,68,68,0.28)" });
      downBand.push({ time: t, value: low, color: "rgba(239,68,68,0.28)" });
    } else {
      upBand.push({ time: t, value: high, color: "rgba(37,99,235,0.26)" });
      downBand.push({ time: t, value: low, color: "rgba(37,99,235,0.26)" });
    }
  }
  return { upBand, downBand };
}

/* ─── MACD 부호에 따라 캔들 차트 배경을 빨간/파란 반투명으로 채운다 ─── */
function drawMacdBackground(container, chart, items) {
  const existing = container.querySelector(".macd-bg-overlay");
  if (existing) existing.remove();

  const canvas = document.createElement("canvas");
  canvas.className = "macd-bg-overlay";
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "0",
  });
  container.insertBefore(canvas, container.firstChild);

  const dpr = window.devicePixelRatio || 1;

  const paint = () => {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!Number.isFinite(item.macd)) continue;
      const x1 = chart.timeScale().timeToCoordinate(item.time);
      if (x1 === null) continue;
      let x2;
      if (i + 1 < items.length) {
        x2 = chart.timeScale().timeToCoordinate(items[i + 1].time);
        if (x2 === null) x2 = x1 + 8;
      } else {
        x2 = x1 + 8;
      }
      const color = item.macd >= 0 ? "rgba(239,68,68,0.07)" : "rgba(37,99,235,0.07)";
      ctx.fillStyle = color;
      ctx.fillRect(x1, 0, x2 - x1 + 0.5, rect.height);
    }
  };

  requestAnimationFrame(() => {
    paint();
    chart.timeScale().subscribeVisibleTimeRangeChange(paint);
  });
}

function drawIchimokuCloud(container, chart, senkouASeries, senkouBSeries, ichiSource, ichi, visible = true) {
  const existing = container.querySelector(".ichi-cloud-overlay");
  if (existing) existing.remove();
  if (!visible) return { setVisible: () => {} };
  const canvas = document.createElement("canvas");
  canvas.className = "ichi-cloud-overlay";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  container.appendChild(canvas);
  const dpr = window.devicePixelRatio || 1;
  const paint = () => {
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const drawColor = (cond, color) => {
      ctx.beginPath();
      let started = false;
      const tops = [];
      const bottoms = [];
      for (let i = 0; i < ichiSource.length; i += 1) {
        const a = ichi[i]?.senkouA;
        const b = ichi[i]?.senkouB;
        if (!Number.isFinite(a) || !Number.isFinite(b) || !cond(a, b)) continue;
        const x = chart.timeScale().timeToCoordinate(ichiSource[i].time);
        const yA = senkouASeries.priceToCoordinate(a);
        const yB = senkouBSeries.priceToCoordinate(b);
        if (x === null || yA === null || yB === null) continue;
        tops.push([x, Math.min(yA, yB)]);
        bottoms.push([x, Math.max(yA, yB)]);
      }
      if (tops.length < 2) return;
      ctx.moveTo(tops[0][0], tops[0][1]);
      for (const p of tops) ctx.lineTo(p[0], p[1]);
      for (let i = bottoms.length - 1; i >= 0; i -= 1) ctx.lineTo(bottoms[i][0], bottoms[i][1]);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    drawColor((a, b) => a > b, "rgba(239,68,68,0.22)");
    drawColor((a, b) => a < b, "rgba(37,99,235,0.20)");
  };
  paint();
  requestAnimationFrame(paint); // 차트가 실제로 렌더된 뒤 한 번 더 보정
  chart.timeScale().subscribeVisibleTimeRangeChange(paint);
  return {
    setVisible: (v) => {
      canvas.style.display = v ? "block" : "none";
      if (v) paint();
    },
  };
}

function computeIchimoku(items) {
  const mid = (index, period) => {
    if (index < period - 1) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = index - period + 1; i <= index; i += 1) {
      hi = Math.max(hi, items[i].high);
      lo = Math.min(lo, items[i].low);
    }
    return (hi + lo) / 2;
  };

  const out = items.map((_, i) => {
    const tenkan = mid(i, 9);
    const kijun = mid(i, 26);
    return { tenkan, kijun, chikou: null, senkouA: null, senkouB: null };
  });
  // 후행선(지연스팬): 현재 종가를 26기간 뒤(과거 시점)로 이동
  for (let i = 0; i < items.length; i += 1) {
    const target = i - 26;
    if (target < 0) continue;
    out[target].chikou = items[i].close;
  }
  // 선행1/선행2: 26기간 앞(미래 시점)으로 이동
  for (let i = 0; i < items.length; i += 1) {
    const target = i + 26;
    const tenkan = out[i].tenkan;
    const kijun = out[i].kijun;
    if (target < items.length) {
      out[target].senkouA = tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;
      out[target].senkouB = mid(i, 52);
    }
  }
  return out;
}

function addFuturePeriods(lastTime, periods, timeframe) {
  const [y, m, d] = String(lastTime).split("-").map(Number);
  const out = [];
  let dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  for (let i = 0; i < periods; i += 1) {
    if (timeframe === "month") {
      dt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1));
    } else if (timeframe === "week") {
      dt = new Date(dt.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      // day: trading-day style approximation (skip weekends)
      do {
        dt = new Date(dt.getTime() + 24 * 60 * 60 * 1000);
      } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
    }
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

function renderCharts(payload, ichimokuPayload) {
  destroyCharts();
  const common = {
    layout: { background: { color: "#fff" }, textColor: "#334155", attributionLogo: false },
    grid: { vertLines: { color: "#edf2f7" }, horzLines: { color: "#edf2f7" } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    handleScale: false,
    handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, mouseWheel: false },
    rightPriceScale: { borderColor: "#d0d7de", minimumWidth: 120 },
    timeScale: {
      borderColor: "#d0d7de",
      timeVisible: true,
      tickMarkFormatter: (time) => {
        if (typeof time === "number") {
          const d = new Date(time * 1000);
          return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        }
        if (time && typeof time === "object" && "year" in time && "month" in time) {
          return `${time.year}.${String(time.month).padStart(2, "0")}`;
        }
        if (typeof time === "string" && time.length >= 7) {
          return `${time.slice(0, 4)}.${time.slice(5, 7)}`;
        }
        return "";
      },
    },
  };
  const priceChart = LightweightCharts.createChart(els.priceChart, { ...common, height: 420 });
  const volumeChart = LightweightCharts.createChart(els.volumeChart, { ...common, height: 180 });
  const macdChart = LightweightCharts.createChart(els.macdChart, { ...common, height: 220 });
  chartRuntime = { priceChart, volumeChart, macdChart };
  const ichimokuChart = LightweightCharts.createChart(els.ichimokuChart, { ...common, height: 240 });
  chartRuntime = { priceChart, volumeChart, macdChart, ichimokuChart };

  const candles = priceChart.addCandlestickSeries({
    upColor: "#ef4444",
    downColor: "#2563eb",
    borderUpColor: "#ef4444",
    borderDownColor: "#2563eb",
    wickUpColor: "#ef4444",
    wickDownColor: "#2563eb",
    lastValueVisible: false,
    priceLineVisible: false,
  });
  candles.setData(
    payload.items.map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })),
  );

  const ma5Series = addSeries(priceChart, "#f59e0b", payload.items.map((x) => ({ time: x.time, value: x.ma5 })));
  const ma10Series = addSeries(priceChart, "#f97316", payload.items.map((x) => ({ time: x.time, value: x.ma10 })));
  const ma20Series = addSeries(priceChart, "#ec4899", payload.items.map((x) => ({ time: x.time, value: x.ma20 })));
  const ma60Series = addSeries(priceChart, "#10b981", payload.items.map((x) => ({ time: x.time, value: x.ma60 })));
  const ma120Series = addSeries(priceChart, "#8b5cf6", payload.items.map((x) => ({ time: x.time, value: x.ma120 })));
  const ma240Series = addSeries(priceChart, "#64748b", payload.items.map((x) => ({ time: x.time, value: x.ma240 })));

  const priceMarkers = [];
  const crossRules = [
    { a: "ma5", b: "ma20", label: "5/20" },
    { a: "ma5", b: "ma60", label: "5/60" },
    { a: "ma20", b: "ma60", label: "20/60" },
  ];
  for (let i = 1; i < payload.items.length; i += 1) {
    const p = payload.items[i - 1];
    const c = payload.items[i];
    for (const rule of crossRules) {
      const pa = p[rule.a], pb = p[rule.b], ca = c[rule.a], cb = c[rule.b];
      if (pa === null || pb === null || ca === null || cb === null) continue;
      if (pa <= pb && ca > cb) {
        priceMarkers.push({ time: c.time, position: "belowBar", color: "#2563eb", shape: "circle", text: rule.label });
      } else if (pa >= pb && ca < cb) {
        priceMarkers.push({ time: c.time, position: "aboveBar", color: "#ef4444", shape: "circle", text: rule.label });
      }
    }
  }
  candles.setMarkers(priceMarkers);
  drawMacdBackground(els.priceChart, priceChart, payload.items);

  const vol = volumeChart.addHistogramSeries({
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  vol.setData(
    payload.items.map((x) => ({
      time: x.time,
      value: x.volume || 0,
      color: x.close >= x.open ? "#ef4444" : "#2563eb",
    })),
  );

  const hist = macdChart.addHistogramSeries({
    lastValueVisible: false,
    priceLineVisible: false,
  });
  hist.setData(
    payload.items.map((x) => ({
      time: x.time,
      value: x.histogram ?? 0,
      color: (x.histogram ?? 0) >= 0 ? "#ef4444" : "#2563eb",
    })),
  );
  const macdLine = addSeries(macdChart, "#0284c7", payload.items.map((x) => ({ time: x.time, value: x.macd })));
  addSeries(macdChart, "#f59e0b", payload.items.map((x) => ({ time: x.time, value: x.signal })));

  const macdMarkers = [];
  for (let i = 1; i < payload.items.length; i += 1) {
    const p = payload.items[i - 1];
    const c = payload.items[i];
    if (p.macd === null || p.signal === null || c.macd === null || c.signal === null) continue;
    if (p.macd <= p.signal && c.macd > c.signal) {
      macdMarkers.push({ time: c.time, position: "belowBar", color: "#ef4444", shape: "arrowUp", text: "골든" });
    } else if (p.macd >= p.signal && c.macd < c.signal) {
      macdMarkers.push({ time: c.time, position: "aboveBar", color: "#2563eb", shape: "arrowDown", text: "데드" });
    }
  }
  macdLine.setMarkers(macdMarkers);

  const ichiAll = ichimokuPayload?.items || payload.items;
  const keep = Math.max(30, state.ichimokuDays || 120);
  const start = Math.max(0, ichiAll.length - keep);
  const ichiSource = ichiAll.slice(start);
  const ichiCandles = ichimokuChart.addCandlestickSeries({
    upColor: "#ef4444",
    downColor: "#2563eb",
    borderUpColor: "#ef4444",
    borderDownColor: "#2563eb",
    wickUpColor: "#ef4444",
    wickDownColor: "#2563eb",
    lastValueVisible: false,
    priceLineVisible: false,
  });
  ichiCandles.setData(
    ichiSource.map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })),
  );
  const ichiFull = computeIchimoku(ichiAll);
  const ichi = ichiFull.slice(start);
  const futureTimes = ichiSource.length
    ? addFuturePeriods(ichiSource[ichiSource.length - 1].time, 26, state.ichimokuTimeframe)
    : [];

  // Build forward-projected senkou series up to +26 periods.
  const senkouAData = ichiSource.map((x, i) => ({ time: x.time, value: ichi[i]?.senkouA ?? null }));
  const senkouBData = ichiSource.map((x, i) => ({ time: x.time, value: ichi[i]?.senkouB ?? null }));
  for (let i = 0; i < futureTimes.length; i += 1) {
    const base = ichiSource.length - 26 + i;
    if (base < 0 || base >= ichiSource.length) {
      senkouAData.push({ time: futureTimes[i], value: null });
      senkouBData.push({ time: futureTimes[i], value: null });
      continue;
    }
    const t = ichi[base]?.tenkan ?? null;
    const k = ichi[base]?.kijun ?? null;
    senkouAData.push({ time: futureTimes[i], value: t !== null && k !== null ? (t + k) / 2 : null });

    if (base < 52 - 1) {
      senkouBData.push({ time: futureTimes[i], value: null });
    } else {
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = base - 52 + 1; j <= base; j += 1) {
        hi = Math.max(hi, ichiSource[j].high);
        lo = Math.min(lo, ichiSource[j].low);
      }
      senkouBData.push({ time: futureTimes[i], value: (hi + lo) / 2 });
    }
  }
  const tenkanSeries = addSeries(ichimokuChart, "#9ca3af", ichiSource.map((x, i) => ({ time: x.time, value: ichi[i]?.tenkan ?? null })));
  const kijunSeries = addSeries(ichimokuChart, "#22c1dd", ichiSource.map((x, i) => ({ time: x.time, value: ichi[i]?.kijun ?? null })));
  const chikouSeries = addSeries(ichimokuChart, "#111827", ichiSource.map((x, i) => ({ time: x.time, value: ichi[i]?.chikou ?? null })));
  const senkouASeries = addSeries(ichimokuChart, "#fb7185", senkouAData);
  const senkouBSeries = addSeries(ichimokuChart, "#3b82f6", senkouBData);
  senkouASeries.applyOptions({ lineWidth: 4 });
  senkouBSeries.applyOptions({ lineWidth: 4 });
  const cloudOverlay = drawIchimokuCloud(
    els.ichimokuChart,
    ichimokuChart,
    senkouASeries,
    senkouBSeries,
    ichiSource,
    ichi,
    true,
  );

  const closeByTime = new Map(payload.items.map((x) => [x.time, x.close]));
  const volumeByTime = new Map(payload.items.map((x) => [x.time, x.volume || 0]));
  const macdByTime = new Map(
    payload.items
      .filter((x) => Number.isFinite(x.macd))
      .map((x) => [x.time, x.macd]),
  );

  syncCrosshair(priceChart, [
    { chart: volumeChart, series: vol, valueByTime: volumeByTime },
    { chart: macdChart, series: macdLine, valueByTime: macdByTime },
  ]);
  syncCrosshair(volumeChart, [
    { chart: priceChart, series: candles, valueByTime: closeByTime },
    { chart: macdChart, series: macdLine, valueByTime: macdByTime },
  ]);
  syncCrosshair(macdChart, [
    { chart: priceChart, series: candles, valueByTime: closeByTime },
    { chart: volumeChart, series: vol, valueByTime: volumeByTime },
  ]);
  syncTimeScales([priceChart, volumeChart, macdChart]);
  const baseRange = priceChart.timeScale().getVisibleLogicalRange();
  if (baseRange) {
    volumeChart.timeScale().setVisibleLogicalRange(baseRange);
    macdChart.timeScale().setVisibleLogicalRange(baseRange);
  }

  // Always render the price legend first, even if lower panels fail.
  makeLegend(els.priceLegend, [
    { label: "캔들", color: "#475569", series: candles, visible: true },
    { label: "5일", color: "#f59e0b", series: ma5Series, visible: true },
    { label: "10일", color: "#f97316", series: ma10Series, visible: true },
    { label: "20일", color: "#ec4899", series: ma20Series, visible: true },
    { label: "60일", color: "#10b981", series: ma60Series, visible: true },
    { label: "120일", color: "#8b5cf6", series: ma120Series, visible: true },
    { label: "240일", color: "#64748b", series: ma240Series, visible: true },
  ]);
  try {
    makeLegend(els.ichimokuLegend, [
      { label: "기준선", color: "#22c1dd", series: kijunSeries, visible: true },
      { label: "전환선", color: "#9ca3af", series: tenkanSeries, visible: true },
      { label: "후행선", color: "#111827", series: chikouSeries, visible: true },
      { label: "선행1", color: "#fb7185", series: senkouASeries, visible: true },
      { label: "선행2", color: "#3b82f6", series: senkouBSeries, visible: true },
    ]);
  } catch {
    // Keep price legend available even if ichimoku legend fails.
  }
}

async function loadChartData() {
  if (!state.selectedCode) return;
  const params = new URLSearchParams({
    market: state.market,
    code: state.selectedCode,
    days: String(state.chartFetchDays),
    timeframe: state.chartTimeframe,
  });
  const ichiParams = new URLSearchParams({
    market: state.market,
    code: state.selectedCode,
    days: String(Math.min(1200, state.ichimokuDays + 260)),
    timeframe: state.ichimokuTimeframe,
  });
  const [response, ichiResponse] = await Promise.all([
    fetch(`/api/ohlcv?${params.toString()}`),
    fetch(`/api/ohlcv?${ichiParams.toString()}`),
  ]);
  const payload = await response.json();
  const ichiPayload = await ichiResponse.json();
  if (!response.ok || !ichiResponse.ok) {
    throw new Error(payload.detail || ichiPayload.detail || payload.error || ichiPayload.error || "차트 데이터 요청 실패");
  }
  els.chartTitle.textContent = `${state.selectedName} (${state.selectedCode})`;
  openChartModal();
  const sliced = { ...payload, items: payload.items.slice(-state.chartDays) };
  renderCharts(sliced, ichiPayload);
}

function updateChrome() {
  els.eyebrow.textContent = state.meta.eyebrow || marketLabels[state.market];
  els.pageTitle.textContent = state.meta.title || marketLabels[state.market];
  els.rankHeader.textContent = state.meta.rankLabel || "순서";
  els.extraHeader.textContent =
    state.meta.extraType === "marketCap" ? "시가총액(조)" : state.meta.extraLabel || "섹터";
  els.extraHeader.className =
    state.meta.extraType === "marketCap" || state.meta.extraType === "marketCapUsd"
      ? "numeric"
      : "";
  els.fourthMetricLabel.textContent = state.meta.metricLabel || "평균 거래량";

  els.marketButtons.forEach((button) => {
    const active = button.dataset.market === state.market;
    button.classList.toggle("is-active", active);
    button.disabled = state.loading;
  });
}

function render() {
  updateSortOptions();
  updateChrome();

  const items = getFilteredItems();
  const hasItems = items.length > 0;
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: state.meta.timezone || "Asia/Seoul",
  });

  els.sourceLabel.innerHTML = state.sourceUrl
    ? `<a href="${escapeHtml(state.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(state.sourceName)}</a>`
    : "-";
  els.updatedAt.textContent = state.retrievedAt
    ? dateFormatter.format(new Date(state.retrievedAt))
    : "-";
  els.message.textContent = state.loading
    ? "데이터를 불러오는 중입니다."
    : state.error
      ? state.error
      : hasItems
        ? ""
        : "조건에 맞는 종목이 없습니다.";
  els.message.classList.toggle("is-visible", state.loading || Boolean(state.error) || !hasItems);

  updateMetrics(items);
  renderRows(items);

  els.rows.querySelectorAll(".stock-link").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await openChartByCode(link.dataset.code || "", link.dataset.name || "");
      } catch (error) {
        state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
        render();
      }
    });
  });
}

async function loadStocks(forceRefresh = false) {
  const serial = ++requestSerial;
  state.loading = true;
  state.error = "";
  els.refreshButton.disabled = true;
  render();

  try {
    const params = new URLSearchParams({ market: state.market });
    if (forceRefresh) {
      params.set("refresh", "1");
    }

    const response = await fetch(`/api/market?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.error || "데이터 요청 실패");
    }

    if (serial !== requestSerial) {
      return;
    }

    state.items = payload.items;
    state.meta = {
      currency: payload.currency,
      extraLabel: payload.extraLabel,
      extraType: payload.extraType,
      eyebrow: payload.eyebrow,
      metricLabel: payload.metricLabel,
      rankLabel: payload.rankLabel,
      title: payload.title,
      timezone: payload.timezone,
    };
    state.sourceName = payload.sourceName;
    state.sourceUrl = payload.sourceUrl;
    state.retrievedAt = payload.retrievedAt;
  } catch (error) {
    if (serial === requestSerial) {
      state.error = `데이터를 가져오지 못했습니다. ${error.message}`;
      state.items = [];
    }
  } finally {
    if (serial === requestSerial) {
      state.loading = false;
      els.refreshButton.disabled = false;
      render();
    }
  }
}

els.searchInput.addEventListener("input", (event) => {
  const value = event.target.value;
  state.query = value;
  render();
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadSearchSuggestions(value);
  }, 180);
});

els.searchInput.addEventListener("change", async () => {
  const value = els.searchInput.value.trim();
  const codeMatch = value.match(/\(([^)]+)\)\s*$/);
  if (!codeMatch) return;
  const code = codeMatch[1].trim().toUpperCase();
  const picked = state.searchSuggestions.find((x) => x.code.toUpperCase() === code);
  if (!picked) return;
  els.searchSuggestionMenu.style.display = "none";
  try {
    await openChartByCode(picked.code, picked.name);
  } catch (error) {
    state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
    render();
  }
});

els.searchInput.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  const value = els.searchInput.value.trim();
  const codeMatch = value.match(/\(([^)]+)\)\s*$/);
  if (!codeMatch) return;
  event.preventDefault();
  const code = codeMatch[1].trim().toUpperCase();
  const picked = state.searchSuggestions.find((x) => x.code.toUpperCase() === code);
  if (!picked) return;
  try {
    await openChartByCode(picked.code, picked.name);
  } catch (error) {
    state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
    render();
  }
});

document.addEventListener("click", (event) => {
  if (!els.searchSuggestionMenu) return;
  if (els.searchSuggestionMenu.contains(event.target) || els.searchInput.contains(event.target)) return;
  els.searchSuggestionMenu.style.display = "none";
});

els.directionFilter.addEventListener("change", (event) => {
  state.direction = event.target.value;
  render();
});

els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

els.refreshButton.addEventListener("click", () => {
  loadStocks(true);
});

els.applyDaysButton.addEventListener("click", async () => {
  const days = Number(els.daysInput.value || 200);
  state.chartDays = Math.max(30, Math.min(1200, days));
  state.chartFetchDays = Math.max(state.chartDays + 100, 700); // 충분한 히스토리 확보
  els.daysInput.value = String(state.chartDays);
  try {
    await loadChartData();
  } catch (error) {
    state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
    render();
  }
});

els.periodButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    state.chartTimeframe = button.dataset.timeframe || "day";
    els.periodButtons.forEach((b) => b.classList.toggle("is-active", b === button));
    try {
      await loadChartData();
    } catch (error) {
      state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
      render();
    }
  });
});

els.ichimokuPeriodButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    state.ichimokuTimeframe = button.dataset.ichiTimeframe || "day";
    els.ichimokuPeriodButtons.forEach((b) => b.classList.toggle("is-active", b === button));
    try {
      await loadChartData();
    } catch (error) {
      state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
      render();
    }
  });
});

els.applyIchimokuDaysButton.addEventListener("click", async () => {
  const days = Number(els.ichimokuDaysInput.value || 200);
  state.ichimokuDays = Math.max(30, Math.min(1200, days));
  els.ichimokuDaysInput.value = String(state.ichimokuDays);
  try {
    await loadChartData();
  } catch (error) {
    state.error = `차트 데이터를 가져오지 못했습니다. ${error.message}`;
    render();
  }
});

els.chartBackdrop.addEventListener("click", closeChartModal);
els.closeChartButton.addEventListener("click", closeChartModal);

els.marketButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.market === state.market || state.loading) {
      return;
    }

    state.market = button.dataset.market;
    state.items = [];
    state.query = "";
    state.direction = "all";
    state.sort = "rank";
    els.searchInput.value = "";
    renderSearchSuggestions([]);
    els.directionFilter.value = "all";
    loadStocks();
  });
});

loadStocks();
