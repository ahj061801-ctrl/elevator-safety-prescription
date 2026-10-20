import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "https://ahj061801-ctrl.github.io",
  "Access-Control-Allow-Headers": "content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function githubPut(path: string, content: string) {
  const token = Deno.env.get("GITHUB_PDF_TOKEN");
  const repo = Deno.env.get("GITHUB_PDF_REPO");
  if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("github_storage_not_configured");
  return await fetch("https://api.github.com/repos/" + repo + "/contents/" + path, {
    method: "PUT",
    headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Store private PDF for expiring QR download", content, branch: Deno.env.get("GITHUB_PDF_BRANCH") || "main" }),
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = req.headers.get("origin");
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://ahj061801-ctrl.github.io";
  if (origin && origin !== allowedOrigin) return json({ error: "origin_not_allowed" }, 403);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_not_configured" }, 500);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const pdfBase64 = String(body?.pdfBase64 ?? "");
  if (!pdfBase64 || pdfBase64.length > 1_000_000) return json({ error: "pdf_too_large_or_missing", maxBytes: 700000 }, 413);

  let bytes: Uint8Array;
  try { bytes = decodeBase64(pdfBase64); } catch { return json({ error: "invalid_pdf_encoding" }, 400); }
  if (bytes.length < 8 || bytes.length > 700_000 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return json({ error: "invalid_or_too_large_pdf", maxBytes: 700000 }, 413);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipHash = await sha256Hex(forwarded + ":" + (Deno.env.get("QR_RATE_LIMIT_SALT") || serviceKey));
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin.from("prescription_qr_rate_limits").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since);
  if (countError) return json({ error: "rate_limit_check_failed" }, 500);
  if ((count ?? 0) >= 10) return json({ error: "rate_limit_exceeded", message: "시간당 QR 생성 한도(10회)를 초과했습니다." }, 429);

  const { error: rateError } = await admin.from("prescription_qr_rate_limits").insert({ ip_hash: ipHash });
  if (rateError) return json({ error: "rate_limit_record_failed" }, 500);

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(tokenBytes);
  const tokenHash = await sha256Hex(token);
  const fileId = crypto.randomUUID();
  const storagePath = "qr-pdfs/" + new Date().toISOString().slice(0, 10).replaceAll("-", "/") + "/" + fileId + ".pdf";
  let upload: Response;
  try { upload = await githubPut(storagePath, pdfBase64); } catch { return json({ error: "private_storage_not_configured" }, 500); }
  if (!upload.ok) return json({ error: "private_storage_upload_failed", status: upload.status }, 502);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: insertError } = await admin.from("prescription_qr_links").insert({ token_hash: tokenHash, storage_path: storagePath, expires_at: expiresAt });
  if (insertError) return json({ error: "link_record_failed" }, 500);

  const projectRef = new URL(url).hostname.split(".")[0];
  const downloadUrl = "https://" + projectRef + ".supabase.co/functions/v1/download-prescription?token=" + encodeURIComponent(token);
  return json({ downloadUrl, expiresAt, expiresInDays: 30 });
});
