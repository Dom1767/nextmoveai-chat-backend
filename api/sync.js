// =========================================================
// GET  /api/sync           (Authorization: Bearer <token>)
//   → returns everything the visitor has saved across all tools
//
// POST /api/sync           (Authorization: Bearer <token>)
//   Body: { "tool": "invest", "data": { ...tool's state... } }
//   → saves/overwrites just that tool's branch, leaves the rest alone
//
// RESTORED 2026-10-07: on Aug 14 this file was overwritten with a
// copy of the chat endpoint (that copy says "Deploy this on Vercel
// as: api/chat.js"), so the Score, Spending, Plan and Grow pages'
// own Save/Load calls to /api/sync were answered by chat code and
// failed. This is the original Aug 9 sync handler, with three
// additions copied from the working api/sync/tools.js:
//   1) Cross-site headers + OPTIONS handling, so the browser on
//      www.nextmoveai.ai is allowed to call it with an
//      Authorization header (the Aug 9 version had none).
//   2) .maybeSingle() lookups, so a member with no saved row yet
//      gets an empty result instead of an error.
//   3) upsert on save, so a first save creates the row instead of
//      silently updating nothing.
// Same tables (nma_sync_sessions, nma_users), same request and
// response shapes as before — no page changes needed.
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// Optional: ALLOWED_ORIGIN (defaults to "*", same as tools.js)
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
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const email = await getEmailForToken(token);

  if (!email) {
    return res.status(401).json({ success: false, error: "Invalid or expired session" });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("nma_users")
      .select("tools, updated_at")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("sync load error:", error);
      return res.status(500).json({ success: false, error: "Could not load data" });
    }
    return res.status(200).json({
      success: true,
      found: !!data,
      tools: (data && data.tools) || {},
      updatedAt: data ? data.updated_at : null
    });
  }

  if (req.method === "POST") {
    const { tool, data: toolData } = req.body || {};
    if (!tool || typeof tool !== "string" || typeof toolData === "undefined") {
      return res.status(400).json({ success: false, error: "tool and data required" });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from("nma_users")
      .select("tools")
      .eq("email", email)
      .maybeSingle();

    if (fetchErr) {
      console.error("sync fetch error:", fetchErr);
      return res.status(500).json({ success: false, error: "Could not load existing data" });
    }

    const mergedTools = { ...((existing && existing.tools) || {}), [tool.slice(0, 100)]: toolData };

    const { error } = await supabase
      .from("nma_users")
      .upsert(
        { email: email, tools: mergedTools, updated_at: new Date().toISOString() },
        { onConflict: "email" }
      );

    if (error) {
      console.error("sync save error:", error);
      return res.status(500).json({ success: false, error: "Could not save data" });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
