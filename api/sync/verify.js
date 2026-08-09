// =========================================================
// POST /api/sync/verify
// Body: { "email": "user@example.com", "code": "482913" }
//
// Checks the code, creates the user record if it doesn't exist
// yet, issues a 30-day session token, and returns everything
// that visitor has saved so far so the page can repopulate.
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ success: false, error: "Email and code required" });
  }

  const cleanEmail = email.trim().toLowerCase();

  const { data: codeRow, error: codeErr } = await supabase
    .from("nma_sync_codes")
    .select("code, expires_at")
    .eq("email", cleanEmail)
    .single();

  if (codeErr || !codeRow) {
    return res.status(400).json({ success: false, error: "No code requested for this email — request one first" });
  }
  if (new Date(codeRow.expires_at) < new Date()) {
    return res.status(400).json({ success: false, error: "Code expired — request a new one" });
  }
  if (String(codeRow.code) !== String(code).trim()) {
    return res.status(400).json({ success: false, error: "Incorrect code" });
  }

  // Code is correct — remove it so it can't be reused.
  await supabase.from("nma_sync_codes").delete().eq("email", cleanEmail);

  // Make sure a user record exists.
  const { data: userRow } = await supabase
    .from("nma_users")
    .select("tools")
    .eq("email", cleanEmail)
    .single();

  if (!userRow) {
    await supabase.from("nma_users").insert({ email: cleanEmail, tools: {} });
  }

  // Issue a session token good for 30 days.
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error: sessionErr } = await supabase
    .from("nma_sync_sessions")
    .insert({ token, email: cleanEmail, expires_at: expiresAt });

  if (sessionErr) {
    console.error("verify session error:", sessionErr);
    return res.status(500).json({ success: false, error: "Could not create session" });
  }

  return res.status(200).json({
    success: true,
    token: token,
    tools: userRow ? userRow.tools : {}
  });
}
