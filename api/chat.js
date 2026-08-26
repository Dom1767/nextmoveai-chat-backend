// ============================================================
// NextMoveAI – AI Financial Coach chat endpoint
// Deploy this on Vercel as: api/chat.js
//
// UPDATED (this version):
// 1. Verifies the PRO token sent from the frontend as `nmxProToken`
//    (minted by /pro-access via api/issue-pro-token.js) instead of
//    trusting any client-sent "isPro" flag.
// 2. Enforces the free-question limit SERVER-SIDE for the first
//    time, using a Supabase table (chat_usage) keyed by a stable
//    anonymous device ID the frontend now sends as `nmxDeviceId`.
//    Previously this limit only existed in the widget's own JS,
//    which anyone calling this endpoint directly could bypass —
//    including burning your Anthropic API budget for free. Blocked
//    requests now never reach the Anthropic call at all.
// 3. GUIDANCE FOR DIRECTING PEOPLE is now a mandatory linking rule
//    instead of a soft suggestion — any time Veto names a page from
//    the site map, it must format it as a markdown link, every time,
//    not just when actively recommending a next step. Previously
//    this was inconsistent because the instruction only said "name
//    the page," which the model sometimes did as plain text.
// 4. NEW: optional calendar-intent extraction. When the frontend
//    sends intentMode: "calendar" (used by the "Hey Veto" voice
//    command flow — anything said after the wake phrase gets sent
//    here), this endpoint asks Claude to return a single JSON
//    object instead of a plain reply: a short conversational
//    confirmation sentence plus a calendarIntent object
//    (title/date/recurrence/category) the frontend can offer as
//    "Add to calendar?" before writing anything. The JSON is parsed
//    and validated server-side (parseCalendarIntentReply) — a
//    malformed or low-confidence response always degrades to
//    "nothing recognized" rather than risking a bad date getting
//    saved. Normal chat requests (no intentMode, or any other
//    value) are completely unaffected by this.
//
// Requires (in addition to ANTHROPIC_API_KEY, already set):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — already set in this project
//   PRO_TOKEN_SECRET — already set, used by _verifyProToken
//
// Requires the "chat_usage" table — see supabase-chat-usage-table.sql
// Requires the @supabase/supabase-js package as a dependency.
// ============================================================

import { verifyProToken } from "./_verifyProToken.js";
import { createClient } from "@supabase/supabase-js";

const FREE_QUESTION_LIMIT = 4;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Looks up how many free questions this device has already used.
// Fails OPEN (allows the request) if Supabase itself has a problem —
// a DB hiccup should never be the reason a legitimate free user gets
// blocked, and worst case is a handful of extra free questions.
async function getUsage(deviceId) {
  if (!deviceId) return { count: 0 };

  const { data, error } = await supabase
    .from("chat_usage")
    .select("question_count")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("Supabase usage lookup error:", error);
    return { count: 0 };
  }

  return { count: data ? data.question_count : 0 };
}

async function incrementUsage(deviceId, currentCount) {
  if (!deviceId) return;

  const { error } = await supabase
    .from("chat_usage")
    .upsert(
      {
        device_id: deviceId,
        question_count: currentCount + 1,
        last_seen: new Date().toISOString()
      },
      { onConflict: "device_id" }
    );

  if (error) {
    console.error("Supabase usage increment error:", error);
  }
}

// ============================================================
// CALENDAR INTENT PARSING
//
// In calendar-intent mode, Claude is instructed to return ONLY a
// JSON object (see calendarInstructionsBlock below) instead of its
// usual free-text reply. This function turns that raw text into a
// safe { reply, calendarIntent } pair — every field is validated,
// and anything that doesn't clearly qualify (missing/malformed
// date, missing title, unparseable JSON, recognized left false)
// degrades to calendarIntent.recognized = false rather than being
// trusted. The frontend only offers "Add to calendar" when
// recognized is true, so this is the one place that decides whether
// something is confident enough to reach that screen at all.
// ============================================================

const VALID_RECURRENCES = new Set([
  "none",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "yearly",
  "semimonthly"
]);

const VALID_CATEGORIES = new Set([
  "bill",
  "birthday",
  "payday",
  "appointment",
  "other"
]);

