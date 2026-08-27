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
// 3. The homepage's hero greeting bubble is exempt from the
//    free-preview limit and PRO check entirely — it's meant to be
//    a taste of what Veto's voice sounds like for every visitor,
//    paid or not, not something that gets locked after one play.
//    The client sends `isHeroGreeting: true` to request this.
//    IMPORTANT: this bypass is length-capped (MAX_GREETING_LENGTH)
//    specifically so it can't be used as a backdoor for unlimited
//    free generation of arbitrary text — someone could otherwise
//    copy this flag in DevTools and call the endpoint directly
//    with any text, at your OpenAI cost, from anywhere on the
//    internet. Capping it to roughly greeting-length text keeps
//    the always-free behavior scoped to its actual purpose.
//
// UPDATED AGAIN (fail-closed entitlement check):
// 4. PRO token is now the sole entitlement check; a missing device
//    ID on the free path used to silently mean "zero usage so far"
//    (via getUsage()'s old `if (!deviceId) return { count: 0 }`
//    guard), which is functionally the same as unlimited free
//    generation for any request that simply didn't send an ID.
//    That guard is gone — getUsage() now throws if it's ever
//    called without a deviceId, and the handler itself requires a
//    deviceId up front on the free path (400 missing_device_id if
//    absent) before ever reaching getUsage(). Device ID still
//    never proves PRO status by itself; it's free-tier tracking
//    only, gated entirely behind "not already PRO."
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
const MAX_GREETING_LENGTH = 500;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getUsage(deviceId) {
  // Missing identity must never be treated as "zero usage so far" —
  // that silently meant unlimited free generation for any request
  // that omitted a device ID. Callers are required to reject a
  // missing deviceId before ever calling this.
  if (!deviceId) {
    throw new Error("missing_device_id");
  }

  const { data, error } = await supabase
    .from("tts_usage")
    .select("generation_count")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    console.error("Supabase TTS usage lookup error:", error);
    return { count: 0 }; // fail open on a DB hiccup — a legit free preview shouldn't be blocked by an outage
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

    // The hero greeting on the homepage is always free — no PRO
    // check, no usage counter — but only up to a short length, so
    // this can't double as a way to get unlimited free generation
    // of arbitrary text by spoofing the flag directly against the
    // API from outside the site.
    const isHeroGreeting = req.body && req.body.isHeroGreeting === true;

    if (isHeroGreeting && safeText.length > MAX_GREETING_LENGTH) {
      res.status(400).json({ error: "Greeting text is too long for the free preview." });
      return;
    }

    // Real, server-verified PRO status — the actual entitlement
    // check. Device ID (below) is free-tier usage tracking only
    // and never substitutes for a valid PRO token.
    const proEmail = verifyProToken(req.body.nmxProToken);
    const isPro = !!proEmail;

    const deviceId =
      typeof req.body.nmxDeviceId === "string"
        ? req.body.nmxDeviceId.slice(0, 100)
        : null;

    let usage = { count: 0 };

    if (!isPro && !isHeroGreeting) {
      // Missing identity fails closed, not open — see getUsage()'s
      // comment above for why this check has to happen here, before
      // ever calling it.
      if (!deviceId) {
        res.status(400).json({
          error: "missing_device_id",
          message: "A device identifier is required to use the free voice preview."
        });
        return;
      }

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
    // generation, and never for the hero greeting bypass.
    if (!isPro && !isHeroGreeting) {
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
