# Supabase + private GitHub PDF storage setup

The public GitHub Pages repository contains only the web app code. Issued PDFs are stored in a **separate private GitHub repository**. Supabase keeps the issuance ledger and authenticates users; PDFs are only fetched by the Edge Function after login and branch-access checks.

## One-time setup

1. Keep `ahj061801-ctrl/elevator-safety-prescription` public for GitHub Pages.
2. In GitHub, create a **separate private repository** for PDF files (for example, `elevator-safety-prescription-private`). Do not enable GitHub Pages for that repository.
3. In GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens, create a token limited to that private repository. Grant **Contents: Read and write** only. Do not put this token in `index.html` or commit it to GitHub.
4. In Supabase Dashboard → Edge Functions → Secrets, add:
   - `GITHUB_PDF_REPO` = `your-github-name/elevator-safety-prescription-private`
   - `GITHUB_PDF_TOKEN` = the fine-grained token from step 3
   - `GITHUB_PDF_BRANCH` = `main` (or the private repository's default branch)
5. Keep existing Supabase secrets configured: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGIN` (set to `https://ahj061801-ctrl.github.io`).
6. Run the SQL migrations in `supabase/migrations/` in order. Keep the `profiles` table restricted to authorized active users and assign each user a branch.
7. In Supabase Auth, enable GitHub login and configure the OAuth callback/redirect URLs as described in the Supabase dashboard.
8. Redeploy both Edge Functions after adding the new secrets:
   - `issue-prescription`
   - `get-prescription-pdf`
9. Test with dummy data using an authorized test account. Issue a PDF, confirm a PDF appears under `pdfs/YYYY/MM/` in the private repository, refresh the web app's ledger, and download that PDF again.

## How it works

- Clicking **PDF 발급·대장 저장** sends the generated PDF to the authenticated Supabase Edge Function.
- The function validates the user and records the issuance metadata in Supabase, then commits the PDF into the private GitHub repository.
- The ledger reads from Supabase. Downloading a row calls `get-prescription-pdf`, which checks the user's active profile and branch before retrieving the file from the private repository.
- No public PDF URL is generated. Do not share the private repository token or switch the PDF repository to public.
- Files are stored at `pdfs/YYYY/MM/{issue-number}-{uuid}.pdf`. The UUID prevents filename collisions.
- Supabase Storage bucket creation is not required for PDF bytes with this configuration; the existing metadata table still records the private repository path.

## Security notes

- A private repository is not an encrypted archive: anyone granted access to that repository can see its files. Limit access to authorized custodians and follow your organization's rules for inspection records and personal/building information.
- A fine-grained GitHub token with Contents read/write access to only the PDF repository is preferred. Never use a token with broad account/repository access.
- The static GitHub Pages app remains publicly accessible; access to issuance and PDF downloads is enforced by Supabase authentication, active profile, and branch checks.
