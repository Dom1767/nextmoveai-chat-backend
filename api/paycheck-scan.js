// ============================================================
// NextMoveAI – Paycheck Scan endpoint
// Deploy this on Vercel as: api/paycheck-scan.js
//
// Reads a photo or PDF of a pay stub using Claude's vision, and
// returns structured JSON (gross pay, take-home pay, taxes,
// benefits/deductions, overtime, etc). The frontend then uses
// this to auto-fill the existing Paycheck GPS gross/take-home
// fields on the Spending page — all the downstream math (budget
// comparison, savings goal, opportunity finder) is untouched and
// keeps working exactly as it did with manual entry.
//
// PRIVACY: the uploaded image/PDF is never written to disk, a
// database, or any persistent storage anywhere in this handler.
// It exists only in memory for the duration of this single
// request and is discarded the moment the function returns.
// Nothing here saves the original document unless a future
// change explicitly adds that (with the user's consent).
//
// Requires: ANTHROPIC_API_KEY (already set for api/chat.js).
// ============================================================

const MAX_BASE64_LENGTH = 20_000_000; // ~15MB raw file, base64-inflated
const ALLOWED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

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
    const { imageBase64, mediaType } = req.body || {};

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    if (!mediaType || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      return res.status(400).json({ error: "Unsupported file type. Please upload a JPG, PNG, or PDF." });
    }

    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return res.status(413).json({ error: "File is too large. Please use a smaller photo or PDF." });
    }

    const contentBlock =
      mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: mediaType, data: imageBase64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } };

    const systemPrompt =
      "You are a precise document-reading assistant extracting data from a " +
      "US paycheck / pay stub image or PDF. Return ONLY valid JSON, with no " +
      "markdown formatting, no code fences, and no commentary — just the raw " +
      "JSON object, matching exactly this schema:\n" +
      "{\n" +
      '  "grossPay": number|null,\n' +
      '  "netPay": number|null,\n' +
      '  "payPeriod": "weekly"|"biweekly"|"semimonthly"|"monthly"|null,\n' +
      '  "payDate": string|null,\n' +
      '  "federalTax": number|null,\n' +
      '  "stateTax": number|null,\n' +
      '  "localTax": number|null,\n' +
      '  "socialSecurity": number|null,\n' +
      '  "medicare": number|null,\n' +
      '  "healthInsurance": number|null,\n' +
      '  "retirement401k": number|null,\n' +
      '  "unionDues": number|null,\n' +
      '  "overtimePay": number|null,\n' +
      '  "otherDeductions": number|null,\n' +
      '  "confidence": "high"|"medium"|"low"\n' +
      "}\n\n" +
      "Use null for any field you cannot find on the document or are not " +
      "reasonably confident about — never guess, estimate, or invent a " +
      "number that isn't actually shown. All dollar amounts must be plain " +
      "numbers only (no currency symbols, no commas). Set confidence to " +
      "\"low\" if the image is blurry, cut off, or you had to infer several " +
      "fields; \"high\" only if the document is clear and most fields were " +
      "directly readable.";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "Extract the paycheck data from this document as JSON matching the schema exactly." }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "AI service error. Please try again." });
    }

    const data = await response.json();

    const textBlock = (data.content || []).find(function (block) {
      return block.type === "text";
    });

    const raw = textBlock ? textBlock.text.trim() : "";

    let parsed;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Could not parse paycheck JSON:", raw);
      return res.status(502).json({
        error: "Couldn't read that clearly — try a clearer photo, or enter your paycheck manually."
      });
    }

    if (!parsed || (parsed.grossPay == null && parsed.netPay == null)) {
      return res.status(422).json({
        error: "Couldn't find paycheck numbers on that document — try a clearer photo, or enter your paycheck manually."
      });
    }

    // Nothing about the uploaded file is persisted below this line —
    // only the extracted numeric fields are returned to the client.
    return res.status(200).json({ success: true, data: parsed });

  } catch (err) {
    console.error("Paycheck scan error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
