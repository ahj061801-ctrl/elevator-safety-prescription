// Supabase Edge Function: get-prescription-pdf
// Returns PDF bytes only after server-side auth and branch membership checks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "https://ahj061801-ctrl.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return Response.json({ error: "server_not_configured" }, { status: 500, headers: corsHeaders });

  const token = authHeader.slice(7);
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return Response.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400, headers: corsHeaders }); }
  const prescriptionId = String(body?.prescriptionId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(prescriptionId)) return Response.json({ error: "invalid_id" }, { status: 400, headers: corsHeaders });

  const { data: profile } = await admin.from("profiles").select("branch_id, active")
    .eq("user_id", authData.user.id).maybeSingle();
  if (!profile?.active) return Response.json({ error: "forbidden" }, { status: 403, headers: corsHeaders });

  const { data: record } = await admin.from("prescriptions")
    .select("id, branch_id, status").eq("id", prescriptionId).maybeSingle();
  if (!record || record.branch_id !== profile.branch_id || !["completed", "cancelled"].includes(record.status)) {
    await admin.from("prescription_events").insert({
      branch_id: profile.branch_id, prescription_id: record?.id ?? null,
      actor_id: authData.user.id, event_type: "access_denied",
    });
    return Response.json({ error: "not_found_or_forbidden" }, { status: 404, headers: corsHeaders });
  }

  const { data: fileRecord } = await admin.from("prescription_files")
    .select("storage_path, file_size_bytes").eq("prescription_id", record.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!fileRecord) return Response.json({ error: "file_not_found" }, { status: 404, headers: corsHeaders });

  const { data: fileBlob, error: downloadError } = await admin.storage.from("prescription-pdfs").download(fileRecord.storage_path);
  if (downloadError || !fileBlob) return Response.json({ error: "download_failed" }, { status: 500, headers: corsHeaders });

  await admin.from("prescription_events").insert({
    branch_id: profile.branch_id, prescription_id: record.id, actor_id: authData.user.id,
    event_type: "download_pdf",
  });

  return new Response(fileBlob, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="prescription.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
