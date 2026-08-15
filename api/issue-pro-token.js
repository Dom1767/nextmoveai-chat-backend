// api/issue-pro-token.js (v2 — email optional)
//
// Mints a short-lived, signed token proving PRO membership.
// This endpoint is only ever called from the /pro-access page,
// which itself is only reachable by real Veto PRO members because
// Squarespace's own paywall blocks everyone else from loading it.
// That's the actual security boundary — email is no longer required
// or reliably obtainable client-side for this Squarespace product,
// so it's accepted only if provided and otherwise omitted.
//
// The token is a signed JWT-style payload: base64(payload).base64(hmac)
// No external JWT library needed — this is intentionally minimal.
//
// REQUIRED ENV VAR (set in Vercel project settings):
//   PRO_TOKEN_SECRET — a long random string, kept secret. Never
//   expose this to the client or commit it to the repo.

const crypto = require("crypto");

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

module.exports = async (req, res) => {
  // Mirror whatever CORS setup your existing api/chat.js uses —
  // this must allow requests from your Squarespace domain.
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

  var secret = process.env.PRO_TOKEN_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  // Email is best-effort only now — not required. The real proof of
  // PRO status is that this endpoint only ever gets called from a
  // page Squarespace's paywall already gated to the PRO plan.
  var email = req.body && typeof req.body.email === "string" ? req.body.email.toLowerCase().trim() : null;

  var payload = {
    email: email || null,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  };

  var payloadB64 = base64url(JSON.stringify(payload));
  var signature = sign(payloadB64, secret);
  var token = payloadB64 + "." + signature;

  res.status(200).json({ token: token, expiresAt: payload.exp });
};
