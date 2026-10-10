// NEXTMOVEAI — Daily Reminder Check
// -----------------------------------------------------------------
// File: api/dates/check-reminders.js
// Triggered once a day by Vercel Cron (vercel.json: "0 13 * * *",
// which is 9am Eastern in summer, 8am in winter).
//
// Sends ONE email per synced user per day, containing:
//   1. Important Dates reminders that are due today, and
//   2. (NEW 2026-10-10) their Payday plan from the Debt Freedom
//      Planner, on the morning of each payday: how much to set aside,
//      how much goes to their target debt, how much covers the other
//      minimums, and which payments are due before the next payday.
//   3. (NEW 2026-10-10) Debt due-date reminders, 3 days before each
//      debt's due day (set per debt on the Debt Freedom Planner).
//
// 2026-10-10 FIX: weekly, every-2-weeks and twice-a-month dates were
// never handled here (only monthly, quarterly and yearly), so those
// reminders went out at most once and then stopped. They now repeat
// exactly like the Important Dates page shows them.
//
// 2026-10-10 SAFER SAVE: after sending, this re-reads each user's
// row and only updates the "already sent" markers, so it can't
// overwrite something the user saved on the site while the job ran.
//
// Email goes through the same Google Apps Script mailer
// (type: "dateReminder"). The payday plan arrives as one extra
// reminder in the list, with its details in "notes", so the current
// Apps Script works unchanged. It also sends a "paydayPlan" object
// the Apps Script can use later for a nicer layout.
//
// Requires env vars (already set): SUPABASE_URL,
// SUPABASE_SERVICE_KEY, APPS_SCRIPT_URL, CRON_SECRET
// -----------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

