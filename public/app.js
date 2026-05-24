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
  loading: false,
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
  sortSelect: document.querySelector("#sortSelect"),
  sourceLabel: document.querySelector("#sourceLabel"),
  totalMarketCap: document.querySelector("#totalMarketCap"),
  updatedAt: document.querySelector("#updatedAt"),
  upCount: document.querySelector("#upCount"),
  visibleCount: document.querySelector("#visibleCount"),
};

const numberFormatter = new Intl.NumberFormat("ko-KR");
const rateFormatter = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
let requestSerial = 0;

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
  if (stock.changeText) {
    if (stock.currency === "USD") {
      const sign = stock.changeText.startsWith("-")
        ? "-"
        : stock.changeText.startsWith("+")
          ? "+"
          : "";
      const absolute = stock.changeText.replace(/^[+-]/, "");
      return `${sign}$${absolute}`;
    }

    return stock.changeText;
  }

  if (!Number.isFinite(stock.change)) {
    return "-";
  }

  const sign = stock.change > 0 ? "+" : "";
  if (stock.currency === "USD") {
    return `${sign}$${Math.abs(stock.change).toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }

  return `${sign}${formatNumber(stock.change)}`;
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
    { label: "영업이익 증가율", value: "operatingProfitGrowth" },
    { label: "PEG", value: "peg" },
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
    return `<td class="numeric">${formatNumber(stock.marketCap)}</td>`;
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
              <a href="${escapeHtml(stock.detailUrl)}" target="_blank" rel="noreferrer">
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
          <td class="numeric">${formatPlainNumber(stock.per)}</td>
          <td class="numeric">${Number.isFinite(stock.roe) ? `${formatPlainNumber(stock.roe)}%` : "-"}</td>
          <td class="numeric">${Number.isFinite(stock.operatingProfitGrowth) ? `${formatPlainNumber(stock.operatingProfitGrowth)}%` : "-"}</td>
          <td class="numeric">${formatPlainNumber(stock.peg)}</td>
          <td class="numeric">${formatNumber(stock.volume)}</td>
        </tr>`;
    })
    .join("");
}

function updateChrome() {
  els.eyebrow.textContent = state.meta.eyebrow || marketLabels[state.market];
  els.pageTitle.textContent = state.meta.title || marketLabels[state.market];
  els.rankHeader.textContent = state.meta.rankLabel || "순서";
  els.extraHeader.textContent = state.meta.extraLabel || "섹터";
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
  state.query = event.target.value;
  render();
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
    els.directionFilter.value = "all";
    loadStocks();
  });
});

loadStocks();
