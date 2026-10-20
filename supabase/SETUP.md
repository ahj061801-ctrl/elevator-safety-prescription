# Supabase setup checklist

1. Obtain organizational approval for cloud storage of inspection-related records.
2. Create a dedicated Supabase project in an approved region.
3. Run migrations in order from `supabase/migrations/` in the SQL editor or Supabase CLI.
4. In Storage, create bucket `prescription-pdfs` with **Public bucket disabled**.
5. Configure Auth email/password or approved SSO. Disable public sign-up; create/invite accounts through an administrator-controlled process.
6. Set Edge Function secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGIN`.
7. Deploy functions: `issue-prescription` and `get-prescription-pdf`. Keep JWT verification enabled; the functions also verify the user explicitly.
8. Create the first branch admin profile manually from a trusted administrative session. Do not let users set their own role or branch.
9. Test with dummy data and separate test accounts before using real inspection data.
10. Do not put real PDFs, service-role keys, or database credentials in GitHub.

## Important integration notes
- The current static UI must be adapted to sign in, send the authenticated access token, generate the PDF as bytes, and call `issue-prescription`.
- The current static UI must call `get-prescription-pdf` for downloads rather than link directly to Storage.
- Set `ALLOWED_ORIGIN` to the exact published app origin; do not use `*`.
- Before production, add request rate limiting, failed-job retry/cleanup, explicit cancellation/reissue functions, and automated RLS/Storage authorization tests.