const SITE = 'https://www.nextmoveai.ai';
const DUE_REMINDER_DAYS = 3;

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
  const todayStr = toDateStr(today);
  let remindersSent = 0;
  let paydayEmails = 0;
  let failures = 0;

  for (const user of users || []) {
    if (!user.email) continue;
    const tools = user.tools || {};

    // ---- 1. Important Dates reminders due today ----
    const dates = tools.dates && Array.isArray(tools.dates.entries) ? tools.dates.entries : [];
    const due = [];
    const sentMarks = {}; // entry id -> occurrence date string

    for (const entry of dates) {
      if (!entry || !entry.date || entry.reminderDays === undefined || entry.reminderDays === null) continue;
      if (Number(entry.reminderDays) < 0) continue; // "Don't send a reminder"

      const next = getNextOccurrence(entry, today);
      if (!next) continue;

      const diffDays = Math.round((next - today) / 86400000);
      const nextStr = toDateStr(next);

      // Fire once per occurrence (lastReminderSentFor guards against
      // double-sends if the job runs twice in a day).
      if (diffDays === Number(entry.reminderDays) && entry.lastReminderSentFor !== nextStr) {
        due.push({ title: entry.title, date: nextStr, category: entry.category, notes: entry.notes || '' });
        if (entry.id) sentMarks[entry.id] = nextStr;
      }
    }

    // ---- 2. Debt payday plan ----
    let paydayPlan = null;
    const payday = tools['debt-payday'];
    const paydaySent = tools['debt-payday-sent'] || {};
    const dueList = payday && Array.isArray(payday.dueDates) ? payday.dueDates : [];
    if (payday && payday.email && payday.plan && payday.nextPayday && paydaySent.lastSentFor !== todayStr) {
      const step = payday.frequency === 'weekly' ? 7 : 14;
      const next = nextByStep(payday.nextPayday, step, today);
      if (next && toDateStr(next) === todayStr) {
        // Payments due from today up to the day before the next payday
        const until = new Date(today); until.setUTCDate(until.getUTCDate() + step);
        const dueBeforeNext = dueList
          .map((d) => ({ name: d.name, minimum: d.minimum, date: nextDueDate(d.dueDay, today) }))
          .filter((d) => d.date && d.date < until)
          .sort((a, b) => a.date - b.date);
        paydayPlan = buildPaydayPlan(payday, todayStr, dueBeforeNext);
        due.unshift({ title: paydayPlan.title, date: todayStr, category: 'payday', notes: paydayPlan.text });
      }
    }

    // ---- 3. Debt due-date reminders (3 days before) ----
    const dueSentMarks = {};
    if (payday && payday.dueReminders !== false && dueList.length) {
      const already = paydaySent.dueSent || {};
      for (const d of dueList) {
        const date = nextDueDate(d.dueDay, today);
        if (!date || !d.id) continue;
        const diff = Math.round((date - today) / 86400000);
        const dateStr = toDateStr(date);
        if (diff === DUE_REMINDER_DAYS && already[d.id] !== dateStr) {
          const min = Number(d.minimum) > 0 ? ` Minimum payment: ${money(d.minimum)}.` : '';
          due.push({
            title: `${d.name} payment due ${prettyDate(date)}`,
            date: dateStr,
            category: 'bill',
            notes: `Your ${d.name} payment is due in ${DUE_REMINDER_DAYS} days.${min} Paying on time protects your credit and avoids late fees. ${SITE}/debt-plan`
          });
          dueSentMarks[d.id] = dateStr;
        }
      }
    }

    if (!due.length) continue;

    const ok = await sendReminderEmail(user.email, due, paydayPlan);
    if (!ok) { failures++; continue; } // markers not saved, so a re-run today would retry

    remindersSent += due.length - (paydayPlan ? 1 : 0);
    if (paydayPlan) paydayEmails++;

    // ---- Save "already sent" markers on a fresh copy of the row ----
    const { data: fresh } = await supabase
      .from('nma_users')
      .select('tools')
      .eq('email', user.email)
      .maybeSingle();
    const freshTools = (fresh && fresh.tools) || {};

    if (Object.keys(sentMarks).length && freshTools.dates && Array.isArray(freshTools.dates.entries)) {
      freshTools.dates.entries.forEach((e) => {
        if (e && e.id && sentMarks[e.id]) e.lastReminderSentFor = sentMarks[e.id];
      });
    }
    if (paydayPlan || Object.keys(dueSentMarks).length) {
      const prev = freshTools['debt-payday-sent'] || {};
      const dueSent = Object.assign({}, prev.dueSent || {}, dueSentMarks);
      freshTools['debt-payday-sent'] = {
        lastSentFor: paydayPlan ? todayStr : (prev.lastSentFor || null),
        dueSent
      };
    }

    await supabase.from('nma_users').update({ tools: freshTools }).eq('email', user.email);
  }

  return res.status(200).json({
    success: true,
    usersChecked: (users || []).length,
    remindersSent,
    paydayEmails,
    failures
  });
}

// ------------------------------------------------------------------

function buildPaydayPlan(payday, dateStr, dueBeforeNext) {
  const plan = payday.plan || {};
  const per = payday.perPaycheck || {};
  const total = Math.round(Number(per.total) || 0);
  const toTarget = Math.round((Number(per.extra) || 0) + (Number(per.targetMin) || 0));
  const otherMins = Math.round(Number(per.otherMins) || 0);
  const lines = [];

  lines.push(`Here's your debt plan for this paycheck:`);
  lines.push(`• Set aside ${money(total)} for debt.`);
  if (plan.target) {
    const apr = Number(plan.targetApr) > 0 ? ` (${trimRate(plan.targetApr)}% APR)` : '';
    lines.push(`• Send ${money(toTarget)} to ${plan.target}${apr}. It's your first target${plan.strategyLabel ? ` with the ${plan.strategyLabel} method` : ''}.`);
  }
  if (otherMins > 0) {
    lines.push(`• Keep ${money(otherMins)} for your other minimum payments so every account stays current.`);
  }
  if (dueBeforeNext && dueBeforeNext.length) {
    lines.push(`Due before your next payday:`);
    dueBeforeNext.forEach((d) => {
      lines.push(`• ${d.name}: ${prettyDate(d.date)}${Number(d.minimum) > 0 ? ` (${money(d.minimum)} minimum)` : ''}`);
    });
  }
  if (plan.debtFreeDate) {
    lines.push(`You're on track to be debt-free by ${plan.debtFreeDate}.`);
  }
  lines.push(`Changed your numbers? Update your plan: ${SITE}/debt-plan`);

  return {
    title: 'Payday: your debt plan for this week',
    date: dateStr,
    text: lines.join('\n'),
    setAside: total,
    target: plan.target || '',
    toTarget,
    otherMinimums: otherMins,
    debtFreeDate: plan.debtFreeDate || '',
    dueBeforeNext: (dueBeforeNext || []).map((d) => ({ name: d.name, date: toDateStr(d.date), minimum: d.minimum })),
    link: `${SITE}/debt-plan`
  };
}

