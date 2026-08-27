// api/_verifyProToken.js
//
// Verifies a PRO token minted by api/issue-pro-token.js.
// Import and use this from api/chat.js and api/tts.js instead of
// trusting any client-sent "isPro" flag directly.
//
// Usage:
//   import { verifyProToken } from "./_verifyProToken.js";
//   const proEmail = verifyProToken(req.body.nmxProToken);
//   const isPro = !!proEmail;
import crypto from "crypto";
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
 * otherwise returns null. Never throws.
 *
 * Tokens minted by the current /pro-access flow (email + code
 * verification) always carry a real, verified email in the
 * payload. Older tokens minted before that flow existed may carry
 * no email at all and still verify successfully here — those
 * remain valid PRO tokens (a member isn't logged out just because
 * their token predates this change), they simply won't have a
 * matching synced account until that member revisits /pro-access
 * and gets a fresh token. Callers that need a real email (e.g. to
 * look up synced data) should check the return value isn't the
 * "verified-pro-member" placeholder before using it as an email.
 */
export function verifyProToken(token) {
  try {
    if (!token || typeof token !== "string") { return null; }
    const secret = process.env.PRO_TOKEN_SECRET;
    if (!secret) { return null; }
    const parts = token.split(".");
    if (parts.length !== 2) { return null; }
    const payloadB64 = parts[0];
    const signature = parts[1];
    const expectedSignature = sign(payloadB64, secret);
    // Constant-time comparison to avoid timing attacks.
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) { return null; }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) { return null; }
    const payload = JSON.parse(base64urlDecode(payloadB64));
    if (!payload || !payload.exp) { return null; }
    if (Date.now() > payload.exp) { return null; } // expired
    return payload.email || "verified-pro-member";
  } catch (e) {
    return null;
  }
}
