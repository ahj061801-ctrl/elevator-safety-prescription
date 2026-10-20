// Supabase Edge Function: issue-prescription
// Stores PDF files in a separate PRIVATE GitHub repository.
// GitHub token and repository name must be configured as Supabase Edge Function secrets.
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

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function koreaDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

async function githubRequest(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("GITHUB_PDF_TOKEN");
  const repo = Deno.env.get("GITHUB_PDF_REPO");
  if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("github_storage_not_configured");
  }
  return await fetch("https://api.github.com/repos/" + repo + "/contents/" + path, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
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
  if (!url || !anonKey || !serviceKey) return json({ error: "server_not_configured" }, 500);

  const token = authHeader.slice("Bearer ".length);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const idempotencyKey = String(body?.idempotencyKey ?? "");
  const p = body?.prescription;
  const pdfBase64 = String(body?.pdfBase64 ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey) || !p || !pdfBase64) {
    return json({ error: "missing_required_fields" }, 400);
  }
  if (pdfBase64.length > 15_000_000) return json({ error: "pdf_too_large" }, 413);

  const { data: profile, error: profileError } = await admin
    .from("profiles").select("user_id, branch_id, role, active, display_name")
    .eq("user_id", authData.user.id).maybeSingle();
  if (profileError || !profile?.active) return json({ error: "inactive_or_unregistered_user" }, 403);

  const buildingName = String(p.building_name ?? "").trim();
  if (!buildingName || buildingName.length > 300) return json({ error: "invalid_building_name" }, 400);

  const date = koreaDate();
  const { data: existing } = await admin.from("prescriptions")
    .select("id, issue_no, status").eq("issued_by", authData.user.id)
    .eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing?.status === "completed") {
    return json({ id: existing.id, issueNo: existing.issue_no, status: existing.status, duplicate: true });
  }
  if (existing) return json({ error: "request_already_processed", status: existing.status }, 409);

  const { data: issueNo, error: numberError } = await admin.rpc("next_issue_no", {
    p_branch_id: profile.branch_id, p_issue_date: date,
  });
  if (numberError || !issueNo) return json({ error: "issue_number_failed" }, 500);

  const { data: record, error: insertError } = await admin.from("prescriptions").insert({
    branch_id: profile.branch_id,
    issue_no: issueNo,
    building_name: buildingName,
    elevator_no: p.elevator_no ? String(p.elevator_no).slice(0, 100) : null,
    location_text: p.location_text ? String(p.location_text).slice(0, 500) : null,
    inspection_date: p.inspection_date || null,
    inspection_type: p.inspection_type ? String(p.inspection_type).slice(0, 100) : null,
    grade_machine_room: p.grade_machine_room ?? null,
    grade_shaft: p.grade_shaft ?? null,
    grade_pit: p.grade_pit ?? null,
    average_score: p.average_score ?? null,
    overall_grade: p.overall_grade ? String(p.overall_grade).slice(0, 50) : null,
    observations: p.observations && typeof p.observations === "object" ? p.observations : {},
    status: "pending",
    issued_by: authData.user.id,
    idempotency_key: idempotencyKey,
  }).select("id").single();

  if (insertError || !record) return json({ error: "record_create_failed" }, 500);

  let bytes: Uint8Array;
  try { bytes = decodeBase64(pdfBase64); } catch {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    return json({ error: "invalid_pdf_encoding" }, 400);
  }
  if (bytes.length < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    return json({ error: "invalid_pdf" }, 400);
  }

  const fileId = crypto.randomUUID();
  const safeIssueNo = String(issueNo).replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = "pdfs/" + date.slice(0, 4) + "/" + date.slice(5, 7) + "/" + safeIssueNo + "-" + fileId + ".pdf";

  let githubResponse: Response;
  try {
    githubResponse = await githubRequest(encodeURI(storagePath), {
      method: "PUT",
      body: JSON.stringify({
        message: "Store issued elevator safety prescription " + issueNo,
        content: pdfBase64,
        branch: Deno.env.get("GITHUB_PDF_BRANCH") || "main",
      }),
    });
  } catch {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    return json({ error: "github_storage_not_configured" }, 500);
  }

  if (!githubResponse.ok) {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    await admin.from("prescription_events").insert({
      branch_id: profile.branch_id, prescription_id: record.id, actor_id: authData.user.id,
      event_type: "issue_failed", reason: "github_upload_failed",
      metadata: { github_status: githubResponse.status },
    });
    return json({ error: "pdf_storage_failed", issueNo }, 502);
  }

  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error: fileError } = await admin.from("prescription_files").insert({
    prescription_id: record.id, storage_path: storagePath,
    file_size_bytes: bytes.length, sha256_hex: hashHex,
  });
  if (fileError) {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    return json({ error: "file_metadata_save_failed", issueNo }, 500);
  }

  const { error: completeError } = await admin.from("prescriptions").update({
    status: "completed", issued_at: new Date().toISOString(),
  }).eq("id", record.id);
  if (completeError) {
    await admin.from("prescriptions").update({ status: "failed" }).eq("id", record.id);
    return json({ error: "finalize_failed", issueNo }, 500);
  }

  await admin.from("prescription_events").insert({
    branch_id: profile.branch_id, prescription_id: record.id, actor_id: authData.user.id,
    event_type: "issued", request_id: idempotencyKey,
    metadata: { issue_no: issueNo, file_size_bytes: bytes.length, storage: "private_github_repository" },
  });
  return json({ id: record.id, issueNo, status: "completed" });
});