function parseCalendarIntentReply(rawText) {
  const fallback = {
    reply: "Sorry, I didn't catch that clearly — could you try again?",
    calendarIntent: { recognized: false }
  };

  if (!rawText) return fallback;

  // Strip markdown code fences in case the model wraps the JSON
  // anyway, despite being told not to.
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Not valid JSON at all — treat the raw text as a plain reply
    // with nothing recognized, rather than failing the request.
    return {
      reply: rawText.trim().slice(0, 600) || fallback.reply,
      calendarIntent: { recognized: false }
    };
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim().slice(0, 600)
      : fallback.reply;

  const rawIntent =
    parsed.calendarIntent && typeof parsed.calendarIntent === "object"
      ? parsed.calendarIntent
      : {};

  const dateOk =
    typeof rawIntent.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawIntent.date);

  const titleOk =
    typeof rawIntent.title === "string" && rawIntent.title.trim().length > 0;

  const recognized = !!rawIntent.recognized && dateOk && titleOk;

  if (!recognized) {
    return { reply, calendarIntent: { recognized: false } };
  }

  const recurrence = VALID_RECURRENCES.has(rawIntent.recurrence)
    ? rawIntent.recurrence
    : "none";

  const category = VALID_CATEGORIES.has(rawIntent.category)
    ? rawIntent.category
    : "other";

  return {
    reply,
    calendarIntent: {
      recognized: true,
      title: rawIntent.title.trim().slice(0, 80),
      date: rawIntent.date,
      recurrence,
      semiMonthlyDay1: Number.isInteger(rawIntent.semiMonthlyDay1)
        ? rawIntent.semiMonthlyDay1
        : null,
      semiMonthlyDay2: Number.isInteger(rawIntent.semiMonthlyDay2)
        ? rawIntent.semiMonthlyDay2
        : null,
      category
    }
  };
}

