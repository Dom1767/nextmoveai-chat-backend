// =========================================================
// NEXTMOVEAI — SHARED TOOL SYNC SDK
// Include on every tool page with:
//   <script src="https://nextmoveai-chat-backend.vercel.app/tool-sync.js"></script>
//
// UPDATED: unified login. There are still two backend endpoints
// (regular sync login vs. PRO activation), because PRO status can
// currently only be proven by reaching /pro-access behind
// Squarespace's paywall — see api/issue-pro-token.js for why. But
// from every PAGE's point of view there is now just ONE login
// flow: NextMoveSync.login() + NextMoveSync.confirmLogin().
//
// Whichever endpoint answers, BOTH nmx_sync_token and nmx_pro_token
// get stored whenever the response includes them. This is the fix
// for the bug where verifying on /pro-access left the sync token
// unset, so every other page still thought the person was logged
// out.
//
// USAGE ON A TOOL PAGE (unchanged):
//
//   await NextMoveSync.ready;
//
//   if (NextMoveSync.isLoggedIn()) {
//     const saved = await NextMoveSync.get("next-dollar");
//     if (saved) { /* repopulate the page with saved */ }
//   }
//
//   // later, on save:
//   await NextMoveSync.set("next-dollar", { oneTimeAmount: 500, ... });
//
//   // to start login:
//   await NextMoveSync.login("dale@example.com");   // sends the 6-digit code
//
//   // once the user enters the code they received, for a REGULAR
//   // (non-PRO) login:
//   const result = await NextMoveSync.confirmLogin("482913");
//
//   // for a PRO activation login (only ever called from
//   // /pro-access, which is itself behind Squarespace's paywall):
//   const result = await NextMoveSync.confirmLogin("482913", { pro: true });
//
//   if (result.success) { /* logged in, token(s) now stored */ }
//
// NOTE: get()/set() silently return null/false if nobody is logged
// in — pages should keep working from localStorage as a fallback
// exactly as they do today. This SDK only handles the SYNCED layer
// on top of that, it isn't a replacement for local state.
// =========================================================

