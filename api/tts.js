// =========================================================
// api/tts.js — NextMoveAI Text-to-Speech route
//
// UPDATED (this version):
// 1. PRO-gates voice generation server-side for the first time.
//    Previously this endpoint had ZERO limit — anyone could
//    generate unlimited free audio by calling it directly,
//    regardless of PRO status. Now:
//      - Verifies the PRO token sent as `nmxProToken` (same
//        pattern as api/chat.js) instead of trusting any
//        client-sent flag.
//      - Free (non-PRO) visitors get ONE successful generation
//        ever, tracked server-side in a Supabase table
//        (tts_usage) keyed by a stable anonymous device ID sent
//        as `nmxDeviceId` — matching the "one free voice preview"
//        design already built into the homepage widget's UI.
//      - PRO members (valid token) get unlimited generations.
// 2. Best-effort pronunciation nudge for "Veto": the word is a
//    true homophone of the name "Vito" — they are pronounced
//    identically in English, so no spelling change can make a
//    TTS voice say them differently. This nudges the model with
//    a phonetic respelling in the AUDIO INPUT ONLY (never shown
//    on-screen) plus explicit instructions, but it's a soft
//    attempt, not a guaranteed fix, since there's no real
//    acoustic difference to land on.
// 3. NEW: the homepage's hero greeting bubble is an unlimited,
//    always-available preview of Veto's voice — it's meant to
//    sell the experience before someone has any account at all,
//    so it intentionally bypasses BOTH the PRO check and the
//    one-generation-ever limit that governs every other Listen
//    button on the site (chat replies, Next Dollar, paycheck
//    results, etc.). It's flagged by the client sending
//    `isGreetingPreview: true`. Nothing else changes for these
//    calls — same OpenAI request, same pronunciation nudge —
//    and critically, using it never increments the visitor's
//    real free-preview counter, so it doesn't eat into the one
//    free generation they get everywhere else on the site.
//
//    SECURITY NOTE: because this flag is read from the request
//    body, anyone calling this endpoint directly (not through
//    the actual homepage) could set `isGreetingPreview: true` to
//    get unlimited free generations for arbitrary text, bypassing
//    the PRO paywall entirely. This is an accepted tradeoff for
//    now — the same risk profile as any "free sample" marketing
//    endpoint — but if abuse/cost becomes a real problem later,
//    the fix is either IP-based rate limiting on this branch, or
//    restricting it to a small allow-list of exact greeting
//    strings rather than trusting the flag alone.
//
// Requires (in addition to OPENAI_API_KEY, already set):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — already set in this project
//   PRO_TOKEN_SECRET — already set, used by _verifyProToken
//
// Requires the "tts_usage" table — see supabase-tts-usage-table.sql
// =========================================================

import { verifyProToken } from "./_verifyProToken.js";
import { createClient } from "@supabase/supabase-js";

const FREE_TTS_LIMIT = 1;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getUsage(deviceId) {
  if (!deviceId) return { count: 0 };

  const { data, error } = await supabase
    .from("tts_usage")
    .select("generation_count")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("Supabase TTS usage lookup error:", error);
    return { count: 0 }; // fail open — a DB hiccup shouldn't block a legit free preview
  }

  return { count: data ? data.generation_count : 0 };
}

async function incrementUsage(deviceId, currentCount) {
  if (!deviceId) return;

  const { error } = await supabase
    .from("tts_usage")
    .upsert(
      {
        device_id: deviceId,
        generation_count: currentCount + 1,
        last_seen: new Date().toISOString()
      },
      { onConflict: "device_id" }
    );

  if (error) {
    console.error("Supabase TTS usage increment error:", error);
  }
}

// Best-effort audio-only pronunciation nudge. Replaces the whole
// word "Veto" (any case) with a respelling intended to encourage
// crisper, more deliberate enunciation. This does NOT reliably
// make it sound different from "Vito" — they're true homophones —
// but it's the only lever available short of a different voice
// model or SSML-style phoneme control, which gpt-4o-mini-tts
// doesn't currently support.
function applyPronunciationNudge(text) {
  return text.replace(/\bveto\b/gi, function (match) {
    // Preserve original capitalization style roughly.
    return match[0] === match[0].toUpperCase() ? "Veetoh" : "veetoh";
  });
}

export default async function handler(req, res) {
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

    // Real, server-verified PRO status.
    const proEmail = verifyProToken(req.body.nmxProToken);
    const isPro = !!proEmail;

    const deviceId =
      typeof req.body.nmxDeviceId === "string"
        ? req.body.nmxDeviceId.slice(0, 100)
        : null;

    // See the SECURITY NOTE above — this flag exempts the call from
    // both the PRO check and the free-generation limit.
    const isGreetingPreview = req.body.isGreetingPreview === true;

    let usage = { count: 0 };

    if (!isPro && !isGreetingPreview) {
      usage = await getUsage(deviceId);
      if (usage.count >= FREE_TTS_LIMIT) {
        res.status(403).json({
          error: "voice_limit_reached",
          message: "You've used your free voice preview. Upgrade to Veto PRO for unlimited voice."
        });
        return;
      }
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Voice service is not configured yet." });
      return;
    }

    const audioInputText = applyPronunciationNudge(safeText);

    const openaiResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "nova",
        input: audioInputText,
        instructions: "Speak as a warm, friendly Caribbean woman — natural, welcoming, and easy to understand, like a trusted friend giving financial advice. When saying the name 'Veetoh', enunciate each syllable clearly and deliberately rather than blending them.",
        response_format: "mp3"
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(function () { return ""; });
      console.error("OpenAI TTS error:", openaiResponse.status, errorText);
      res.status(502).json({ error: "Voice service is temporarily unavailable." });
      return;
    }

    // Only count this toward the free limit on a successful
    // generation — and never for the greeting preview, since that
    // one is meant to be unlimited and shouldn't touch this
    // visitor's real free-preview credit for the rest of the site.
    if (!isPro && !isGreetingPreview) {
      await incrementUsage(deviceId, usage.count);
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
