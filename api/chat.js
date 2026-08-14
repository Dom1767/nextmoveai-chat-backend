// ============================================================
// NextMoveAI – AI Financial Coach chat endpoint
// Deploy this on Vercel as: api/chat.js
//
// UPDATED: now verifies the PRO token sent from the frontend as
// `nmxProToken` (minted by /pro-access via api/issue-pro-token.js)
// instead of trusting any client-sent "isPro" flag. `isPro` below
// is the real, server-verified value.
//
// IMPORTANT CAVEAT: this file does not currently enforce a free-
// question limit at all — that has only ever lived client-side in
// the homepage widget's JS, which anyone calling this endpoint
// directly could already bypass regardless of PRO status. `isPro`
// is wired in and ready to use, but actually rate-limiting requests
// server-side (e.g. tracking a per-person question count in
// Supabase) is separate follow-up work, not part of this patch.
// ============================================================

const { verifyProToken } = require("./_verifyProToken");

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
      "GUIDANCE FOR DIRECTING PEOPLE: when someone's question " +
      "matches one of these tools, tell them in one short sentence " +
      "and name the page (e.g. \"You can check that on the Plan " +
      "page\"). If they haven't mentioned checking their Financial " +
      "Health Score yet and seem new, it's often the natural first " +
      "step to suggest. Don't list multiple pages unless asked – " +
      "recommend the single most relevant one for what they asked.";

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

    const fullSystemPrompt = systemPrompt + contextBlock;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
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

    // isPro is now included in the response so the frontend can, if
    // it wants, trust the server's verdict over its own local check.
    return res.status(200).json({
      reply: reply || "Sorry, I didn't catch that — could you rephrase?",
      isPro: isPro
    });

  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
}
