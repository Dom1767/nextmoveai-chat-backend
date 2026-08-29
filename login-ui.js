// =========================================================
// NEXTMOVEAI — SHARED LOGIN UI
// Include AFTER tool-sync.js on any page:
//   <script src="https://nextmoveai-chat-backend.vercel.app/tool-sync.js"></script>
//   <script src="https://nextmoveai-chat-backend.vercel.app/login-ui.js"></script>
//
// This is the ONE modal/UI for logging in anywhere on the site —
// including /pro-access. It builds its own markup + styles at
// runtime, so a page needs nothing but the two script tags above
// plus a way to open it.
//
// THREE WAYS TO OPEN IT ON A PAGE:
//
// 1) Automatic — any element with data-nmx-sync-open opens it:
//      <button type="button" data-nmx-sync-open>Sync my data</button>
//
// 2) Automatic, PRO mode — add data-nmx-sync-open-pro instead, ONLY
//    on /pro-access (this tells the backend to also activate PRO,
//    which is only safe on a page already behind Squarespace's
//    paywall):
//      <button type="button" data-nmx-sync-open-pro>Activate PRO</button>
//
// 3) Programmatic:
//      NextMoveSyncUI.open();               // regular login
//      NextMoveSyncUI.open({ pro: true });  // PRO activation, /pro-access only
//
// WHEN LOGIN SUCCEEDS:
//   A "nmx-sync-login" event fires on window, with detail.pro set
//   to true/false depending on which flow completed. Pages that
//   need to react (e.g. re-fetch synced data right away instead of
//   waiting for their next page load) can listen for it:
//
//     window.addEventListener("nmx-sync-login", function (e) {
//       // e.detail.pro tells you whether this was a PRO activation
//     });
//
// This widget does NOT talk to the backend directly — it only
// calls window.NextMoveSync.login() / .confirmLogin(), same as any
// other page would. tool-sync.js remains the only code that owns
// auth and persistence.
// =========================================================

