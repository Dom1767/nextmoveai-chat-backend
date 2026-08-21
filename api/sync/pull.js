// =========================================================
// api/sync/pull.js — returns every synced key/value pair saved
// for the currently signed-in (email+code verified) user. Called
// by sync-shared.js on page load, before each tool page's own
// script runs, so the page's normal localStorage-reading code
// sees the synced values as if they'd always been there — no
// tool page needs to know sync exists.
// =========================================================

import { verifySyncToken } from "../_verifySyncToken.js";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    const { syncToken } = req.body || {};

    const email = await verifySyncToken(syncToken);
    if (!email) {
      res.status(401).json({ error: "not_signed_in" });
      return;
    }

    const { data, error } = await supabase
      .from("nma_synced_data")
      .select("key, value, updated_at")
      .eq("user_id", email);

    if (error) {
      console.error("Sync pull select error:", error);
      res.status(500).json({ error: "Unable to load synced data." });
      return;
    }

    const result = {};
    (data || []).forEach(function (row) {
      result[row.key] = row.value;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Sync pull route error:", error);
    res.status(500).json({ error: "Something went wrong loading your data." });
  }
}
