# Supabase setup checklist

1. Create a dedicated Supabase project.
2. Run migrations in order from `supabase/migrations/` in the SQL editor or Supabase CLI.
3. In Storage, create bucket `prescription-pdfs` with **Public bucket disabled**.
4. In Supabase Auth, enable the GitHub provider. Create a GitHub OAuth App in GitHub Developer Settings and enter its Client ID/Secret in Supabase. Use the callback URL shown by Supabase when configuring the OAuth App.
5. Configure the app's allowed redirect URLs for the published GitHub Pages site.
6. Set Edge Function secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGIN`.
7. Deploy functions: `issue-prescription` and `get-prescription-pdf`. Keep JWT verification enabled.
8. Have each inspector sign in once, then have the administrator activate their profile and assign the branch and role.
9. Test with dummy data and separate test accounts before using real inspection data.
10. Never commit real PDFs, service-role keys, or database credentials to GitHub.

## Integration notes
- The current static UI still needs to be connected to Supabase GitHub sign-in.
- The UI must send the authenticated access token when calling issuance/download functions.
- The UI must call `get-prescription-pdf` for downloads rather than linking directly to Storage.
- Set `ALLOWED_ORIGIN` to the exact published app origin; do not use `*`.
- The current public GitHub Pages site is not automatically protected by GitHub login; the app must implement the OAuth sign-in and check the active user profile.
- Keep the Storage bucket private even though access rules are simplified.
