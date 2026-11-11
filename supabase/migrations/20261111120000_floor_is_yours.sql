-- The Floor Is Yours — Lovable Cloud schema.
-- Every table is reachable only by the `api` edge function (service role). Row-Level Security is enabled
-- with no policies for anon/authenticated users, so the browser can never read another learner's run,
-- recording, transcript or score — it only talks to the edge function, which checks ownership.
-- Each record is kept whole in `doc` (jsonb, the shape in supabase/functions/_shared/ports.ts); the
-- columns beside it exist for lookups and for the rules the database itself must enforce.

create table if not exists public.learners (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.runs (
  id text primary key,
  learner_id uuid not null references public.learners (id) on delete cascade,
  status text not null check (status in ('active', 'submitted', 'complete', 'review-requested', 'closed-unscored', 'finished')),
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One unfinished run per learner, enforced by the database (double clicks and parallel tabs included).
create unique index if not exists runs_one_active_per_learner on public.runs (learner_id)
  where status not in ('finished', 'closed-unscored');
create index if not exists runs_updated_at on public.runs (updated_at desc);

create table if not exists public.recordings (
  id text primary key,
  run_id text not null unique references public.runs (id) on delete cascade, -- exactly one recording per run
  learner_id uuid not null references public.learners (id) on delete cascade,
  doc jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists recordings_created_at on public.recordings (created_at);

create table if not exists public.jobs (
  id text primary key,
  run_id text not null references public.runs (id) on delete cascade,
  learner_id uuid not null references public.learners (id) on delete cascade,
  stage text not null,
  lease_until timestamptz,
  doc jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists jobs_stage on public.jobs (stage);

create table if not exists public.evaluations (
  id text primary key,
  run_id text not null references public.runs (id) on delete cascade,
  learner_id uuid not null references public.learners (id) on delete cascade,
  doc jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id text primary key,
  run_id text not null references public.runs (id) on delete cascade,
  learner_id uuid not null references public.learners (id) on delete cascade,
  status text not null check (status in ('open', 'resolved')),
  doc jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists reviews_run_open on public.reviews (run_id) where status = 'open';

-- Append-only audit trail (no learner speech is stored here).
create table if not exists public.audit_log (
  id text primary key,
  at timestamptz not null default now(),
  run_id text,
  learner_id uuid,
  actor text not null,
  event text not null,
  detail jsonb
);
create index if not exists audit_log_at on public.audit_log (at desc);

-- A learner row must exist before their first run: create it when the anonymous user signs up.
create or replace function public.fiy_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.learners (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists fiy_on_auth_user_created on auth.users;
create trigger fiy_on_auth_user_created after insert on auth.users
  for each row execute function public.fiy_handle_new_user();

-- Atomically take an assessment job's processing lease (so two invocations never run the same step).
create or replace function public.claim_job(p_id text, p_until timestamptz, p_now timestamptz) returns boolean
language plpgsql set search_path = public as $$
declare claimed int;
begin
  update public.jobs set lease_until = p_until
   where id = p_id and (lease_until is null or lease_until < p_now);
  get diagnostics claimed = row_count;
  return claimed = 1;
end $$;

-- Lock everything down: only the service role (the edge function) may touch these.
alter table public.learners enable row level security;
alter table public.runs enable row level security;
alter table public.recordings enable row level security;
alter table public.jobs enable row level security;
alter table public.evaluations enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.learners, public.runs, public.recordings, public.jobs, public.evaluations, public.reviews, public.audit_log from anon, authenticated;
revoke execute on function public.claim_job(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.fiy_handle_new_user() from public, anon, authenticated;

-- Private bucket for recordings and judge voices. No storage policies: files are reached only through
-- short-lived signed URLs that the edge function issues to the owner (or a facilitator).
insert into storage.buckets (id, name, public, file_size_limit)
values ('fiy-private', 'fiy-private', false, 10485760)
on conflict (id) do nothing;
