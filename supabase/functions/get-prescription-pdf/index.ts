// Supabase Edge Function: get-prescription-pdf
// Checks the signed-in user's branch access, then streams the PDF from a PRIVATE GitHub repository.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "https://ahj061801-ctrl.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GITHUB_PDF_TOKEN");
  const githubRepo = Deno.env.get("GITHUB_PDF_REPO");
  if (!url || !anonKey || !serviceKey) return json({ error: "server_not_configured" }, 500);
  if (!githubToken || !githubRepo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) {
    return json({ error: "github_storage_not_configured" }, 500);
  }

  const token = authHeader.slice(7);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const prescriptionId = String(body?.prescriptionId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(prescriptionId)) return json({ error: "invalid_id" }, 400);

  const { data: profile } = await admin.from("profiles").select("branch_id, active")
    .eq("user_id", authData.user.id).maybeSingle();
  if (!profile?.active) return json({ error: "forbidden" }, 403);

  const { data: record } = await admin.from("prescriptions")
    .select("id, branch_id, issue_no, status").eq("id", prescriptionId).maybeSingle();
  if (!record || record.branch_id !== profile.branch_id || !["completed", "cancelled"].includes(record.status)) {
    await admin.from("prescription_events").insert({
      branch_id: profile.branch_id, prescription_id: record?.id ?? null,
      actor_id: authData.user.id, event_type: "access_denied",
    });
    return json({ error: "not_found_or_forbidden" }, 404);
  }

  const { data: fileRecord } = await admin.from("prescription_files")
    .select("storage_path, file_size_bytes").eq("prescription_id", record.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!fileRecord) return json({ error: "file_not_found" }, 404);

  const apiUrl = "https://api.github.com/repos/" + githubRepo + "/contents/" +
    fileRecord.storage_path.split("/").map(encodeURIComponent).join("/");
  const githubResponse = await fetch(apiUrl, {
    method: "GET",
    headers: {
      "Accept": "application/vnd.github.raw",
      "Authorization": "Bearer " + githubToken,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "elevator-safety-prescription",
    },
  });
  if (!githubResponse.ok) {
    return json({ error: "github_pdf_download_failed", github_status: githubResponse.status }, 502);
  }

  const pdfBytes = await githubResponse.arrayBuffer();
  if (pdfBytes.byteLength < 5) return json({ error: "invalid_stored_pdf" }, 502);
  await admin.from("prescription_events").insert({
    branch_id: profile.branch_id, prescription_id: record.id, actor_id: authData.user.id,
    event_type: "download_pdf",
  });

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + String(record.issue_no).replace(/[^A-Za-z0-9._-]/g, "_") + '.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
