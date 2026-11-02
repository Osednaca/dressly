-- Jobs and provider handles stay server-side; direct client roles receive no access.
create table if not exists public.dressly_jobs (
  id text primary key,
  session_id text not null,
  payload jsonb not null,
  revision bigint not null default 0,
  lease_owner uuid,
  lease_until timestamptz
);
alter table public.dressly_jobs enable row level security;
revoke all on public.dressly_jobs from public, anon, authenticated;
grant all on public.dressly_jobs to service_role;
create index if not exists dressly_jobs_session_idx on public.dressly_jobs(session_id);

create or replace function public.dressly_claim_job(job_id text, owner_id uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare claimed boolean;
begin
  update public.dressly_jobs set lease_owner = owner_id, lease_until = now() + interval '5 minutes'
    where id = job_id and (lease_until is null or lease_until < now())
    returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.dressly_release_job(job_id text, owner_id uuid)
returns void language sql security invoker set search_path = public as $$
  update public.dressly_jobs set lease_owner = null, lease_until = null
    where id = job_id and lease_owner = owner_id;
$$;
revoke all on function public.dressly_claim_job(text, uuid) from public, anon, authenticated;
revoke all on function public.dressly_release_job(text, uuid) from public, anon, authenticated;
grant execute on function public.dressly_claim_job(text, uuid) to service_role;
grant execute on function public.dressly_release_job(text, uuid) to service_role;
