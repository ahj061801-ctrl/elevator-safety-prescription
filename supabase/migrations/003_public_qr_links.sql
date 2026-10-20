-- Public QR download links for private PDFs. Only SHA-256 token hashes are stored.
create table if not exists public.prescription_qr_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  storage_path text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  download_count integer not null default 0
);
create index if not exists prescription_qr_links_expiry_idx
  on public.prescription_qr_links (expires_at);

create table if not exists public.prescription_qr_rate_limits (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists prescription_qr_rate_limits_ip_created_idx
  on public.prescription_qr_rate_limits (ip_hash, created_at desc);

alter table public.prescription_qr_links enable row level security;
alter table public.prescription_qr_rate_limits enable row level security;
revoke all on public.prescription_qr_links from anon, authenticated;
revoke all on public.prescription_qr_rate_limits from anon, authenticated;
