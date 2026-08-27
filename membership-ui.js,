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
//      id="nmxMembershipStatus" aria-label="Log in or reconnect membership">
//     <span class="nmx-membership-dot" aria-hidden="true"></span>
//     <span id="nmxMembershipStatusText">Log In</span>
//   </a>
//
// This script auto-detects those two ids on load. If a page doesn't
// include the badge markup, this quietly does nothing — safe to
// include site-wide via Code Injection later if that's ever wanted,
// without needing per-page opt-in logic.
//
// Behavior (identical everywhere, matching the homepage exactly):
//   - "Log In" + href="/pro-access" when no local PRO token is found
//   - "✓ Membership Verified" (shortened to "✓ Verified" under
//     600px via the .nmx-membership-long CSS class) + href="/ai-coach"
//     when one is found
//
// NOTE: this only checks whether a token exists locally, not
// whether it's still valid/unexpired — real verification of that
// happens server-side on any actual chat/TTS call. This badge is a
// fast, optimistic UI signal, same as everywhere else on the site
// that reads this token client-side.
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

  function isProMember() {
    return !!getProToken();
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
    } else {
      status.classList.remove("is-verified");
      status.classList.add("is-login");
      textEl.textContent = "Log In";
      status.href = "/pro-access";
      status.setAttribute("aria-label", "Log in or reconnect membership");
      status.title = "Log in or reconnect your membership";
    }
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
    getProToken: getProToken
  };
})();
