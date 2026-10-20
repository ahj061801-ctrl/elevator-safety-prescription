-- Server-side issuance number allocator.
-- Only service-role Edge Functions may execute this function.
create or replace function public.next_issue_no(p_branch_id uuid, p_issue_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  insert into public.issuance_counters(branch_id, issue_date, last_value)
  values (p_branch_id, p_issue_date, 1)
  on conflict (branch_id, issue_date)
  do update set last_value = public.issuance_counters.last_value + 1
  returning last_value into next_value;

  return 'ESP-' || to_char(p_issue_date, 'YYYYMMDD') || '-' || lpad(next_value::text, 4, '0');
end;
$$;

revoke all on function public.next_issue_no(uuid, date) from public, anon, authenticated;
grant execute on function public.next_issue_no(uuid, date) to service_role;
