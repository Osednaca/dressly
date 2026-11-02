-- Server-only event log for short-lived, resumable consultation notifications.
create table if not exists public.dressly_consultation_events (
  id bigint generated always as identity primary key,
  session_id text not null,
  event jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists dressly_consultation_events_session_id_idx
  on public.dressly_consultation_events(session_id, id);
create index if not exists dressly_consultation_events_created_at_idx
  on public.dressly_consultation_events(created_at);
alter table public.dressly_consultation_events enable row level security;
revoke all on public.dressly_consultation_events from public, anon, authenticated;
grant select, insert, delete on public.dressly_consultation_events to service_role;
revoke all on sequence public.dressly_consultation_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.dressly_consultation_events_id_seq to service_role;

-- Keep the short-lived event log from growing without bound during active use.
create or replace function public.dressly_prune_consultation_events()
returns trigger language plpgsql set search_path = '' as $$
begin
  delete from public.dressly_consultation_events
  where created_at < now() - interval '1 hour';
  return new;
end;
$$;
revoke all on function public.dressly_prune_consultation_events() from public, anon, authenticated;
drop trigger if exists dressly_prune_consultation_events on public.dressly_consultation_events;
create trigger dressly_prune_consultation_events
  after insert on public.dressly_consultation_events
  for each statement execute function public.dressly_prune_consultation_events();
