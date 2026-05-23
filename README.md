# 시장 전환 보드 앱

KOSPI 시가총액 상위 100개, NASDAQ 100, Dow 구성종목의 현재가, 전일비, 등락률, 거래량을 보여주는 의존성 없는 Node 웹앱입니다.

## 실행

```bash
node server.js
```

브라우저에서 `http://127.0.0.1:5173`을 열면 됩니다.

## Vercel

GitHub 저장소 루트에 배포할 수 있도록 `api/market.js` 서버리스 함수와 `vercel.json`을 포함했습니다.

## 데이터

- KOSPI: Naver Finance 시가총액 페이지
- NASDAQ 100/Dow 구성종목: Wikipedia
- 미국 종목 시세: Stooq CSV
- 서버가 `/api/market?market=kospi|nasdaq100|dow` 요청 시 선택한 시장 데이터를 반환합니다.
- 같은 데이터는 45초 동안 캐시됩니다. UI의 `새로고침`은 캐시를 우회합니다.