(function (global) {
  "use strict";

  var API_BASE = "https://nextmoveai-chat-backend.vercel.app";
  var TOKEN_KEY = "nmx_sync_token";
  var EMAIL_KEY = "nmx_sync_email";
  var PRO_TOKEN_KEY = "nmx_pro_token";

  function getToken() {
    try { return window.localStorage.getItem(TOKEN_KEY); }
    catch (e) { return null; }
  }
  function getStoredEmail() {
    try { return window.localStorage.getItem(EMAIL_KEY); }
    catch (e) { return null; }
  }
  function getProToken() {
    try { return window.localStorage.getItem(PRO_TOKEN_KEY); }
    catch (e) { return null; }
  }
  function storeSession(token, email) {
    try {
      if (token) { window.localStorage.setItem(TOKEN_KEY, token); }
      if (email) { window.localStorage.setItem(EMAIL_KEY, email); }
    } catch (e) {}
  }
  // Stores whichever tokens are present in a backend response.
  // /api/sync/verify returns { token }.
  // /api/issue-pro-token returns { token: proToken, syncToken }.
  // This function accepts either shape safely.
  function storeTokensFromResponse(data, email) {
    try {
      if (data.syncToken) {
        window.localStorage.setItem(TOKEN_KEY, data.syncToken);
      } else if (data.token && !data.expiresAt) {
        // Regular sync/verify response — its "token" IS the sync token.
        window.localStorage.setItem(TOKEN_KEY, data.token);
      }
      if (data.expiresAt && data.token) {
        // issue-pro-token response — its "token" is the PRO JWT.
        window.localStorage.setItem(PRO_TOKEN_KEY, data.token);
      }
      if (email) { window.localStorage.setItem(EMAIL_KEY, email); }
    } catch (e) {}
  }
  function clearSession() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(EMAIL_KEY);
    } catch (e) {}
  }
  function clearProSession() {
    try { window.localStorage.removeItem(PRO_TOKEN_KEY); }
    catch (e) {}
  }

  function authHeaders() {
    var headers = { "Content-Type": "application/json" };
    var token = getToken();
    if (token) { headers["Authorization"] = "Bearer " + token; }
    return headers;
  }

  // .ready resolves once the SDK has finished checking localStorage
  // for an existing session. There's no network call involved in
  // becoming "ready" — it just guarantees isLoggedIn()/get()/set()
  // are safe to call with consistent state, instead of every page
  // re-implementing its own "wait for localStorage" timing.
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
  readyResolve(); // localStorage is synchronous, nothing to actually wait on yet

  function isLoggedIn() {
    return !!getToken();
  }

  function isProMember() {
    var token = getProToken();
    if (!token) { return false; }
    try {
      var payloadB64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      while (payloadB64.length % 4) { payloadB64 += "="; }
      var payload = JSON.parse(atob(payloadB64));
      return !!(payload && payload.exp && Date.now() < payload.exp);
    } catch (e) {
      return false;
    }
  }

  // Step 1 of login: sends a 6-digit code to this email via the
  // existing Apps Script mailer. Does NOT log the person in yet.
  // Shared by both the regular and PRO login flows.
  function login(email) {
    storeSession(null, email);
    return fetch(API_BASE + "/api/sync/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email })
    })
      .then(function (res) { return res.json(); })
      .catch(function () {
        return { success: false, error: "Could not reach the server" };
      });
  }

  // Step 2 of login: confirms the code the person received by email.
  //
  // options.pro = true routes to /api/issue-pro-token instead of
  // /api/sync/verify. This should ONLY ever be passed from
  // /pro-access, since that endpoint treats "reached this page" as
  // proof of PRO status (Squarespace's paywall already gates it).
  //
  // Either way, both nmx_sync_token and nmx_pro_token get stored
  // whenever the response includes them, so no page is ever left
  // thinking someone is logged out when they aren't.
  function confirmLogin(code, options) {
    var email = getStoredEmail();
    var pro = !!(options && options.pro);
    var endpoint = pro ? "/api/issue-pro-token" : "/api/sync/verify";

    return fetch(API_BASE + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, code: code })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var success = pro ? !!(data && data.token) : !!(data && data.success && data.token);
        if (success) {
          storeTokensFromResponse(data, email);
          data.success = true;
        }
        return data;
      })
      .catch(function () {
        return { success: false, error: "Could not reach the server" };
      });
  }

  function logout() {
    clearSession();
    clearProSession();
  }

  // Returns whatever was last saved under `key`, or null if nobody
  // is logged in, nothing has been saved yet, or the request fails.
  // Never throws — callers can always fall back to localStorage.
  function get(key) {
    return readyPromise.then(function () {
      var token = getToken();
      if (!token) { return null; }

      return fetch(API_BASE + "/api/sync/tools?key=" + encodeURIComponent(key), {
        method: "GET",
        headers: authHeaders()
      })
        .then(function (res) {
          if (res.status === 401) { clearSession(); return null; }
          if (!res.ok) { return null; }
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.success) { return null; }
          return data.value !== undefined ? data.value : null;
        })
        .catch(function () { return null; });
    });
  }

  // Saves `value` under `key`. Returns true/false — never throws.
  function set(key, value) {
    return readyPromise.then(function () {
      var token = getToken();
      if (!token) { return false; }

      return fetch(API_BASE + "/api/sync/tools", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ key: key, value: value })
      })
        .then(function (res) {
          if (res.status === 401) { clearSession(); return false; }
          return res.ok;
        })
        .catch(function () { return false; });
    });
  }

  global.NextMoveSync = {
    ready: readyPromise,
    isLoggedIn: isLoggedIn,
    isProMember: isProMember,
    login: login,
    confirmLogin: confirmLogin,
    logout: logout,
    get: get,
    set: set
  };
})(window);
