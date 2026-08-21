// =========================================================
// api/_verifySyncToken.js — resolves a sync token to a real,
// code-verified email address by looking it up directly in
// nma_sync_sessions (the same table request-code.js / verify.js
// already write to for the Spending page's sync banner).
//
// ASSUMPTION TO CONFIRM: this assumes nma_sync_sessions has
// exactly the columns (token, email, expires_at) as noted in
// earlier session work. If your actual api/sync/verify.js does
// something different (e.g. a JWT instead of an opaque token
// looked up in this table), paste that file and I'll rebuild
// this to match exactly rather than guess further.
// =========================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export async function verifySyncToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const { data, error } = await supabase
    .from("nma_sync_sessions")
    .select("email, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Sync token lookup error:", error);
    return null;
  }

  if (!data || !data.email) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }

  return data.email;
}
