// =========================================================
// POST /api/sync/request-code
// Body: { "email": "user@example.com" }
//
// Generates a 6-digit code, stores it (10-minute expiry),
// and emails it via your existing Google Apps Script mailer.
//
// Requires env vars (Vercel → Project → Settings → Environment
// Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY   (the "service_role" key, not anon)
//   APPS_SCRIPT_URL        (same URL your snapshot capture uses)
//
// Requires the "@supabase/supabase-js" package — add to your
// project with: npm install @supabase/supabase-js
//
// FIXED: the upsert() call now passes { onConflict: "email" }.
// Without it, Supabase's upsert() matches on the table's PRIMARY
// KEY by default — since no id was ever passed in here, every
// code request inserted a brand-new row instead of replacing the
// old one. That left multiple rows per email once someone
// requested a code more than once, which broke the .single()
// lookup in issue-pro-token.js (it errors on more than one match),
// surfacing as "No code requested for this email" even when a
// code very much had been requested.
//
// REQUIRES: a unique constraint on the "email" column of
// nma_sync_codes, or onConflict has nothing to match against.
// Check/add it in Supabase's SQL editor first:
//   alter table nma_sync_codes add constraint
//     nma_sync_codes_email_unique unique (email);
// =========================================================
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ success: false, error: "Valid email required" });
  }

  const cleanEmail = email.trim().toLowerCase();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error: dbError } = await supabase
    .from("nma_sync_codes")
    .upsert({ email: cleanEmail, code, expires_at: expiresAt }, { onConflict: "email" });

  if (dbError) {
    console.error("request-code db error:", dbError);
    return res.status(500).json({ success: false, error: "Could not generate code" });
  }

  try {
    const emailRes = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "syncCode",
        email: cleanEmail,
        code: code
      })
    });
    const emailData = await emailRes.json().catch(() => ({}));
    if (!emailData.success) {
      throw new Error(emailData.error || "Apps Script reported failure");
    }
  } catch (err) {
    console.error("request-code email error:", err);
    return res.status(500).json({ success: false, error: "Could not send code email" });
  }

  return res.status(200).json({ success: true, message: "Code sent" });
}
  