function money(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}

// Next date (today or later) a debt is due, given its day of the
// month. Day 29–31 in a shorter month falls on that month's last day.
function nextDueDate(dueDay, today) {
  const day = Math.round(Number(dueDay));
  if (!(day >= 1 && day <= 31)) return null;
  for (let offset = 0; offset <= 1; offset++) {
    const y = today.getUTCFullYear() + Math.floor((today.getUTCMonth() + offset) / 12);
    const m = (today.getUTCMonth() + offset) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m, Math.min(day, last)));
    if (d >= today) return d;
  }
  return null;
}

function prettyDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function trimRate(r) {
  return Number(r).toFixed(2).replace(/\.?0+$/, '');
}

function startOfDayUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function nextByStep(dateStr, stepDays, today) {
  const next = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(next)) return null;
  let guard = 0;
  while (next < today && guard < 3000) {
    next.setUTCDate(next.getUTCDate() + stepDays);
    guard++;
  }
  return next;
}

// Mirrors getNextOccurrence() on the My Important Dates page, so the
// date someone sees on the page is the date their email is based on.
function getNextOccurrence(entry, today) {
  const base = new Date(entry.date + 'T00:00:00Z');
  if (isNaN(base)) return null;
  const rec = entry.recurrence;

  if (!rec || rec === 'none') {
    return base >= today ? base : null;
  }

  if (rec === 'weekly' || rec === 'biweekly') {
    return nextByStep(entry.date, rec === 'weekly' ? 7 : 14, today);
  }

  if (rec === 'semimonthly') {
    const d1 = Number(entry.semiMonthlyDay1);
    const d2 = Number(entry.semiMonthlyDay2);
    if (!d1 || !d2) return base >= today ? base : null;
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const candidates = [];
    for (let offset = 0; offset <= 1; offset++) {
      const cy = y + Math.floor((m + offset) / 12);
      const cm = (m + offset) % 12;
      const last = new Date(Date.UTC(cy, cm + 1, 0)).getUTCDate();
      candidates.push(new Date(Date.UTC(cy, cm, Math.min(d1, last))));
      candidates.push(new Date(Date.UTC(cy, cm, Math.min(d2, last))));
    }
    const upcoming = candidates.filter((d) => d >= today).sort((a, b) => a - b);
    return upcoming.length ? upcoming[0] : null;
  }

  const stepMonths = rec === 'yearly' ? 12 : rec === 'quarterly' ? 3 : rec === 'monthly' ? 1 : null;
  if (!stepMonths) return base >= today ? base : null;

  const next = new Date(base);
  let guard = 0;
  while (next < today && guard < 600) {
    next.setUTCMonth(next.getUTCMonth() + stepMonths);
    guard++;
  }
  return next;
}

async function sendReminderEmail(email, due, paydayPlan) {
  try {
    const r = await fetch(process.env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'dateReminder',
        email,
        reminders: due,
        paydayPlan: paydayPlan || null
      })
    });
    return r.ok;
  } catch (e) {
    console.error('reminder email failed for', email, e);
    return false;
  }
}
