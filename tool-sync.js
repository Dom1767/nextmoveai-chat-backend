// =========================================================
// NEXTMOVEAI — SHARED TOOL SYNC SDK
// Include on every tool page with:
//   <script src="https://nextmoveai-chat-backend.vercel.app/tool-sync.js"></script>
//
// Wraps the existing, working login system (request-code -> verify)
// and the new /api/sync/tools endpoint into one small interface so
// no tool page has to know about tokens, auth headers, or the
// underlying endpoints directly.
//
// USAGE ON A TOOL PAGE:
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
//   // once the user enters the code they received:
//   const result = await NextMoveSync.confirmLogin("482913");
//   if (result.success) { /* logged in, token now stored */ }
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

  function getToken() {
    try { return window.localStorage.getItem(TOKEN_KEY); }
    catch (e) { return null; }
  }
  function getStoredEmail() {
    try { return window.localStorage.getItem(EMAIL_KEY); }
    catch (e) { return null; }
  }
  function storeSession(token, email) {
    try {
      if (token) { window.localStorage.setItem(TOKEN_KEY, token); }
      if (email) { window.localStorage.setItem(EMAIL_KEY, email); }
    } catch (e) {}
  }
  function clearSession() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(EMAIL_KEY);
    } catch (e) {}
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

  // Step 1 of login: sends a 6-digit code to this email via the
  // existing Apps Script mailer. Does NOT log the person in yet.
  function login(email) {
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
  // On success, stores the session token — from then on isLoggedIn(),
  // get(), and set() all just work.
  function confirmLogin(code) {
    var email = getStoredEmail();
    return fetch(API_BASE + "/api/sync/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, code: code })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.success && data.token) {
          storeSession(data.token, email);
        }
        return data;
      })
      .catch(function () {
        return { success: false, error: "Could not reach the server" };
      });
  }

  // login() needs to remember which email the code was sent to, so
  // confirmLogin() can send it back along with the code. Storing it
  // as soon as login() is called (rather than waiting for success)
  // keeps this one honest round trip instead of asking the caller
  // to pass the email again later.
  var originalLogin = login;
  login = function (email) {
    storeSession(null, email);
    return originalLogin(email);
  };

  function logout() {
    clearSession();
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
    login: login,
    confirmLogin: confirmLogin,
    logout: logout,
    get: get,
    set: set
  };
})(window);
