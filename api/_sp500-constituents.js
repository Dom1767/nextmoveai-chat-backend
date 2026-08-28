// /api/_sp500-constituents.js
//
// STARTER LIST — NOT A COMPLETE OR VERIFIED S&P 500 ROSTER.
//
// This is ~60 large-cap names I'm confident are current S&P 500
// members, not the full ~500-company index. Index membership
// changes periodically (additions, removals, mergers), and I can't
// guarantee this list's accuracy or completeness from memory —
// shipping a wrong or stale full list would be worse than shipping
// an honestly partial one, since a wrong list could silently miss
// the real 30-day winner or include a company that's no longer in
// the index.
//
// TO GET TO A REAL "S&P 500" CLAIM:
// Replace this array with a verified, current constituent list.
// Options, roughly in order of reliability:
//   1. A market-data provider that offers an S&P 500 constituents
//      endpoint directly (worth checking whether Twelve Data has
//      one — that would also mean this file self-updates instead
//      of needing manual maintenance).
//   2. A maintained public dataset (e.g. a Wikipedia table scrape,
//      though that needs its own verification step).
//   3. Manually sourcing the official list from S&P Dow Jones
//      Indices or a data vendor and updating this file when
//      reconstitution happens (a few times a year).
//
// Format: { symbol, sector } — sector is shown in the Market
// Spotlight card, so keep it reasonably accurate too.

export default [
  { symbol: "AAPL", sector: "Technology" },
  { symbol: "MSFT", sector: "Technology" },
  { symbol: "NVDA", sector: "Technology" },
  { symbol: "GOOGL", sector: "Communication Services" },
  { symbol: "GOOG", sector: "Communication Services" },
  { symbol: "AMZN", sector: "Consumer Discretionary" },
  { symbol: "META", sector: "Communication Services" },
  { symbol: "BRK.B", sector: "Financials" },
  { symbol: "AVGO", sector: "Technology" },
  { symbol: "TSLA", sector: "Consumer Discretionary" },
  { symbol: "LLY", sector: "Health Care" },
  { symbol: "JPM", sector: "Financials" },
  { symbol: "V", sector: "Financials" },
  { symbol: "UNH", sector: "Health Care" },
  { symbol: "XOM", sector: "Energy" },
  { symbol: "MA", sector: "Financials" },
  { symbol: "COST", sector: "Consumer Staples" },
  { symbol: "HD", sector: "Consumer Discretionary" },
  { symbol: "PG", sector: "Consumer Staples" },
  { symbol: "NFLX", sector: "Communication Services" },
  { symbol: "JNJ", sector: "Health Care" },
  { symbol: "BAC", sector: "Financials" },
  { symbol: "ABBV", sector: "Health Care" },
  { symbol: "CRM", sector: "Technology" },
  { symbol: "ORCL", sector: "Technology" },
  { symbol: "KO", sector: "Consumer Staples" },
  { symbol: "MRK", sector: "Health Care" },
  { symbol: "CVX", sector: "Energy" },
  { symbol: "AMD", sector: "Technology" },
  { symbol: "PEP", sector: "Consumer Staples" },
  { symbol: "ADBE", sector: "Technology" },
  { symbol: "WMT", sector: "Consumer Staples" },
  { symbol: "TMO", sector: "Health Care" },
  { symbol: "LIN", sector: "Materials" },
  { symbol: "ACN", sector: "Technology" },
  { symbol: "MCD", sector: "Consumer Discretionary" },
  { symbol: "CSCO", sector: "Technology" },
  { symbol: "ABT", sector: "Health Care" },
  { symbol: "DHR", sector: "Health Care" },
  { symbol: "WFC", sector: "Financials" },
  { symbol: "IBM", sector: "Technology" },
  { symbol: "GE", sector: "Industrials" },
  { symbol: "TXN", sector: "Technology" },
  { symbol: "PM", sector: "Consumer Staples" },
  { symbol: "INTU", sector: "Technology" },
  { symbol: "CAT", sector: "Industrials" },
  { symbol: "VZ", sector: "Communication Services" },
  { symbol: "NOW", sector: "Technology" },
  { symbol: "AMGN", sector: "Health Care" },
  { symbol: "QCOM", sector: "Technology" },
  { symbol: "SPGI", sector: "Financials" },
  { symbol: "AXP", sector: "Financials" },
  { symbol: "BKNG", sector: "Consumer Discretionary" },
  { symbol: "HON", sector: "Industrials" },
  { symbol: "PFE", sector: "Health Care" },
  { symbol: "UNP", sector: "Industrials" },
  { symbol: "NEE", sector: "Utilities" },
  { symbol: "LOW", sector: "Consumer Discretionary" },
  { symbol: "COP", sector: "Energy" },
  { symbol: "DIS", sector: "Communication Services" },
  { symbol: "T", sector: "Communication Services" }
];