export default async function handler(req, res) {

  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Server not configured" });
  }

  try {

    const { messages } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }

    const trimmed = messages.slice(-12);

    // Real, server-verified PRO status — replaces trusting any
    // client-sent flag. proEmail is the verified member's email if
    // the token is valid and not expired, or null otherwise.
    const proEmail = verifyProToken(req.body.nmxProToken);
    const isPro = !!proEmail;

    // Stable anonymous ID the frontend generates once and stores in
    // localStorage, sent with every request. Used only to enforce
    // the free-question limit — never tied to any personal data.
    const deviceId =
      typeof req.body.nmxDeviceId === "string"
        ? req.body.nmxDeviceId.slice(0, 100)
        : null;

    let usage = { count: 0 };

    if (!isPro) {
      usage = await getUsage(deviceId);
      if (usage.count >= FREE_QUESTION_LIMIT) {
        return res.status(403).json({
          error: "free_limit_reached",
          message: "You've used your free questions. Upgrade to Veto PRO for unlimited access."
        });
      }
    }

    // Optional: "Hey Veto" voice commands send intentMode: "calendar"
    // so this endpoint can attempt to extract a calendar/reminder
    // intent alongside its normal reply, instead of just chatting.
    // Any other value, or no value at all, leaves everything below
    // exactly as it was.
    const intentMode =
      typeof req.body.intentMode === "string" ? req.body.intentMode.slice(0, 40) : "";
    const isCalendarIntent = intentMode === "calendar";

    const siteMap =
      "SITE MAP – pages on nextmoveai.ai you can direct people to:\n" +
      "- Home (/) – the main landing page: intro to NextMoveAI, " +
      "overview of the Review → Spend → Plan → Grow journey.\n" +
      "- Score (/check-your-score) – the Financial Health Review. " +
      "Users enter their numbers and get a live 0-100 Financial " +
      "Health Score with a breakdown. This is the best starting " +
      "point for anyone who hasn't used the site yet.\n" +
      "- Spending (/spending) – Paycheck GPS. Users connect their " +
      "paycheck (gross pay, take-home pay, pay schedule) to see " +
      "spending patterns, run a Spending Review, Budget Comparison, " +
      "Savings Mission, and view their Money Receipt.\n" +
      "- Plan (/plan) – the Planning Financial Blueprint. Users " +
      "enter monthly income and expenses to get a Recommended " +
      "Priority, emergency fund coverage, debt timeline, and a " +
      "connected 30/60/90-day roadmap (Financial Foundation, Your " +
      "Recommended Priority, Budget Position, Emergency Protection, " +
      "Divide Your Available Money).\n" +
      "- Grow (/grow) – the Growth Command Center. Users enter " +
      "current savings, monthly contribution, and timeline to see " +
      "Growth Readiness, Savings Coverage, estimated growth, and " +
      "get a personalized Growth Blueprint.\n" +
      "- Wealth Lab (/wealth-lab#investment-gps) – Investment GPS. " +
      "Users manually track their investment portfolio (holdings, " +
      "shares, cost basis), see an Investment Readiness Score, " +
      "portfolio allocation, and a wealth projection based on " +
      "contributions and timeline.\n" +
      "- AI Preview (/ai-preview) – a dedicated page for asking you " +
      "questions directly, organized by category (Review, Spending, " +
      "Planning, Growth). This is the page the person may already " +
      "be on right now.\n" +
      "\n" +
      "GUIDANCE FOR DIRECTING PEOPLE — MANDATORY LINKING RULE: " +
      "whenever you reference ANY page from this site map by name, " +
      "in ANY sentence — whether you're actively recommending it or " +
      "just mentioning it in passing — you MUST format that " +
      "reference as a markdown link using the exact label and URL " +
      "shown above. This applies every single time, with no " +
      "exceptions. Do not write a page name as plain text. Correct: " +
      "\"You can check that on the [Plan page](/plan).\" Incorrect: " +
      "\"You can check that on the Plan page.\" If they haven't " +
      "mentioned checking their Financial Health Score yet and seem " +
      "new, it's often the natural first step to suggest. Don't " +
      "list multiple pages unless asked – recommend the single most " +
      "relevant one for what they asked, but still link it.";

    // Which persona name to use – each page on the site sends its
    // own name (Veto on the homepage and free preview, Veto on the
    // unlimited page). Defaults to Veto if not sent.
    const botName =
      typeof req.body.botName === "string" && req.body.botName.trim()
        ? req.body.botName.trim().slice(0, 30)
        : "Veto";

    // NEW: pull in the tool-completion flags the frontend sends via
    // getUserProfile(). Everything here is optional/defensive since
    // older pages or a stripped-down embed might not send it.
    const userProfile =
      req.body.userProfile && typeof req.body.userProfile === "object"
        ? req.body.userProfile
        : {};

    const TOOL_LINKS = {
      score: { label: "the Score page", url: "/check-your-score" },
      spending: { label: "the Spending page", url: "/spending" },
      plan: { label: "the Plan page", url: "/plan" },
      grow: { label: "the Grow page", url: "/grow" },
      invest: { label: "the Wealth Lab", url: "/wealth-lab#investment-gps" }
    };

    // Build a short list of which tools this specific person has NOT
    // used yet, based on the flags the frontend already computes from
    // their saved localStorage data (hasScore, hasSpendingData, etc.).
    // Order matters: Score first since it's the recommended starting
    // point, matching the guidance already given in siteMap above.
    var unfinishedTools = [];
    if (userProfile.hasScore === false) unfinishedTools.push("score");
    if (userProfile.hasSpendingData === false) unfinishedTools.push("spending");
    if (userProfile.hasPlan === false) unfinishedTools.push("plan");
    if (userProfile.hasGrowData === false) unfinishedTools.push("grow");
    if (userProfile.hasInvestData === false) unfinishedTools.push("invest");

    let toolNudgeBlock = "";

    if (unfinishedTools.length > 0) {
      var toolLines = unfinishedTools
        .map(function (key) {
          var t = TOOL_LINKS[key];
          return "- " + key + ": " + t.label + " (" + t.url + ")";
        })
        .join("\n");

      toolNudgeBlock =
        "\n\nTOOLS THIS PERSON HASN'T USED YET (based on their saved " +
        "data, or lack of it):\n" + toolLines + "\n\n" +
        "GUIDANCE FOR SUGGESTING THESE: only bring one of these up when " +
        "it is genuinely relevant to what the person just asked — for " +
        "example, if they ask about their financial situation broadly " +
        "and they haven't done their Score yet, suggesting the Score " +
        "page is the natural next step. Do NOT mention an unfinished " +
        "tool in every reply, and do NOT suggest a tool that doesn't " +
        "fit the conversation just because it's on this list (e.g. " +
        "don't push Investing on someone asking about debt payoff). " +
        "When you do suggest one, recommend at most ONE, and format it " +
        "as a markdown link exactly like this: [the Score page]" +
        "(/check-your-score) — using the exact label and URL from the " +
        "list above so the site can turn it into a clickable link.";
    }

    const systemPrompt =
      "You are " + botName + ", the friendly, encouraging AI coach " +
      "built into the NextMoveAI website. You help people understand " +
      "budgeting, saving, debt, and general financial concepts in " +
      "plain, simple language, AND you help them navigate the site " +
      "itself – pointing them to the right page or tool for what " +
      "they're trying to do. Keep replies short – 2-4 sentences, " +
      "conversational, no long lists unless asked. You are NOT a " +
      "licensed financial advisor and must not give specific " +
      "investment, tax, or legal advice, or recommend specific " +
      "financial products. For anything requiring licensed advice, " +
      "gently suggest they speak with a qualified professional. " +
      "Never claim to access the user's real account or bank data " +
      "unless it has been explicitly included below as connected " +
      "context – if no context is provided, you only know what the " +
      "person tells you in the conversation.\n\n" +
      siteMap +
      toolNudgeBlock;

    // Optional extra context sent from the front end: which
    // category the person selected (Review/Spending/Planning/
    // Growth) and, if they explicitly connected it, their saved
    // Financial Health Review numbers. Both are plain strings –
    // never trust or invent data that wasn't actually sent.
    const category =
      typeof req.body.category === "string" ? req.body.category.slice(0, 40) : "";

    const connectedReview =
      typeof req.body.connectedReview === "string"
        ? req.body.connectedReview.slice(0, 2500)
        : "";

    let contextBlock = "";

    if (category) {
      contextBlock +=
        "\n\nThe person selected the \"" + category + "\" category " +
        "before asking this question – lean your answer toward that " +
        "area unless the question clearly points elsewhere.";
    }

    if (connectedReview) {
      contextBlock +=
        "\n\nThe person has connected their saved Financial Health " +
        "Review. Here is that data exactly as provided – you may " +
        "reference it directly:\n" + connectedReview;
    }

    // NEW: if the person HAS a saved score, let Veto reference the
    // actual number naturally (this was already being sent by the
    // frontend as part of userProfile but never surfaced before).
    if (typeof userProfile.scoreValue === "number") {
      contextBlock +=
        "\n\nThe person's current Financial Health Score is " +
        userProfile.scoreValue + "/100. You may reference this " +
        "directly if relevant to their question.";
    }

    // NEW: calendar-intent mode instructions. Only added when the
    // frontend explicitly requests it — everything above (site map,
    // tool nudges, normal persona instructions) still applies as-is,
    // this just adds an additional, very specific output-format
    // requirement on top for this one request.
    let calendarInstructionsBlock = "";

    if (isCalendarIntent) {
      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const todayLabel = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });

      calendarInstructionsBlock =
        "\n\nCALENDAR INTENT MODE — this message came from a voice " +
        "command starting with \"Hey Veto\"; what follows is " +
        "everything the person said after that. Today's date is " +
        todayLabel + " (" + todayIso + "). Try to extract a single " +
        "calendar or reminder event from what they said: a title and " +
        "a date, and optionally a recurrence pattern.\n\n" +
        "Resolve relative dates (\"tomorrow\", \"next Friday\", \"in " +
        "3 months\") against today's date above. If only a month and " +
        "day are given with no year, and that date has already " +
        "passed this year, use next year instead.\n\n" +
        "Respond with ONLY a single JSON object — no markdown code " +
        "fences, no text before or after it, nothing else. Exact " +
        "shape:\n" +
        "{\n" +
        "  \"reply\": \"<a short, warm confirmation question, e.g. " +
        "'I've got it: Car insurance — September 12. Add it to your " +
        "calendar?' — or, if you couldn't confidently identify a " +
        "title and date, a brief clarifying question instead>\",\n" +
        "  \"calendarIntent\": {\n" +
        "    \"recognized\": true or false,\n" +
        "    \"title\": \"<short event title, 3-6 words>\",\n" +
        "    \"date\": \"<YYYY-MM-DD>\",\n" +
        "    \"recurrence\": \"none\" | \"weekly\" | \"biweekly\" | " +
        "\"monthly\" | \"quarterly\" | \"yearly\" | \"semimonthly\",\n" +
        "    \"semiMonthlyDay1\": <day number 1-31, or null>,\n" +
        "    \"semiMonthlyDay2\": <day number 1-31, or null>,\n" +
        "    \"category\": \"bill\" | \"birthday\" | \"payday\" | " +
        "\"appointment\" | \"other\"\n" +
        "  }\n" +
        "}\n\n" +
        "Set recognized to false, and leave title/date out, if you " +
        "cannot confidently identify BOTH an event and a specific " +
        "date from what was said — never guess a date. Do not wrap " +
        "the JSON in markdown formatting or add any commentary " +
        "outside the JSON object itself.";
    }

    const fullSystemPrompt = systemPrompt + contextBlock + calendarInstructionsBlock;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: isCalendarIntent ? 500 : 400,
        system: fullSystemPrompt,
        messages: trimmed
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "AI service error" });
    }

    const data = await response.json();

    const reply = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    // Only count this toward the free limit on a successful reply —
    // a failed Anthropic call shouldn't cost the person a question.
    if (!isPro) {
      await incrementUsage(deviceId, usage.count);
    }

    if (isCalendarIntent) {
      const { reply: parsedReply, calendarIntent } = parseCalendarIntentReply(reply);
      return res.status(200).json({
        reply: parsedReply,
        calendarIntent,
        isPro: isPro
      });
    }

    return res.status(200).json({
      reply: reply || "Sorry, I didn't catch that — could you rephrase?",
      isPro: isPro
    });

  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
