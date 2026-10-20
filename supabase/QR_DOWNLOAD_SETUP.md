# Supabase private PDF QR downloads (30-day links)

The static app remains in GitHub Pages. PDFs are stored in the existing separate **private GitHub repository**; no public PDF URL is created. The QR contains a random, unguessable token URL that works without login for 30 days.

## One-time setup

1. Keep the GitHub PDF repository private. Configure the Supabase Edge Function secrets:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GITHUB_PDF_REPO` = `owner/elevator-safety-prescription-private`
   - `GITHUB_PDF_TOKEN` = fine-grained token with Contents read/write access only to that private repo
   - `GITHUB_PDF_BRANCH` = `main` (if different)
   - `ALLOWED_ORIGIN` = `https://ahj061801-ctrl.github.io`
   - optional `QR_RATE_LIMIT_SALT` = a long random secret
2. Run `supabase/migrations/003_public_qr_links.sql` in Supabase SQL Editor.
3. Deploy these new functions with JWT verification disabled because they must work without login:
   - `create-prescription-qr` (POST; called by the web app)
   - `download-prescription` (GET; called by QR scans)
   With Supabase CLI, run:
   `supabase functions deploy create-prescription-qr --no-verify-jwt`
   `supabase functions deploy download-prescription --no-verify-jwt`
4. Test with non-sensitive dummy information first. Generate a QR, scan it on a phone that is not logged in, confirm the PDF downloads, then test expiration by setting a test row's `expires_at` into the past.
5. Keep the GitHub PDF repository private and never put its token in the front-end.

## Security and limitations

- The random 256-bit token is stored only as a SHA-256 hash in Supabase. The download endpoint checks expiration on every request; a copied QR/link can be used by anyone until it expires.
- Creation is rate-limited to 10 requests per IP per hour. The current GitHub Contents API implementation limits PDFs to 700 KB so it can safely read the private file back; larger files are rejected.
- A 30-day link is bearer access, not identity verification. Anyone who obtains the QR or URL can download the PDF during that period. Do not include information that policy prohibits sharing by bearer link.
- Existing issuance ledger features are not used by these QR functions.
