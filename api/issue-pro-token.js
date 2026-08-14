// api/issue-pro-token.js
//
// Mints a short-lived, signed token proving PRO membership.
// This endpoint is only ever called from the /pro-access page,
// which itself is only reachable by real Veto PRO members because
// Squarespace's own paywall blocks everyone else from loading it.
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

  var email = req.body && req.body.email;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Missing email" });
    return;
  }

  var payload = {
    email: email.toLowerCase().trim(),
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  };

  var payloadB64 = base64url(JSON.stringify(payload));
  var signature = sign(payloadB64, secret);
  var token = payloadB64 + "." + signature;

  res.status(200).json({ token: token, expiresAt: payload.exp });
};