(function () {
  "use strict";

  if (document.getElementById("nmxSyncUiBackdrop")) { return; } // already injected

  // ---------- STYLES ----------
  var style = document.createElement("style");
  style.textContent =
    ".nmx-sync-ui-backdrop{position:fixed;inset:0;z-index:999999;background:rgba(6,26,43,.6);display:none;align-items:center;justify-content:center;padding:20px;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
    ".nmx-sync-ui-backdrop.is-open{display:flex;}" +
    ".nmx-sync-ui-modal{width:100%;max-width:380px;padding:28px;border-radius:22px;background:#fff;box-shadow:0 30px 70px rgba(0,0,0,.3);position:relative;}" +
    ".nmx-sync-ui-close{position:absolute;top:14px;right:14px;width:30px;height:30px;border:0;border-radius:50%;background:#f1f5f9;color:#64748b;font-size:14px;cursor:pointer;}" +
    ".nmx-sync-ui-modal h3{margin:0 0 6px;font-size:19px;letter-spacing:-.02em;color:#102033;}" +
    ".nmx-sync-ui-modal p{margin:0 0 18px;font-size:12.5px;color:#6b7a8d;line-height:1.5;}" +
    ".nmx-sync-ui-modal input{width:100%;min-height:48px;padding:11px 14px;margin-bottom:14px;border:1.5px solid rgba(16,32,51,.14);border-radius:12px;font:700 15px/1 inherit;box-sizing:border-box;color:#102033;}" +
    ".nmx-sync-ui-modal input::placeholder{color:#94a3b8;}" +
    ".nmx-sync-ui-modal input:focus{outline:0;border-color:#24e0c7;}" +
    ".nmx-sync-ui-actions{display:flex;gap:8px;}" +
    ".nmx-sync-ui-actions button{flex:1;min-height:46px;border:0;border-radius:12px;cursor:pointer;font:900 13.5px/1 inherit;}" +
    ".nmx-sync-ui-cancel{background:#f1f5f9;color:#475569;}" +
    ".nmx-sync-ui-submit{background:linear-gradient(135deg,#3cebd8,#16cbb7);color:#061a2b;}" +
    ".nmx-sync-ui-submit:disabled{opacity:.6;cursor:default;}" +
    ".nmx-sync-ui-status{min-height:18px;margin-top:12px;font-size:12px;font-weight:700;}" +
    ".nmx-sync-ui-status.is-error{color:#b42318;}" +
    ".nmx-sync-ui-status.is-good{color:#137a50;}";
  document.head.appendChild(style);

  // ---------- MARKUP ----------
  var backdrop = document.createElement("div");
  backdrop.className = "nmx-sync-ui-backdrop";
  backdrop.id = "nmxSyncUiBackdrop";
  backdrop.innerHTML =
    '<div class="nmx-sync-ui-modal">' +
      '<button type="button" class="nmx-sync-ui-close" id="nmxSyncUiClose" aria-label="Close">✕</button>' +

      '<div id="nmxSyncUiStepEmail">' +
        '<h3 id="nmxSyncUiEmailHeading">Sync your account</h3>' +
        '<p id="nmxSyncUiEmailSub">We\'ll email you a 6-digit code to confirm it\'s you. This keeps your data with you across every device.</p>' +
        '<input type="email" id="nmxSyncUiEmailInput" placeholder="you@email.com" autocomplete="email">' +
        '<div class="nmx-sync-ui-actions">' +
          '<button type="button" class="nmx-sync-ui-cancel" id="nmxSyncUiCancel1">Cancel</button>' +
          '<button type="button" class="nmx-sync-ui-submit" id="nmxSyncUiSendCode">Send Code</button>' +
        '</div>' +
      '</div>' +

      '<div id="nmxSyncUiStepCode" style="display:none;">' +
        '<h3>Enter your code</h3>' +
        '<p>Check your email — the code expires in 10 minutes.</p>' +
        '<input type="text" id="nmxSyncUiCodeInput" placeholder="6-digit code" inputmode="numeric" maxlength="6">' +
        '<div class="nmx-sync-ui-actions">' +
          '<button type="button" class="nmx-sync-ui-cancel" id="nmxSyncUiBack">Back</button>' +
          '<button type="button" class="nmx-sync-ui-submit" id="nmxSyncUiVerify">Verify</button>' +
        '</div>' +
      '</div>' +

      '<div class="nmx-sync-ui-status" id="nmxSyncUiStatus"></div>' +
    '</div>';
  document.body.appendChild(backdrop);

  var stepEmail = document.getElementById("nmxSyncUiStepEmail");
  var stepCode = document.getElementById("nmxSyncUiStepCode");
  var emailHeading = document.getElementById("nmxSyncUiEmailHeading");
  var emailSub = document.getElementById("nmxSyncUiEmailSub");
  var emailInput = document.getElementById("nmxSyncUiEmailInput");
  var codeInput = document.getElementById("nmxSyncUiCodeInput");
  var statusEl = document.getElementById("nmxSyncUiStatus");
  var sendBtn = document.getElementById("nmxSyncUiSendCode");
  var verifyBtn = document.getElementById("nmxSyncUiVerify");

  var currentMode = { pro: false };

  function showStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "nmx-sync-ui-status" + (kind ? " is-" + kind : "");
  }

  function resetModal(opts) {
    currentMode = { pro: !!(opts && opts.pro) };

    if (currentMode.pro) {
      emailHeading.textContent = "Activate PRO";
      emailSub.textContent = "We'll email you a 6-digit code to confirm it's you and activate your PRO membership on this device.";
    } else {
      emailHeading.textContent = "Sync your account";
      emailSub.textContent = "We'll email you a 6-digit code to confirm it's you. This keeps your data with you across every device.";
    }

    stepEmail.style.display = "block";
    stepCode.style.display = "none";
    emailInput.value = "";
    codeInput.value = "";
    showStatus("");
    sendBtn.disabled = false;
    verifyBtn.disabled = false;
  }

  function open(opts) {
    resetModal(opts);
    backdrop.classList.add("is-open");
    setTimeout(function () { emailInput.focus(); }, 50);
  }

  function close() {
    backdrop.classList.remove("is-open");
  }

  document.getElementById("nmxSyncUiClose").addEventListener("click", close);
  document.getElementById("nmxSyncUiCancel1").addEventListener("click", close);
  document.getElementById("nmxSyncUiBack").addEventListener("click", function () {
    stepEmail.style.display = "block";
    stepCode.style.display = "none";
    showStatus("");
  });
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) { close(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && backdrop.classList.contains("is-open")) { close(); }
  });

  sendBtn.addEventListener("click", function () {
    var email = emailInput.value.trim();
    if (!email || email.indexOf("@") === -1) {
      showStatus("Enter a valid email.", "error");
      return;
    }
    if (!window.NextMoveSync) {
      showStatus("Sync isn't available on this page right now.", "error");
      return;
    }
    sendBtn.disabled = true;
    showStatus("Sending code…");

    window.NextMoveSync.login(email)
      .then(function (result) {
        sendBtn.disabled = false;
        if (!result || !result.success) {
          showStatus((result && result.error) || "Could not send code.", "error");
          return;
        }
        stepEmail.style.display = "none";
        stepCode.style.display = "block";
        showStatus("");
        codeInput.focus();
      })
      .catch(function () {
        sendBtn.disabled = false;
        showStatus("Something went wrong. Try again.", "error");
      });
  });

  verifyBtn.addEventListener("click", function () {
    var code = codeInput.value.trim();
    if (!code) {
      showStatus("Enter the code from your email.", "error");
      return;
    }
    if (!window.NextMoveSync) {
      showStatus("Sync isn't available on this page right now.", "error");
      return;
    }
    verifyBtn.disabled = true;
    showStatus("Verifying…");

    window.NextMoveSync.confirmLogin(code, { pro: currentMode.pro })
      .then(function (result) {
        verifyBtn.disabled = false;
        if (!result || !result.success) {
          showStatus((result && result.error) || "Incorrect code.", "error");
          return;
        }
        showStatus(currentMode.pro ? "PRO activated!" : "Synced!", "good");

        // Let any page listening know login just completed, so it
        // can immediately re-fetch its own synced data rather than
        // waiting for a refresh. detail.pro tells listeners which
        // flow just completed.
        window.dispatchEvent(new CustomEvent("nmx-sync-login", { detail: { pro: currentMode.pro } }));

        setTimeout(close, 700);
      })
      .catch(function () {
        verifyBtn.disabled = false;
        showStatus("Something went wrong. Try again.", "error");
      });
  });

  codeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { verifyBtn.click(); }
  });
  emailInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { sendBtn.click(); }
  });

  // Any element already on the page with data-nmx-sync-open opens
  // the modal in regular (non-PRO) mode.
  // data-nmx-sync-open-pro opens it in PRO activation mode — this
  // should ONLY ever be used on /pro-access, since PRO status is
  // proven by reaching that page (behind Squarespace's paywall),
  // not by anything this modal itself checks.
  document.addEventListener("click", function (e) {
    var proTrigger = e.target.closest ? e.target.closest("[data-nmx-sync-open-pro]") : null;
    if (proTrigger) { open({ pro: true }); return; }
    var trigger = e.target.closest ? e.target.closest("[data-nmx-sync-open]") : null;
    if (trigger) { open(); }
  });

  window.NextMoveSyncUI = { open: open, close: close };
})();
