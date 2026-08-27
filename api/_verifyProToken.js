// =========================================================
// api/verify-pro.js — lightweight, read-only PRO-token check
//
// Lets a page confirm PRO status up front — before showing any
// "unlimited access" messaging or spending a real chat/TTS call —
// instead of assuming a Squarespace member is automatically
// entitled to unlimited backend usage. Squarespace's member gate
// controls whether someone can reach a page at all; this is the
// actual entitlement check for the expensive stuff (Anthropic/
// OpenAI calls) that lives behind it.
//
// This endpoint never mints, refreshes, or modifies a token — it
// only verifies one that was already issued by /api/issue-pro-token.
// Currently used by /ai-coach on page load.
//
// Requires PRO_TOKEN_SECRET — already set, used by _verifyProToken.
// =========================================================

import { verifyProToken } from "./_verifyProToken.js";

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const proEmail = verifyProToken(req.body && req.body.nmxProToken);
    const isPro = !!proEmail;

    // Deliberately does NOT return the email/token contents back to
    // the client — the page only needs a yes/no to decide what UI
    // to show, not the underlying identity data.
    return res.status(200).json({ isPro: isPro });
  } catch (err) {
    console.error("verify-pro error:", err);
    // A verification error should read the same as "not verified"
    // to the caller, not as a 500 that might get silently ignored
    // by a page that only checks response.ok.
    return res.status(200).json({ isPro: false });
  }
}
