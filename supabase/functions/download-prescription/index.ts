import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function html(message: string, status = 200) {
  return new Response("<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>승강기 안전처방전 PDF</title><body style=\"font-family:sans-serif;max-width:640px;margin:12vh auto;padding:24px;line-height:1.7\"><h2>승강기 안전처방전</h2><p>" + message + "</p></body></html>", {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method !== "GET") return html("잘못된 요청입니다.", 405);
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return html("다운로드 링크가 올바르지 않습니다.", 400);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const githubToken = Deno.env.get("GITHUB_PDF_TOKEN");
  const repo = Deno.env.get("GITHUB_PDF_REPO");
  if (!url || !serviceKey || !githubToken || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return html("서버 설정이 완료되지 않았습니다. 관리자에게 문의하세요.", 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const tokenHash = await sha256Hex(token);
  const { data: link, error } = await admin.from("prescription_qr_links").select("id,storage_path,expires_at,download_count").eq("token_hash", tokenHash).maybeSingle();
  if (error || !link) return html("유효하지 않은 다운로드 링크입니다.", 404);
  if (new Date(link.expires_at).getTime() <= Date.now()) return html("이 다운로드 링크는 30일 유효기간이 만료되었습니다. 점검표 웹앱에서 새 QR 코드를 생성해 주세요.", 410);

  const response = await fetch("https://api.github.com/repos/" + repo + "/contents/" + link.storage_path.split("/").map(encodeURIComponent).join("/"), {
    headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + githubToken, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) return html("비공개 PDF 파일을 가져오지 못했습니다. 관리자에게 문의하세요.", 502);
  const file: any = await response.json();
  if (file.encoding !== "base64" || typeof file.content !== "string") return html("PDF 파일을 읽을 수 없습니다. 파일 크기 제한을 확인하세요.", 502);
  const binary = atob(file.content.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return html("파일 형식이 올바르지 않습니다.", 502);

  await admin.from("prescription_qr_links").update({ download_count: (link.download_count || 0) + 1 }).eq("id", link.id);
  const filename = "elevator-safety-prescription.pdf";
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"" + filename + "\"; filename*=UTF-8''%EC%8A%B9%EA%B0%95%EA%B8%B0%20%EC%95%88%EC%A0%84%EC%B2%98%EB%B0%A9%EC%A0%84.pdf",
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
