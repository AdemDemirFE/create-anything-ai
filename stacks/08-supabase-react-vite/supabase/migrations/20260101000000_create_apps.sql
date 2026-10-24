-- Stack 08 (08-supabase-react-vite) — application schema.
--
-- BaaS paradigm: there is no custom backend server. The browser talks to
-- Supabase (GoTrue for auth, PostgREST for data) directly with the anon key,
-- and PostgreSQL Row Level Security (RLS) is the authorization layer.
-- Everything below is idempotent and safe to re-run (`supabase db reset`).

-- ============================================================================
-- extensions
-- ============================================================================
-- gen_random_uuid() lives in pgcrypto (built into PostgreSQL 13+ as a core
-- function via pgcrypto being installed by default in cloud providers, but we
-- install it explicitly so local runtimes behave identically).
create extension if not exists pgcrypto;

-- ============================================================================
-- apps — the demo resource owned by authenticated users
-- ============================================================================
-- user_id references auth.users (managed by Supabase GoTrue). We never create
-- or alter auth schema ourselves; Supabase owns it.
create table if not exists public.apps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  description text not null default '',
  status      text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Uniqueness is scoped to the owner: two users may both have an app called
  -- "Demo", one user cannot create the same name twice.
  constraint apps_user_id_name_key unique (user_id, name)
);

create index if not exists apps_user_id_created_at_idx
  on public.apps (user_id, created_at desc);

-- Keep updated_at fresh without client cooperation (clients are untrusted —
-- the anon key can write nothing except through policies, and PostgREST has
-- no trigger-free path around a BEFORE UPDATE trigger anyway).
create or replace function public.apps_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists apps_set_updated_at on public.apps;
create trigger apps_set_updated_at
  before update on public.apps
  for each row
  execute function public.apps_set_updated_at();

-- ============================================================================
-- Row Level Security — THE authorization layer of this stack
-- ============================================================================
-- Model: an app row is visible/writable only by its owner. The anon role
-- (unauthenticated visitors) gets NO policies at all, so every anon operation
-- on public.apps returns an empty set (reads) or an RLS violation (writes).
-- There is deliberately no "anon can read" policy and no service-role policy
-- in migrations: the service key must never be used by the browser.
alter table public.apps enable row level security;

-- Force RLS even for the table owner (defense in depth for local runtimes
-- where migrations historically run as a superuser role).
alter table public.apps force row level security;

-- --- SELECT: owners see only their own rows ---------------------------------
drop policy if exists "apps_select_own" on public.apps;
create policy "apps_select_own"
  on public.apps
  as permissive
  for select
  to authenticated
  using (auth.uid() = user_id);

-- --- INSERT: owners may create rows for themselves only ---------------------
-- The WITH CHECK is what prevents forging user_id for someone else: the
-- database rejects the row when user_id does not match the JWT subject.
drop policy if exists "apps_insert_own" on public.apps;
create policy "apps_insert_own"
  on public.apps
  as permissive
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- --- UPDATE: owners may change only their own rows --------------------------
-- USING limits which rows can be targeted; WITH CHECK limits what the row may
-- become (so a stolen session cannot reassign ownership with an UPDATE).
drop policy if exists "apps_update_own" on public.apps;
create policy "apps_update_own"
  on public.apps
  as permissive
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- --- DELETE: owners may remove only their own rows --------------------------
drop policy if exists "apps_delete_own" on public.apps;
create policy "apps_delete_own"
  on public.apps
  as permissive
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Deliberate absence (documented for reviewers):
--   * no policy `to anon`  -> anonymous users can neither read nor write.
--   * no `for all` policy  -> each operation is enumerated explicitly so an
--     accidentally enabled privilege cannot silently widen access.
