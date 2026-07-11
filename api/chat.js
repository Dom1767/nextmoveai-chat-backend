// ============================================================
// NextMoveAI — AI Financial Coach chat endpoint
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

    const systemPrompt =
      "You are the NextMoveAI Coach, a friendly, encouraging assistant " +
      "embedded on the NextMoveAI website. You help people understand " +
      "budgeting, saving, debt, and general financial concepts in " +
      "plain, simple language. Keep replies short — 2-4 sentences, " +
      "conversational, no long lists unless asked. You are NOT a " +
      "licensed financial advisor and must not give specific " +
      "investment, tax, or legal advice, or recommend specific " +
      "financial products. For anything requiring licensed advice, " +
      "gently suggest they speak with a qualified professional. " +
      "Never claim to access the user's real account or bank data — " +
      "you only know what they tell you in the conversation.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        system: systemPrompt,
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
