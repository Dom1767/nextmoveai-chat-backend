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
//     <span id="nmxMembershipStatusText">PRO Login</span>
//   </a>
//
// This script auto-detects those two ids on load. If a page doesn't
// include the badge markup, this quietly does nothing — safe to
// include site-wide via Code Injection later if that's ever wanted,
// without needing per-page opt-in logic.
//
// Behavior (identical everywhere, matching the homepage exactly):
//   - "PRO Login" + href="/pro-access" when no local PRO token is found
//   - "✓ Membership Verified" (shortened to "✓ Verified" under
//     600px via the .nmx-membership-long CSS class) + href="/ai-coach"
//     when one is found
//
// UPDATED 2026-10-10: the badge now checks the token's expiry date
// (shows "Sign in again" once it has expired; a sign-in lasts 30 days,
// so this is a re-login, not a payment) and confirms the token with
// /api/verify-pro once per tab session (cached 10 minutes). Chat and
// voice still enforce PRO on the server as before.
//
// UPDATED 2026-10-31 (b): the badge says what it is for. "Member Login"
// is now "PRO Login" and "Sign in again" is now "Reconnect PRO", so free
// visitors can see they don't need it (every free tool works without it).
// Also: if this file is loaded twice on a page, the second copy does nothing.
//
// UPDATED 2026-10-31: tapping "Sign in again" or "Member Login" first
// shows a short note: existing members should choose Log in on the next
// page (Squarespace shows the $9.99 sign-up to anyone not logged in) and
// must not sign up again. Then "Continue" goes to /pro-access as before.
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
  if (window.NextMoveMembershipUI) { return; }

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
      textEl.textContent = "Reconnect PRO";
      status.href = "/pro-access";
      status.setAttribute("aria-label", "Your PRO sign-in on this browser has expired. Reconnect PRO. No new payment needed.");
      status.title = "Your PRO sign-in on this browser lasts 30 days. Tap to reconnect. No new payment needed.";
    } else {
      status.classList.remove("is-verified");
      status.classList.add("is-login");
      textEl.textContent = "PRO Login";
      status.href = "/pro-access";
      status.setAttribute("aria-label", "PRO login, for Veto PRO members. Free tools don't need a login.");
      status.title = "For Veto PRO members. Free tools don't need a login.";
    }
    verifyWithServer();
  }

  /* 2026-10-31 — explain the member login before Squarespace's paywall page */
  function helpBox(expired) {
    var old = document.getElementById("nmxMemberHelp"); if (old) { old.remove(); }
    var wrap = document.createElement("div");
    wrap.id = "nmxMemberHelp";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,14,24,.62);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" aria-labelledby="nmxMemberHelpTitle" style="max-width:420px;width:100%;padding:24px 22px;border-radius:20px;background:#0c2c44;border:1px solid rgba(36,224,199,.3);color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.35)">' +
      '<h2 id="nmxMemberHelpTitle" style="margin:0 0 8px;font-size:20px;font-weight:900;line-height:1.2;color:#fff">' + (expired ? "Reconnect PRO on this browser" : "PRO login") + '</h2>' +
      '<p style="margin:0 0 12px;color:rgba(255,255,255,.78);font-size:14px;line-height:1.5;font-weight:600">' + (expired ? "If your PRO membership is active, you don't need to pay again. Sign-ins on each browser just reconnect every 30 days." : "This login is only for Veto PRO members. All free tools work without it. Already a PRO member? Here's how to connect this browser.") + '</p>' +
      '<ol style="margin:0 0 16px;padding-left:20px;color:#e9fffb;font-size:14px;line-height:1.55;font-weight:650">' +
      '<li>On the next page, choose <b>Log in</b>, not Sign up.</li>' +
      '<li>Log in with the email you used for PRO.</li>' +
      '<li>Tap <b>Activate PRO</b>.</li></ol>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<a href="/pro-access" style="flex:1;min-width:150px;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,#35ead4,#15c8b4);color:#061a2b;font-weight:900;text-align:center;text-decoration:none">Continue →</a>' +
      '<button type="button" data-close style="padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:none;color:#fff;font:inherit;font-weight:800;cursor:pointer">Not now</button></div></div>';
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") { close(); } }
    wrap.addEventListener("click", function (e) { if (e.target === wrap || (e.target.closest && e.target.closest("[data-close]"))) { close(); } });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    var c = wrap.querySelector("a"); if (c) { try { c.focus(); } catch (e) {} }
  }

  function init() {
    renderMembership();

    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("#nmxMembershipStatus");
      if (!a || isProMember()) { return; }
      if (e.metaKey || e.ctrlKey || e.shiftKey) { return; }
      if (window.location.pathname === "/pro-access") { return; }
      e.preventDefault();
      helpBox(isExpired());
    });

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
