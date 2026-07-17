/ ============================================================
// NextMoveAI – AI Financial Coach chat endpoint
// Deploy this on Vercel as: api/chat.js
// ============================================================

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
// own name (Dalo on the homepage and free preview, Veto on the
// unlimited page). Defaults to Dalo if not sent.
const botName =
typeof req.body.botName === "string" && req.body.botName.trim()
? req.body.botName.trim().slice(0, 30)
: "Dalo";

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
siteMap;

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

return res.status(200).json({ reply: reply || "Sorry, I didn't catch that — could you rephrase?" });

} catch (err) {
console.error("Chat handler error:", err);
return res.status(500).json({ error: "Something went wrong" });
}
}
