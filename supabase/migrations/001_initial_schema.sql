-- Initial schema for the Elevator Safety Prescription issuance ledger.
-- Apply only to a dedicated Supabase project after organizational approval.
-- Never put service-role keys or real inspection records in this repository.

create extension if not exists pgcrypto;

create type public.app_role as enum ('inspector', 'branch_admin');
create type public.prescription_status as enum ('pending', 'completed', 'failed', 'cancelled');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  branch_id uuid not null,
  role public.app_role not null default 'inspector',
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  issue_no text not null unique,
  building_name text not null,
  elevator_no text,
  location_text text,
  inspection_date date,
  inspection_type text,
  grade_machine_room numeric(5,2),
  grade_shaft numeric(5,2),
  grade_pit numeric(5,2),
  average_score numeric(5,2),
  overall_grade text,
  observations jsonb not null default '{}'::jsonb,
  status public.prescription_status not null default 'pending',
  issued_by uuid not null references public.profiles(user_id) on delete restrict,
  issued_at timestamptz,
  cancelled_by uuid references public.profiles(user_id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  reissue_of uuid references public.prescriptions(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issued_by, idempotency_key),
  check (grade_machine_room is null or grade_machine_room between 0 and 100),
  check (grade_shaft is null or grade_shaft between 0 and 100),
  check (grade_pit is null or grade_pit between 0 and 100),
  check (average_score is null or average_score between 0 and 100)
);

create index prescriptions_branch_issued_at_idx
  on public.prescriptions (branch_id, issued_at desc);
create index prescriptions_branch_building_idx
  on public.prescriptions (branch_id, building_name);
create index prescriptions_issued_by_idx
  on public.prescriptions (issued_by, issued_at desc);

create table public.prescription_files (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions(id) on delete restrict,
  storage_bucket text not null default 'prescription-pdfs'
    check (storage_bucket = 'prescription-pdfs'),
  storage_path text not null unique,
  mime_type text not null default 'application/pdf'
    check (mime_type = 'application/pdf'),
  file_size_bytes bigint not null check (file_size_bytes > 0),
  sha256_hex text not null check (sha256_hex ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create index prescription_files_prescription_idx
  on public.prescription_files (prescription_id, created_at desc);

create table public.prescription_events (
  id bigint generated always as identity primary key,
  branch_id uuid not null,
  prescription_id uuid references public.prescriptions(id) on delete restrict,
  actor_id uuid references public.profiles(user_id) on delete restrict,
  event_type text not null check (event_type in (
    'issue_requested', 'issued', 'issue_failed', 'view_pdf', 'download_pdf',
    'cancel_requested', 'cancelled', 'reissued', 'profile_changed', 'access_denied'
  )),
  reason text,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index prescription_events_branch_created_idx
  on public.prescription_events (branch_id, created_at desc);
create index prescription_events_prescription_idx
  on public.prescription_events (prescription_id, created_at desc);

-- Server-only counter. Edge Functions should allocate numbers transactionally.
create table public.issuance_counters (
  branch_id uuid not null,
  issue_date date not null,
  last_value integer not null default 0 check (last_value >= 0),
  primary key (branch_id, issue_date)
);

-- SECURITY DEFINER helpers avoid recursive profile RLS evaluation.
create or replace function public.current_branch_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.branch_id
  from public.profiles p
  where p.user_id = auth.uid() and p.active = true
  limit 1
$$;

create or replace function public.is_active_branch_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.active = true
      and p.role = 'branch_admin'
  )
$$;

create or replace function public.can_access_prescription(prescription_uuid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.prescriptions pr
    join public.profiles p on p.user_id = auth.uid()
    where pr.id = prescription_uuid
      and p.active = true
      and p.branch_id = pr.branch_id
  )
$$;

alter table public.profiles enable row level security;
alter table public.prescriptions enable row level security;
alter table public.prescription_files enable row level security;
alter table public.prescription_events enable row level security;
alter table public.issuance_counters enable row level security;

-- Users may read their own profile; branch admins may read profiles in their branch.
create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (
  user_id = auth.uid()
  or (
    branch_id = public.current_branch_id()
    and public.is_active_branch_admin()
  )
);

-- Clients can only read completed/cancelled records in their active branch.
-- Inserts/updates/deletes are intentionally server-only through Edge Functions.
create policy prescriptions_select_branch
on public.prescriptions for select to authenticated
using (
  branch_id = public.current_branch_id()
  and status in ('completed', 'cancelled')
);

-- File metadata is visible only to active users of the prescription's branch.
create policy prescription_files_select_branch
on public.prescription_files for select to authenticated
using (public.can_access_prescription(prescription_id));

-- Audit logs are visible only to active branch admins.
create policy prescription_events_select_admin
on public.prescription_events for select to authenticated
using (
  branch_id = public.current_branch_id()
  and public.is_active_branch_admin()
);

-- No client policies for issuance_counters: server-only.
revoke all on public.issuance_counters from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.prescriptions from anon, authenticated;
revoke insert, update, delete on public.prescription_files from anon, authenticated;
revoke insert, update, delete on public.prescription_events from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.prescriptions to authenticated;
grant select on public.prescription_files to authenticated;
grant select on public.prescription_events to authenticated;

-- Create a PRIVATE Storage bucket in Supabase Dashboard:
-- bucket id: prescription-pdfs; public = false.
-- Object naming convention: <branch_uuid>/<prescription_uuid>/<file_uuid>.pdf
-- Storage read policy checks both branch and the matching prescription row.
create policy prescription_pdf_select_authorized
on storage.objects for select to authenticated
using (
  bucket_id = 'prescription-pdfs'
  and exists (
    select 1
    from public.prescriptions pr
    join public.profiles p on p.user_id = auth.uid()
    where pr.id::text = (storage.foldername(name))[2]
      and pr.branch_id::text = (storage.foldername(name))[1]
      and p.active = true
      and p.branch_id = pr.branch_id
      and pr.status in ('completed', 'cancelled')
  )
);

-- Do not grant client insert/update/delete access to storage.objects.
-- Edge Functions use service-role credentials stored only as server secrets.
