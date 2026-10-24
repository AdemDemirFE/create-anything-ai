-- Stack 08 — deterministic demo seed.
--
-- IMPORTANT (BaaS security model): rows in public.apps MUST belong to a real
-- auth.users id, but seeds must never contain credentials. This seed therefore
-- does not insert any row by itself. It installs a SECURITY DEFINER helper
-- that a developer calls ONCE per environment with an id created through real
-- signup (Supabase Studio or the app's Register screen):
--
--   select public.seed_demo_apps('<existing-auth-user-uuid>');
--
-- The helper refuses to run when the target user does not exist, and it is
-- idempotent (fixed natural keys, ON CONFLICT DO NOTHING), so re-running it
-- never duplicates demo rows. No password material appears anywhere here.
create or replace function public.seed_demo_apps(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  -- Fail loudly instead of silently inserting orphaned rows.
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'seed_demo_apps: auth user % does not exist — sign up first', p_user_id;
  end if;

  insert into public.apps (user_id, name, description, status)
  values
    (p_user_id, 'Demo: Word Counter',
     'Counts words, characters, and lines of the submitted text.', 'active'),
    (p_user_id, 'Demo: Slugifier',
     'Turns a title into a URL-safe slug.', 'active'),
    (p_user_id, 'Demo: Case Converter',
     'Switches text between UPPER, lower, and Title Case.', 'draft')
  on conflict (user_id, name) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- revoke from anon/authenticated: seeding is an operator action, never a
-- browser-reachable RPC.
revoke execute on function public.seed_demo_apps(uuid) from anon, authenticated;
