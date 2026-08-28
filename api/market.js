// /api/market.js
// Combined live-quote + price-history + top-performer endpoint for
// Investment GPS.
//
// Setup:
// 1. Create a free account at https://twelvedata.com and grab an API key.
// 2. In Vercel: Project Settings -> Environment Variables ->
//    add TWELVEDATA_API_KEY = <your key> (all environments), then redeploy.
// 3. Add this single file to the SAME Vercel project that already
//    serves Dalo's /api/chat endpoint, at the path: api/market.js
//
// Usage:
//   GET /api/market?type=quote&symbol=AAPL
//   GET /api/market?type=series&symbol=AAPL&interval=1day&outputsize=66
//   GET /api/market?type=top-performer
//
// UPDATED: added type=top-performer. This does NOT scan the market
// live on request — it reads a cached row that api/cron/scan-
// top-performer.js writes once it finishes its incremental daily
// scan (see that file's comments for why scanning happens
// incrementally rather than all at once). If the cron job hasn't
// completed a scan yet (first deploy, or mid-scan), this returns a
// 404 with a clear "not ready yet" message rather than a fake or
// stale-looking result — the frontend should treat that the same
// way it treats any other market-data fetch failure.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const type = (req.query.type || "quote").toString();

  if (type === "top-performer") {
    try {
      const { data, error } = await supabase
        .from("nma_market_snapshot")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (error || !data || !data.symbol) {
        res.status(404).json({
          error: "Market Spotlight hasn't finished its first daily scan yet.",
        });
        return;
      }

      res.status(200).json({
        symbol: data.symbol,
        name: data.name || data.symbol,
        price: Number(data.price),
        return30d: Number(data.return_30d),
        startPrice: Number(data.start_price),
        sector: data.sector || "",
        updatedAt: data.updated_at,
      });
    } catch (err) {
      res.status(500).json({ error: "Market Spotlight request failed." });
    }
    return;
  }

  const symbol = (req.query.symbol || "").toString().trim().toUpperCase();

  if (!symbol) {
    res.status(400).json({ error: "Enter a ticker symbol." });
    return;
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing a market-data API key." });
    return;
  }

  try {
    if (type === "series") {
      const interval = (req.query.interval || "1day").toString();
      const outputsize = Math.min(Number(req.query.outputsize) || 66, 500);

      const url =
        "https://api.twelvedata.com/time_series?symbol=" +
        encodeURIComponent(symbol) +
        "&interval=" +
        encodeURIComponent(interval) +
        "&outputsize=" +
        outputsize +
        "&apikey=" +
        apiKey;

      const upstream = await fetch(url);
      const data = await upstream.json();

      if (!data || data.status === "error" || data.code) {
        res.status(404).json({
          error: (data && data.message) || "Couldn't find chart data for " + symbol + ".",
        });
        return;
      }

      const values = Array.isArray(data.values)
        ? data.values.map(function (v) {
            return { datetime: v.datetime, close: v.close };
          })
        : [];

      res.status(200).json({ symbol: symbol, values: values });
      return;
    }

    // Default: type === "quote"
    const url =
      "https://api.twelvedata.com/quote?symbol=" +
      encodeURIComponent(symbol) +
      "&apikey=" +
      apiKey;

    const upstream = await fetch(url);
    const data = await upstream.json();

    if (!data || data.status === "error" || data.code) {
      res.status(404).json({
        error: (data && data.message) || "Couldn't find data for " + symbol + ".",
      });
      return;
    }

    const price = Number(data.close);
    const previousClose = Number(data.previous_close);
    const change = Number.isFinite(Number(data.change))
      ? Number(data.change)
      : price - previousClose;
    const percentChange = Number.isFinite(Number(data.percent_change))
      ? Number(data.percent_change)
      : previousClose
      ? (change / previousClose) * 100
      : 0;

    res.status(200).json({
      symbol: data.symbol || symbol,
      name: data.name || "",
      exchange: data.exchange || "",
      instrumentType: data.type || "",
      price: price,
      open: Number(data.open),
      high: Number(data.high),
      low: Number(data.low),
      previousClose: previousClose,
      change: change,
      percentChange: percentChange,
      marketStatus:
        data.is_market_open === true
          ? "Open"
          : data.is_market_open === false
          ? "Closed"
          : "",
      updatedAt: data.datetime
        ? new Date(data.datetime).toISOString()
        : new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Market data request failed." });
  }
}
