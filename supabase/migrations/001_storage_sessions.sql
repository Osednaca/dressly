-- Apply manually in the Supabase SQL editor. The server secret bypasses RLS;
-- no anon/authenticated policies are granted. Application endpoints currently
-- use opaque identifiers, not authenticated per-user ownership.
create table if not exists public.dressly_sessions (
  id text primary key,
  data jsonb not null,
  revision bigint not null default 0
);
alter table public.dressly_sessions enable row level security;
revoke all on public.dressly_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.dressly_sessions to service_role;

-- Private object storage; application server reads/writes with its secret key.
insert into storage.buckets (id, name, public)
values ('dressly-private', 'dressly-private', false)
on conflict (id) do update set public = false;
