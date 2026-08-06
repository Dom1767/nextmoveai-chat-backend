// =========================================================
// api/tts.js — NextMoveAI Text-to-Speech route
//
// Add this file to your existing Vercel project (the same one
// that already has api/chat.js and api/market.js), at the path:
//   api/tts.js
//
// It converts Veto's text responses into spoken audio using
// OpenAI's TTS API and streams the audio back to the browser.
//
// SETUP REQUIRED IN VERCEL:
// 1. Go to your project → Settings → Environment Variables
// 2. Add a new variable: OPENAI_API_KEY = <your OpenAI API key>
//    (Get one at platform.openai.com — separate account/key from
//    your Anthropic key, since this uses OpenAI's TTS model.)
// 3. Redeploy after adding the variable.
//
// COST: OpenAI TTS is billed per character of input text, at a
// low per-character rate — at NextMoveAI's current chat volume
// this should run to a few dollars a month at most. Check
// platform.openai.com/usage to monitor actual spend.
// =========================================================

export default async function handler(req, res) {
  // CORS — mirror whatever your existing api/chat.js does. If
  // chat.js sets specific allowed origins via an ALLOWED_ORIGIN
  // env var, copy that same pattern here instead of the wildcard
  // below.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { text } = req.body || {};

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "No text provided." });
      return;
    }

    const safeText = text.slice(0, 3500);

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      res.status(500).json({ error: "Voice service is not configured yet." });
      return;
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: safeText,
        response_format: "mp3"
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(function () { return ""; });
      console.error("OpenAI TTS error:", openaiResponse.status, errorText);
      res.status(502).json({ error: "Voice service is temporarily unavailable." });
      return;
    }

    const audioBuffer = await openaiResponse.arrayBuffer();

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(audioBuffer));
  } catch (error) {
    console.error("TTS route error:", error);
    res.status(500).json({ error: "Something went wrong generating audio." });
  }
}
