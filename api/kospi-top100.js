const { getMarketPayload } = require("../market-data");

module.exports = async function handler(req, res) {
  try {
    const payload = await getMarketPayload("kospi", req.query?.refresh === "1");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error: "KOSPI 데이터를 가져오지 못했습니다.",
        detail: error.message,
      }),
    );
  }
};
