// =========================================================
// POST /api/verify-pro
// Body: { "nmxProToken": "<token>" }
//
// Lightweight PRO-status check hit by /ai-coach (the Premium AI
// Command Center) once on page load, before any "unlimited access"
// messaging is shown or any billed chat/TTS call is made.
//
// This is the ONE source of truth for "is this token a valid PRO
// token" — it delegates entirely to verifyProToken() from
// _verifyProToken.js, the SAME helper api/chat.js and api/tts.js
// already use. No separate/duplicate verification logic here, so
// this endpoint can never disagree with what chat/TTS actually
// enforce.
//
// Response shape:
//   { isPro: true }   — token is valid and unexpired
//   { isPro: false }  — token missing, malformed, expired, or
//                       PRO_TOKEN_SECRET isn't set server-side
//
// Never throws, never 500s on a bad/missing token — an invalid
// token is a normal "not PRO" result, not a server error. This
// matters because /ai-coach's own client code treats ANY non-ok
// HTTP response as "membership issue" and shows the reconnect
// banner — so this endpoint should only return non-200 for actual
// infrastructure problems (wrong method), never for "just not PRO."
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
    return res.status(405).json({ isPro: false, error: "Method not allowed" });
  }

  const { nmxProToken } = req.body || {};

  // verifyProToken() never throws — returns null for any invalid,
  // expired, or missing token, or a truthy value (email or the
  // "verified-pro-member" placeholder) if valid. Either way, this
  // endpoint always responds 200 — "not PRO" is a valid, normal
  // result, not an error condition.
  const result = verifyProToken(nmxProToken);

  return res.status(200).json({ isPro: !!result });
}
