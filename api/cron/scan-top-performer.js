// /api/cron/scan-top-performer.js
//
// Runs frequently (see vercel.json note below) and processes a
// small BATCH of tickers each time, rather than the whole list in
// one request. Two real constraints made this necessary, not
// optional:
//   1. Twelve Data's rate limits (roughly 8 req/min on lower tiers)
//      mean scanning even 60 symbols — 2 calls each, quote + a
//      30-days-ago price — takes several minutes, and a full ~500-
//      symbol S&P 500 list would take hours.
//   2. Vercel serverless functions have execution time limits
//      (~10s on Hobby, ~60s on Pro without extra config) far
//      shorter than that.
// So progress is checkpointed in Supabase (nma_market_scan_state)
// between invocations. Each run:
//   - Picks up at next_index from the last run (or starts a new
//     scan if it's a new trading day since the last one).
//   - Processes BATCH_SIZE tickers, tracking the best 30-day return
//     seen so far.
//   - If it reaches the end of the list, writes the final winner
//     into nma_market_snapshot (what the frontend actually reads)
//     and resets scan_date/next_index for tomorrow.
//
// VERCEL CRON SETUP (add to vercel.json — don't overwrite your
// existing crons array, merge this entry into it):
//   {
//     "crons": [
//       { "path": "/api/cron/scan-top-performer", "schedule": "*/15 13-21 * * 1-5" }
//     ]
//   }
// That's every 15 minutes, 1pm-9pm UTC (roughly market hours +
// buffer), weekdays only. Tune BATCH_SIZE and the schedule together
// against your actual Twelve Data plan's rate limit — if you're on
// a higher tier with a bigger per-minute budget, BATCH_SIZE can go
// up and this can run less often; on a tighter budget, the reverse.
//
// Also protect this route: Vercel Cron requests include a bearer
// token from CRON_SECRET automatically if you set that env var and
// check for it below (recommended so this can't be triggered by
// anyone who finds the URL, which would burn API budget).

import { createClient } from "@supabase/supabase-js";
import SP500 from "../_sp500-constituents.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = 8; // tickers processed per invocation — tune against your Twelve Data plan's per-minute limit
const LOOKBACK_DAYS_OUTPUTSIZE = 24; // ~30 calendar days of trading-day price points; time_series returns most-recent-first

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchQuote(symbol, apiKey) {
  const url =
    "https://api.twelvedata.com/quote?symbol=" +
    encodeURIComponent(symbol) +
    "&apikey=" +
    apiKey;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || data.status === "error" || data.code) return null;
  return data;
}

async function fetch30DayReturn(symbol, apiKey) {
  const url =
    "https://api.twelvedata.com/time_series?symbol=" +
    encodeURIComponent(symbol) +
    "&interval=1day&outputsize=" +
    LOOKBACK_DAYS_OUTPUTSIZE +
    "&apikey=" +
    apiKey;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || data.status === "error" || data.code || !Array.isArray(data.values) || !data.values.length) {
    return null;
  }
  // time_series returns most-recent-first.
  const latest = Number(data.values[0].close);
  const oldest = Number(data.values[data.values.length - 1].close);
  if (!Number.isFinite(latest) || !Number.isFinite(oldest) || oldest <= 0) return null;
  return { latest, oldest };
}

export default async function handler(req, res) {
  // Guards against this route being triggered by anyone who finds
  // the URL — Vercel Cron sends this header automatically when
  // CRON_SECRET is set as an env var.
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== "Bearer " + process.env.CRON_SECRET) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing TWELVEDATA_API_KEY." });
    return;
  }

  try {
    const { data: stateRow, error: stateErr } = await supabase
      .from("nma_market_scan_state")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (stateErr) {
      res.status(500).json({ error: "Could not read scan state." });
      return;
    }

    const today = todayISODate();
    let state = stateRow;

    // New trading day (or first run ever) — start a fresh scan.
    if (!state || state.scan_date !== today) {
      state = {
        id: 1,
        scan_date: today,
        next_index: 0,
        best_symbol: null,
        best_name: null,
        best_sector: null,
        best_price: null,
        best_return_30d: null,
        best_start_price: null
      };
    }

    if (state.next_index >= SP500.length) {
      res.status(200).json({ message: "Scan already complete for " + today + "." });
      return;
    }

    const batch = SP500.slice(state.next_index, state.next_index + BATCH_SIZE);
    let bestReturn = state.best_return_30d;
    let bestSymbol = state.best_symbol;
    let bestName = state.best_name;
    let bestSector = state.best_sector;
    let bestPrice = state.best_price;
    let bestStartPrice = state.best_start_price;

    for (const entry of batch) {
      const symbol = entry.symbol;

      const [quote, series] = await Promise.all([
        fetchQuote(symbol, apiKey),
        fetch30DayReturn(symbol, apiKey)
      ]);

      if (!quote || !series) continue; // skip symbols that failed to fetch rather than failing the whole batch

      const returnPct = ((series.latest - series.oldest) / series.oldest) * 100;

      if (bestReturn === null || bestReturn === undefined || returnPct > bestReturn) {
        bestReturn = returnPct;
        bestSymbol = symbol;
        bestName = quote.name || symbol;
        bestSector = entry.sector || "";
        bestPrice = Number(quote.close) || series.latest;
        bestStartPrice = series.oldest;
      }
    }

    const nextIndex = state.next_index + batch.length;
    const scanComplete = nextIndex >= SP500.length;

    await supabase.from("nma_market_scan_state").upsert({
      id: 1,
      scan_date: today,
      next_index: scanComplete ? SP500.length : nextIndex,
      best_symbol: bestSymbol,
      best_name: bestName,
      best_sector: bestSector,
      best_price: bestPrice,
      best_return_30d: bestReturn,
      best_start_price: bestStartPrice
    });

    if (scanComplete && bestSymbol) {
      await supabase.from("nma_market_snapshot").upsert({
        id: 1,
        symbol: bestSymbol,
        name: bestName,
        sector: bestSector,
        price: bestPrice,
        return_30d: bestReturn,
        start_price: bestStartPrice,
        updated_at: new Date().toISOString()
      });
    }

    res.status(200).json({
      scanned: batch.length,
      progress: (scanComplete ? SP500.length : nextIndex) + "/" + SP500.length,
      complete: scanComplete,
      currentBest: bestSymbol
    });
  } catch (err) {
    console.error("scan-top-performer error:", err);
    res.status(500).json({ error: "Scan failed." });
  }
}
