// NEXTMOVEAI — Daily Date Reminder Check
// -----------------------------------------------------------------
// Triggered once a day by Vercel Cron (see vercel.json at repo root).
// Scans every synced user's "dates" tool data, finds any reminder
// due *today*, and sends one summary email per user via the same
// Google Apps Script mailer already used for sync codes and email
// capture.
//
// SETUP CHECKLIST:
// 1. Add this file to your Dom1767/nextmoveai-chat-backend repo at
//    api/dates/check-reminders.js
// 2. Add a vercel.json at the repo root (see vercel.json in this
//    delivery) with the cron schedule.
// 3. Add a new Vercel environment variable: CRON_SECRET
//    (any random string — e.g. generate one at random.org or with
//    `openssl rand -hex 32`). Vercel automatically sends this back
//    as "Authorization: Bearer <CRON_SECRET>" when it invokes a
//    cron job, which is what protects this endpoint from randoms
//    hitting the URL and spamming emails.
// 4. Add the handleDateReminder branch to your Google Apps Script
//    (see apps-script-date-reminder-addition.js in this delivery).
// 5. Redeploy the Apps Script as a new version (same URL).
// 6. Push to GitHub — Vercel will pick up the new route and the
//    cron schedule automatically.
// -----------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: users, error } = await supabase
    .from('nma_users')
    .select('email, tools');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const today = startOfDayUTC(new Date());
  let remindersSent = 0;
  const rowsToUpdate = [];

  for (const user of users || []) {
    const dates = user.tools && user.tools.dates && Array.isArray(user.tools.dates.entries)
      ? user.tools.dates.entries
      : [];
    if (!dates.length) continue;

    const due = [];
    let changed = false;

    for (const entry of dates) {
      if (!entry.date || entry.reminderDays === undefined || entry.reminderDays === null) continue;
      if (Number(entry.reminderDays) < 0) continue; // "Don't remind me"

      const next = getNextOccurrence(entry, today);
      if (!next) continue;

      const diffDays = Math.round((next - today) / 86400000);
      const nextStr = toDateStr(next);

      // Only fire once per occurrence — lastReminderSentFor guards
      // against double-sends if the cron runs more than once on the
      // same day, or if diffDays happens to match on two separate
      // days due to a manual date edit.
      if (diffDays === Number(entry.reminderDays) && entry.lastReminderSentFor !== nextStr) {
        due.push({ title: entry.title, date: nextStr, category: entry.category, notes: entry.notes || '' });
        entry.lastReminderSentFor = nextStr;
        changed = true;
      }
    }

    if (due.length) {
      await sendReminderEmail(user.email, due);
      remindersSent += due.length;
    }

    if (changed) {
      rowsToUpdate.push({ email: user.email, tools: user.tools });
    }
  }

  // Persist lastReminderSentFor back to Supabase so tomorrow's run
  // doesn't re-send the same reminder.
  for (const row of rowsToUpdate) {
    await supabase.from('nma_users').update({ tools: row.tools }).eq('email', row.email);
  }

  return res.status(200).json({
    success: true,
    usersChecked: (users || []).length,
    remindersSent
  });
}

function startOfDayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// Mirrors the client-side getNextOccurrence() in the My Important
// Dates page, so "next occurrence" always agrees between what the
// user sees on-page and what triggers their email.
function getNextOccurrence(entry, today) {
  const base = new Date(entry.date + 'T00:00:00Z');
  if (!entry.recurrence || entry.recurrence === 'none') {
    return base >= today ? base : null;
  }
  const stepMonths = entry.recurrence === 'yearly' ? 12
    : entry.recurrence === 'quarterly' ? 3
    : entry.recurrence === 'monthly' ? 1
    : null;
  if (!stepMonths) return base >= today ? base : null;

  let next = new Date(base);
  let guard = 0;
  while (next < today && guard < 600) {
    next.setUTCMonth(next.getUTCMonth() + stepMonths);
    guard++;
  }
  return next;
}

async function sendReminderEmail(email, due) {
  await fetch(process.env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'dateReminder',
      email,
      reminders: due
    })
  });
}
