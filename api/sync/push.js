// =========================================================
// api/sync/push.js — saves a batch of localStorage key/value
// pairs to the server for the currently signed-in (email+code
// verified) user. Called by sync-shared.js, debounced, whenever
// a synced key changes on any tool page.
//
// Nothing here is tool-specific — it has no idea what
// "nextmoveDebtTotal" or "nmx_journey" actually mean, it just
// stores whatever key/value pairs it's handed under that user's
// email. Each tool page keeps deciding what to write and when;
// this endpoint only persists it.
// =========================================================

import { verifySyncToken } from "../_verifySyncToken.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_KEYS_PER_REQUEST = 60;
const MAX_VALUE_LENGTH = 20000;

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { syncToken, data } = req.body || {};

    const email = await verifySyncToken(syncToken);
    if (!email) {
      res.status(401).json({ error: "not_signed_in" });
      return;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      res.status(400).json({ error: "No data provided." });
      return;
    }

    const entries = Object.entries(data);

    if (!entries.length) {
      res.status(200).json({ success: true, saved: 0 });
      return;
    }

    if (entries.length > MAX_KEYS_PER_REQUEST) {
      res.status(400).json({
        error: "Too many keys in a single request (" + entries.length + " > " + MAX_KEYS_PER_REQUEST + ")."
      });
      return;
    }

    const rows = [];
    for (const [key, rawValue] of entries) {
      if (typeof key !== "string" || !key.trim()) { continue; }

      const value = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
      if (value.length > MAX_VALUE_LENGTH) {
        res.status(400).json({ error: "Value for '" + key + "' is too large." });
        return;
      }

      rows.push({
        user_id: email,
        key: key.slice(0, 200),
        value: value,
        updated_at: new Date().toISOString()
      });
    }

    const { error } = await supabase
      .from("nma_synced_data")
      .upsert(rows, { onConflict: "user_id,key" });

    if (error) {
      console.error("Sync push upsert error:", error);
      res.status(500).json({ error: "Unable to save synced data." });
      return;
    }

    res.status(200).json({ success: true, saved: rows.length });
  } catch (error) {
    console.error("Sync push route error:", error);
    res.status(500).json({ error: "Something went wrong saving your data." });
  }
}
