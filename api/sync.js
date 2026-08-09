// =========================================================
// GET  /api/sync           (Authorization: Bearer <token>)
//   → returns everything the visitor has saved across all tools
//
// POST /api/sync           (Authorization: Bearer <token>)
//   Body: { "tool": "invest", "data": { ...tool's state... } }
//   → saves/overwrites just that tool's branch, leaves the rest alone
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
      .eq("email", email)
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: "Could not load data" });
    }
    return res.status(200).json({
      success: true,
      found: true,
      tools: data.tools || {},
      updatedAt: data.updated_at
    });
  }

  if (req.method === "POST") {
    const { tool, data: toolData } = req.body || {};
    if (!tool || typeof toolData === "undefined") {
      return res.status(400).json({ success: false, error: "tool and data required" });
    }

    const { data: existing } = await supabase
      .from("nma_users")
      .select("tools")
      .eq("email", email)
      .single();

    const mergedTools = { ...(existing ? existing.tools : {}), [tool]: toolData };

    const { error } = await supabase
      .from("nma_users")
      .update({ tools: mergedTools, updated_at: new Date().toISOString() })
      .eq("email", email);

    if (error) {
      console.error("sync save error:", error);
      return res.status(500).json({ success: false, error: "Could not save data" });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
}
