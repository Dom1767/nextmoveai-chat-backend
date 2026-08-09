// =========================================================
// GET  /api/sync           (Authorization: Bearer <token>)
//   → returns everything the visitor has saved across all tools
//
// POST /api/sync           (Authorization: Bearer <token>)
//   Body: { "tool": "invest", "data": { ...tool's state... } }
//   → saves/overwrites just that tool's branch, leaves the rest alone
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// =========================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getEmailForToken(token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from("nma_sync_sessions")
    .select("email, expires_at")
    .eq("token", token)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return data.email;
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const email = await getEmailForToken(token);

  if (!email) {
    return res.status(401).json({ success: false, error: "Invalid or expired session" });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("nma_users")
      .select("tools, updated_at")
