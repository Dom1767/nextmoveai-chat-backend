// =========================================================
// GET  /api/sync/tools?key=next-dollar
// POST /api/sync/tools   Body: { "key": "next-dollar", "value": {...} }
//
// Both require: Authorization: Bearer <token>  (issued by /api/sync/verify)
//
// This is the one missing piece between the working login flow
// (request-code -> verify, which issues a token and returns the
// tools blob ONCE at login) and a page needing to read/write a
// single tool's data on every load/save afterward. Same tables,
// same auth pattern as verify.js — no schema changes.
//
// GET  -> looks up the session, returns { success, value } where
//         value is whatever was last saved under that key, or null
//         if nothing's been saved yet.
// POST -> looks up the session, merges { [key]: value } into the
//         existing tools JSONB (does not touch other keys), saves.
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getEmailForToken(token) {
  if (!token) return null;

  const { data, error } = await supabase
    .from("nma_sync_sessions")
    .select("email, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  return data.email;
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  const email = await getEmailForToken(token);
  if (!email) {
    return res.status(401).json({ success: false, error: "Invalid or expired session" });
  }

  if (req.method === "GET") {
    const key = typeof req.query.key === "string" ? req.query.key.slice(0, 100) : null;
    if (!key) {
      return res.status(400).json({ success: false, error: "key query param required" });
    }

    const { data: userRow, error } = await supabase
      .from("nma_users")
      .select("tools")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("tools GET error:", error);
      return res.status(500).json({ success: false, error: "Could not load data" });
    }

    const tools = (userRow && userRow.tools) || {};
    const value = Object.prototype.hasOwnProperty.call(tools, key) ? tools[key] : null;

    return res.status(200).json({ success: true, value: value });
  }

  if (req.method === "POST") {
    const { key, value } = req.body || {};
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "key is required" });
    }

    const { data: userRow, error: fetchErr } = await supabase
      .from("nma_users")
      .select("tools")
      .eq("email", email)
      .maybeSingle();

    if (fetchErr) {
      console.error("tools POST fetch error:", fetchErr);
      return res.status(500).json({ success: false, error: "Could not load existing data" });
    }

    const existingTools = (userRow && userRow.tools) || {};
    const updatedTools = Object.assign({}, existingTools, { [key.slice(0, 100)]: value });

    const { error: saveErr } = await supabase
      .from("nma_users")
      .upsert({ email: email, tools: updatedTools }, { onConflict: "email" });

    if (saveErr) {
      console.error("tools POST save error:", saveErr);
      return res.status(500).json({ success: false, error: "Could not save data" });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
