// api/_verifyProToken.js
//
// Verifies a PRO token minted by api/issue-pro-token.js.
// Import and call this from api/chat.js and api/tts.js instead of
// trusting any client-sent "isPro" flag directly.
//
// Usage:
//   const { verifyProToken } = require("./_verifyProToken");
//   const proEmail = verifyProToken(req.body.nmxProToken);
//   const isPro = !!proEmail;

const crypto = require("crypto");

function base64urlDecode(input) {
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) { input += "="; }
  return Buffer.from(input, "base64").toString("utf8");
}

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

/**
 * Returns a truthy value if the token is valid and not expired,
 * otherwise returns null. Never throws. Email may or may not be
 * present in the payload — it's no longer required for validity,
 * since it can't be reliably supplied by /pro-access for this
 * Squarespace product. Callers should treat any truthy return as
 * "this is a verified PRO member," not rely on the email specifically.
 */
function verifyProToken(token) {
  try {
    if (!token || typeof token !== "string") { return null; }
    var secret = process.env.PRO_TOKEN_SECRET;
    if (!secret) { return null; }

    var parts = token.split(".");
    if (parts.length !== 2) { return null; }
    var payloadB64 = parts[0];
    var signature = parts[1];

    var expectedSignature = sign(payloadB64, secret);
    // Constant-time comparison to avoid timing attacks.
    var sigBuf = Buffer.from(signature);
    var expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) { return null; }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) { return null; }

    var payload = JSON.parse(base64urlDecode(payloadB64));
    if (!payload || !payload.exp) { return null; }
    if (Date.now() > payload.exp) { return null; } // expired

    return payload.email || "verified-pro-member";
  } catch (e) {
    return null;
  }
}

module.exports = { verifyProToken: verifyProToken };
