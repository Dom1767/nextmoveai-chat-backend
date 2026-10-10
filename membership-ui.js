// =========================================================
// NEXTMOVEAI — SHARED MEMBERSHIP STATUS MODULE
// Host this alongside tool-sync.js and login-ui.js:
//   https://nextmoveai-chat-backend.vercel.app/membership-ui.js
//
// Every page includes ONE script tag:
//   <script src="https://nextmoveai-chat-backend.vercel.app/membership-ui.js"></script>
//
// and provides ONLY the badge markup, using these exact ids/classes
// (same convention the homepage already established) — no per-page
// JavaScript needed at all:
//
//   <a href="/pro-access" class="nmx-membership-status is-login"
//      id="nmxMembershipStatus" aria-label="Member login — log in or reconnect membership">
//     <span class="nmx-membership-dot" aria-hidden="true"></span>
//     <span id="nmxMembershipStatusText">Member Login</span>
//   </a>
//
// This script auto-detects those two ids on load. If a page doesn't
// include the badge markup, this quietly does nothing — safe to
// include site-wide via Code Injection later if that's ever wanted,
// without needing per-page opt-in logic.
//
// Behavior (identical everywhere, matching the homepage exactly):
//   - "Member Login" + href="/pro-access" when no local PRO token is found
//   - "✓ Membership Verified" (shortened to "✓ Verified" under
//     600px via the .nmx-membership-long CSS class) + href="/ai-coach"
//     when one is found
//
// UPDATED 2026-10-10: the badge now checks the token's expiry date
// (shows "Renew PRO" once it has expired) and confirms the token with
// /api/verify-pro once per tab session (cached 10 minutes). Chat and
// voice still enforce PRO on the server as before.
//
// Re-renders on:
//   - "storage" (verification completed in another tab of this browser)
//   - "pageshow" (returning via back/forward cache)
//   - "focus" (switching back to this tab/window at all — catches
//     verifying on a different DEVICE entirely, where "storage"
//     can't fire)
//   - "visibilitychange" (tab becoming visible again)
// =========================================================

(function () {
  "use strict";

  var TOKEN_KEYS = ["nmx_pro_token", "nmxProToken"];

  function getProToken() {
    try {
      for (var i = 0; i < TOKEN_KEYS.length; i++) {
        var v = window.localStorage.getItem(TOKEN_KEYS[i]);
        if (v) { return v; }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // 2026-10-10: a token only counts if it hasn't expired. The token's
  // payload carries its expiry ("exp", in milliseconds), so the badge
  // can tell right away; the server is then asked once per tab session
  // (cached 10 minutes) to confirm the token is genuine.
  function tokenExpiry(token) {
    try {
      var b64 = String(token).split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) { b64 += "="; }
      var payload = JSON.parse(atob(b64));
      return payload && payload.exp ? Number(payload.exp) : null;
    } catch (e) { return null; }
  }
  var VERIFY_URL = "https://nextmoveai-chat-backend.vercel.app/api/verify-pro";
  var CACHE_KEY = "nmx_pro_verify_cache";
  function cachedVerdict(token) {
    try {
      var c = JSON.parse(window.sessionStorage.getItem(CACHE_KEY) || "null");
      if (c && c.t === token.slice(-24) && Date.now() - c.at < 10 * 60 * 1000) { return c.ok; }
    } catch (e) {}
    return null;
  }
  function isProMember() {
    var token = getProToken();
    if (!token) { return false; }
    var exp = tokenExpiry(token);
    if (!exp || Date.now() >= exp) { return false; }
    return cachedVerdict(token) !== false;
  }
  function isExpired() {
    var token = getProToken();
    if (!token) { return false; }
    var exp = tokenExpiry(token);
    return !exp || Date.now() >= exp || cachedVerdict(token) === false;
  }
  var verifying = false;
  function verifyWithServer() {
    var token = getProToken();
    if (!token || verifying || cachedVerdict(token) !== null) { return; }
    var exp = tokenExpiry(token);
    if (!exp || Date.now() >= exp) { return; }
    verifying = true;
    fetch(VERIFY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nmxProToken: token }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        // Only record a definite answer; network trouble leaves the badge as is.
        if (d && typeof d.isPro === "boolean") {
          try { window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: token.slice(-24), ok: d.isPro, at: Date.now() })); } catch (e) {}
          renderMembership();
        }
      })
      .catch(function () {})
      .then(function () { verifying = false; });
  }

  function renderMembership() {
    var status = document.getElementById("nmxMembershipStatus");
    var textEl = document.getElementById("nmxMembershipStatusText");
    if (!status || !textEl) { return; }

    if (isProMember()) {
      status.classList.remove("is-login");
      status.classList.add("is-verified");
      textEl.innerHTML = '✓ <span class="nmx-membership-long">Membership </span>Verified';
      status.href = "/ai-coach";
      status.setAttribute("aria-label", "Membership verified. Open Veto PRO.");
      status.title = "Membership verified on this browser";
    } else if (isExpired()) {
      status.classList.remove("is-verified");
      status.classList.add("is-login");
      textEl.textContent = "Renew PRO";
      status.href = "/pro-access";
      status.setAttribute("aria-label", "Your PRO access has expired. Log in again to reconnect.");
      status.title = "Your PRO access has expired. Log in again to reconnect.";
    } else {
      status.classList.remove("is-verified");
      status.classList.add("is-login");
      textEl.textContent = "Member Login";
      status.href = "/pro-access";
      status.setAttribute("aria-label", "Member login — log in or reconnect membership");
      status.title = "Log in or reconnect your membership";
    }
    verifyWithServer();
  }

  function init() {
    renderMembership();

    window.addEventListener("storage", function (e) {
      if (e.key === "nmx_pro_token" || e.key === "nmxProToken") {
        renderMembership();
      }
    });

    window.addEventListener("pageshow", renderMembership);
    window.addEventListener("focus", renderMembership);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { renderMembership(); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Exposed in case a page ever needs to force a re-check manually
  // (e.g. right after a chat/TTS call surfaces a 401 and the page
  // wants the badge to reflect that immediately) or read status
  // without waiting on the DOM elements to exist.
  window.NextMoveMembershipUI = {
    refresh: renderMembership,
    isProMember: isProMember,
    isExpired: isExpired,
    getProToken: getProToken
  };
})();
