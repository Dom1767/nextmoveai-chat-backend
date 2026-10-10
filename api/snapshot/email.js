// =========================================================
// POST /api/snapshot/email
// Body: { "nmxProToken": "<token>", "report": { subject, asOf, sections, footer } }
//
// Emails a member their "My Financial Snapshot" report (Avatar
// Dashboard V2.3). PRO only.
//
// Safety rules:
// • The PRO token is checked here with the same verifyProToken()
//   helper chat/TTS use. No valid token → nothing is sent.
// • The email ALWAYS goes to the address inside the PRO token (the
//   one verified at /pro-access). The page can't choose a recipient,
//   so this can't be used to email anyone else.
// • The report arrives as plain text pieces (titles, labels,
//   values). This file builds the email itself and escapes every
//   piece, so no HTML from the browser ends up in the email.
// • Nothing is stored. A short in-memory limit stops repeat sends.
//
// Sends through the same Google Apps Script mailer as the reminder
// job, with type "financialSnapshot" and a shared secret.
//
// Requires env vars: PRO_TOKEN_SECRET (already set), APPS_SCRIPT_URL
// (already set), SNAPSHOT_MAIL_SECRET (NEW — any long random string;
// put the same value in the Apps Script's Script Properties).
// =========================================================

import { verifyProToken } from "../_verifyProToken.js";

const SITE = "https://nextmoveai.ai";
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_COUNT = 3;
const recent = new Map(); // email -> [timestamps]

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeLink(href) {
  const h = clean(href, 300);
  return /^https:\/\/(www\.)?nextmoveai\.ai(\/[A-Za-z0-9\-._~/#?=&%]*)?$/.test(h) ? h : null;
}

// Turns whatever the browser sent into a small, known shape.
export function normalizeReport(r) {
  if (!r || typeof r !== "object" || !Array.isArray(r.sections)) return null;
  const sections = r.sections.slice(0, 12).map((s) => {
    if (!s || typeof s !== "object") return null;
    const title = clean(s.title, 120);
    const rows = (Array.isArray(s.rows) ? s.rows : []).slice(0, 16)
      .filter((x) => Array.isArray(x) && x.length >= 2)
      .map((x) => [clean(x[0], 120), clean(x[1], 160)])
      .filter((x) => x[0] || x[1]);
    const notes = (Array.isArray(s.notes) ? s.notes : []).slice(0, 4).map((n) => clean(n, 300)).filter(Boolean);
    const text = clean(s.text, 700);
    const link = s.link && typeof s.link === "object" ? { href: safeLink(s.link.href), label: clean(s.link.label, 60) } : null;
    if (!title || (!rows.length && !text)) return null;
    return { title, rows, notes, text, link: link && link.href && link.label ? link : null };
  }).filter(Boolean);
  if (!sections.length) return null;
  return {
    subject: clean(r.subject, 120) || "Your NextMoveAI financial snapshot",
    asOf: clean(r.asOf, 80),
    sections,
    footer: "Based on numbers you entered on NextMoveAI. Estimates, not financial advice, and not a bank statement or credit report."
  };
}

export function renderEmail(m) {
  const font = "font-family:Arial,Helvetica,sans-serif;";
  let html = `<!doctype html><html><body style="margin:0;padding:0;background:#f5f8fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f8fb;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;${font}color:#17304d;">
<tr><td style="padding:24px 26px 6px;">
<div style="font-size:16px;font-weight:bold;color:#0b1f3a;">NextMove<span style="color:#168f7a;">AI</span></div>
<h1 style="margin:12px 0 2px;font-size:22px;color:#0b1f3a;">Your financial snapshot</h1>
<p style="margin:0;color:#66788d;font-size:13px;">${esc(m.asOf)}</p>
</td></tr>`;
  let text = `Your NextMoveAI financial snapshot\n${m.asOf}\n`;
  for (const s of m.sections) {
    html += `<tr><td style="padding:14px 26px 0;"><div style="border-top:1px solid #e6edf3;padding-top:12px;">
<h2 style="margin:0 0 6px;font-size:15px;color:#0b1f3a;">${esc(s.title)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">`;
    text += `\n${s.title.toUpperCase()}\n`;
    for (const [label, value] of s.rows) {
      html += `<tr><td style="padding:3px 0;color:#4f6378;">${esc(label)}</td><td align="right" style="padding:3px 0;font-weight:bold;color:#17304d;">${esc(value)}</td></tr>`;
      text += `${label}: ${value}\n`;
    }
    html += `</table>`;
    if (s.text) { html += `<p style="margin:6px 0 0;font-size:13px;line-height:1.5;">${esc(s.text)}</p>`; text += `${s.text}\n`; }
    for (const n of s.notes) { html += `<p style="margin:4px 0 0;color:#7b8a9b;font-size:12px;line-height:1.45;">${esc(n)}</p>`; text += `(${n})\n`; }
    if (s.link) { html += `<p style="margin:8px 0 0;"><a href="${esc(s.link.href)}" style="color:#168f7a;font-weight:bold;font-size:13px;text-decoration:none;">${esc(s.link.label)} &rarr;</a></p>`; text += `${s.link.label}: ${s.link.href}\n`; }
    html += `</div></td></tr>`;
  }
  html += `<tr><td style="padding:18px 26px 24px;"><div style="border-top:1px solid #e6edf3;padding-top:12px;color:#7b8a9b;font-size:11.5px;line-height:1.5;">
${esc(m.footer)}<br>You asked for this email from your My NextMove dashboard. We don't keep a copy.<br>
<a href="${SITE}/avatar-dashboard#financial-snapshot" style="color:#168f7a;">Open My NextMove</a></div></td></tr>
</table></td></tr></table></body></html>`;
  text += `\n${m.footer}\nYou asked for this email from your My NextMove dashboard. We don't keep a copy.\n${SITE}/avatar-dashboard\n`;
  return { html, text };
}

// Only successful sends count, so a mailer hiccup doesn't lock anyone out.
function rateLimited(email) {
  const now = Date.now();
  const list = (recent.get(email) || []).filter((t) => now - t < LIMIT_WINDOW_MS);
  recent.set(email, list);
  return list.length >= LIMIT_COUNT;
}
function recordSend(email) {
  const list = recent.get(email) || [];
  list.push(Date.now());
  recent.set(email, list);
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method" });

  const body = req.body || {};
  const who = verifyProToken(body.nmxProToken);
  if (!who) return res.status(401).json({ ok: false, error: "expired" });
  const email = String(who).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(409).json({ ok: false, error: "no-email" });

  const report = normalizeReport(body.report);
  if (!report) return res.status(400).json({ ok: false, error: "empty" });

  if (!process.env.APPS_SCRIPT_URL || !process.env.SNAPSHOT_MAIL_SECRET) {
    return res.status(503).json({ ok: false, error: "not-configured" });
  }
  if (rateLimited(email)) return res.status(429).json({ ok: false, error: "too-many" });

  const { html, text } = renderEmail(report);
  try {
    const r = await fetch(process.env.APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "financialSnapshot",
        secret: process.env.SNAPSHOT_MAIL_SECRET,
        email,
        subject: report.subject,
        html,
        text
      })
    });
    const out = await r.json().catch(() => null);
    if (!r.ok || !out || out.ok !== true) {
      console.error("snapshot email: mailer said", r.status, out);
      return res.status(502).json({ ok: false, error: "mailer" });
    }
    recordSend(email);
    return res.status(200).json({ ok: true, sentTo: email });
  } catch (e) {
    console.error("snapshot email failed", e);
    return res.status(502).json({ ok: false, error: "mailer" });
  }
}
