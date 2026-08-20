// =========================================================
// api/issue-pro-token.js
//
// UPDATED: this endpoint now requires a verified email, not a
// self-reported one — closing a real account-takeover gap. Before
// this change, a PRO member reaching /pro-access could type in
// *anyone's* email and this endpoint would happily mint a session
// tied to that person's synced financial data, with no proof of
// ownership.
//
// New flow (mirrors api/sync/verify.js's already-proven pattern):
//   1. /pro-access calls api/sync/request-code.js first with the
//      visitor's email (unchanged — that endpoint already exists
//      and works, no changes needed there).
//   2. The visitor enters the code they received by email.
//   3. THIS endpoint now requires { email, code } instead of just
//      { email }. It verifies the code exactly like
//      api/sync/verify.js does, confirming real inbox ownership.
//   4. Only after that succeeds does it:
//        a. create/find the nma_users row (same as sync/verify.js)
//        b. issue a 30-day sync session token (same as
//           sync/verify.js) — this is what lets every tool page
//           pull this person's saved data automatically, with no
//           separate sync banner or opt-in step needed for PRO
//           members specifically
//        c. issue the existing signed PRO JWT (same scheme as
//           before), now with a REAL, verified email embedded
//           instead of a self-reported one
//
// PRO status itself is still proven the same way as before —
// Squarespace's own paywall is the only thing that lets someone
// reach /pro-access in the first place. This change only closes
// the email-ownership gap; it does not change how PRO membership
// itself is determined.
//
// REQUIRED ENV VARS:
//   PRO_TOKEN_SECRET — unchanged, signs the PRO JWT
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — same Supabase project
//   already used by api/sync/verify.js
// =========================================================

import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payloadB64, secret) {
  return base64url(
    crypto.createHmac("sha256", secret).update(payloadB64).digest()
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.nextmoveai.ai");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.PRO_TOKEN_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  const { email, code } = req.body || {};

  if (!email || typeof email !== "string" || !code) {
    res.status(400).json({
      error: "email_and_code_required",
      message: "Enter your email and the code we sent you to activate PRO sync."
    });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();

  // ---- Verify the code (mirrors api/sync/verify.js exactly) ----
  const { data: codeRow, error: codeErr } = await supabase
    .from("nma_sync_codes")
    .select("code, expires_at")
    .eq("email", cleanEmail)
    .single();

  if (codeErr || !codeRow) {
    res.status(400).json({
      error: "no_code_requested",
      message: "No code requested for this email — request one first."
    });
    return;
  }
  if (new Date(codeRow.expires_at) < new Date()) {
    res.status(400).json({
      error: "code_expired",
      message: "Code expired — request a new one."
    });
    return;
  }
  if (String(codeRow.code) !== String(code).trim()) {
    res.status(400).json({
      error: "incorrect_code",
      message: "Incorrect code."
    });
    return;
  }

  // Code is correct — remove it so it can't be reused.
  await supabase.from("nma_sync_codes").delete().eq("email", cleanEmail);

  // ---- Ensure a synced user record exists ----
  const { data: userRow } = await supabase
    .from("nma_users")
    .select("tools")
    .eq("email", cleanEmail)
    .single();

  if (!userRow) {
    await supabase.from("nma_users").insert({ email: cleanEmail, tools: {} });
  }

  // ---- Issue the 30-day sync session token ----
  const syncToken = crypto.randomBytes(32).toString("hex");
  const syncExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error: sessionErr } = await supabase
    .from("nma_sync_sessions")
    .insert({ token: syncToken, email: cleanEmail, expires_at: syncExpiresAt });

  if (sessionErr) {
    console.error("issue-pro-token sync session error:", sessionErr);
    res.status(500).json({ error: "Could not create sync session" });
    return;
  }

  // ---- Issue the existing signed PRO JWT, now with a verified email ----
  const payload = {
    email: cleanEmail,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = sign(payloadB64, secret);
  const proToken = payloadB64 + "." + signature;

  // Both tokens are returned together: nmx_pro_token (the JWT,
  // already checked everywhere PRO status matters) and the new
  // syncToken (matching what api/sync/verify.js already issues,
  // and what the existing Spending-page sync system already knows
  // how to use) — the frontend just needs to store both.
  res.status(200).json({
    token: proToken,
    expiresAt: payload.exp,
    syncToken: syncToken,
    tools: userRow ? userRow.tools : {}
  });
}
