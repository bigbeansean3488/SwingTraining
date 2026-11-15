-- Initial schema for the team platform.
-- Conventions (see docs/DECISIONS.md D13–D15):
--   * ids are client-generated UUIDs (offline-first);
--   * updated_at   = client time of the last change, last-write-wins key;
--   * server_updated_at = set by the server on every write, used as the pull cursor;
--   * deleted_at   = tombstone (soft delete) so deletions sync between devices;
--   * statistics are never stored: game stats are computed from game_events.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_row() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    -- Last write wins: an older client change never overwrites a newer one.
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key,
  user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null check (length(display_name) between 1 and 80),
  height_cm numeric(5, 1) check (height_cm is null or height_cm between 100 and 250),
  bats text check (bats in ('R', 'L', 'S')),
  throws text check (throws in ('R', 'L', 'S')),
  birth_year int check (birth_year is null or birth_year between 1900 and 2100),
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.teams (
  id uuid primary key,
  name text not null check (length(name) between 1 and 80),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);

create table public.team_members (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'coach', 'player')),
  jersey_number text,
  positions text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.team_members (team_id);
create index on public.team_members (profile_id);

create table public.seasons (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.seasons (team_id);

create table public.invites (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  token text not null unique check (length(token) >= 16),
  role text not null check (role in ('admin', 'coach', 'player')),
  profile_id uuid references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.invites (team_id);

create table public.events (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  kind text not null check (kind in ('training', 'game', 'other')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.events (team_id, starts_at);

create table public.attendance (
  id uuid primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('yes', 'no', 'maybe')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.attendance (event_id);
create index on public.attendance (player_id);

create table public.training_sessions (
  id uuid primary key,
  team_id uuid references public.teams (id) on delete cascade,
  date date not null,
  title text not null,
  plan jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.training_sessions (team_id, date);

create table public.training_logs (
  id uuid primary key,
  player_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  session_id uuid references public.training_sessions (id) on delete set null,
  date date not null,
  kind text not null check (kind in ('batting', 'bullpen', 'fitness', 'custom')),
  data jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.training_logs (player_id, date);

create table public.motion_analyses (
  id uuid primary key,
  player_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  kind text not null check (kind in ('batting', 'pitching')),
  recorded_at timestamptz not null,
  capture jsonb not null default '{}'::jsonb,
  fps real not null,
  model_version text not null,
  engine_version text not null,
  events jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  failure text,
  forward smallint not null default 0,
  manual_events jsonb,
  keypoints text not null,
  keyframes jsonb not null default '[]'::jsonb,
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.motion_analyses (player_id, recorded_at);

create table public.games (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  season_id uuid references public.seasons (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  opponent text not null,
  game_date date not null,
  home_away text not null check (home_away in ('home', 'away')),
  innings smallint not null default 9 check (innings between 1 and 15),
  mode text not null check (mode in ('simple', 'pitch')),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'final')),
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.games (team_id, game_date);

create table public.lineups (
  id uuid primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  side text not null check (side in ('us', 'opp')),
  slots jsonb not null default '[]'::jsonb,
  pitcher_id uuid references public.profiles (id) on delete set null,
  pitcher_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.lineups (game_id);

create table public.game_events (
  id uuid primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  seq double precision not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index on public.game_events (game_id, seq);

-- Sync cursor indexes and last-write-wins triggers on every table.
do $$
declare t text;
begin
  foreach t in array array['profiles','teams','team_members','seasons','invites','events','attendance',
    'training_sessions','training_logs','motion_analyses','games','lineups','game_events']
  loop
    execute format('create index on public.%I (server_updated_at)', t);
    execute format('create trigger touch_row before insert or update on public.%I
      for each row execute function public.touch_row()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access helpers (security definer: avoid RLS recursion)
-- ---------------------------------------------------------------------------

create or replace function public.my_profile_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid() and deleted_at is null
$$;

create or replace function public.team_role(team uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when bool_or(tm.role = 'admin') then 'admin'
    when bool_or(tm.role = 'coach') then 'coach'
    when bool_or(tm.role = 'player') then 'player'
  end
  from public.team_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.team_id = team and p.user_id = auth.uid()
    and tm.deleted_at is null and tm.active and p.deleted_at is null
$$;

create or replace function public.is_member(team uuid) returns boolean
language sql stable as $$ select public.team_role(team) is not null $$;

create or replace function public.is_staff(team uuid) returns boolean
language sql stable as $$ select public.team_role(team) in ('admin', 'coach') $$;

create or replace function public.is_admin(team uuid) returns boolean
language sql stable as $$ select public.team_role(team) = 'admin' $$;

-- Staff of any team the given profile belongs to.
create or replace function public.is_staff_of_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    where tm.profile_id = pid and tm.deleted_at is null and public.is_staff(tm.team_id)
  )
$$;

-- Teammate of the given profile (used to show roster names).
create or replace function public.shares_team(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    where tm.profile_id = pid and tm.deleted_at is null and public.is_member(tm.team_id)
  )
$$;

create or replace function public.can_access_player(pid uuid) returns boolean
language sql stable as $$
  select pid in (select public.my_profile_ids()) or public.is_staff_of_profile(pid)
$$;

create or replace function public.team_created_by_me(team uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.teams where id = team and created_by = auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- Row-level security policies
--   players: read/write their own data;
--   coaches & admins: read the whole team, write training and game data;
--   non-members: nothing.
-- ---------------------------------------------------------------------------

-- profiles: own profile, roster entries you created, teammates (names for rosters).
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = auth.uid() or created_by = auth.uid() or public.shares_team(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (created_by = auth.uid() and (user_id is null or user_id = auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid() or public.is_staff_of_profile(id) or (created_by = auth.uid() and user_id is null))
  with check (user_id is null or user_id = auth.uid() or public.is_staff_of_profile(id));

-- user_id can only be set by its owner (null -> self) or cleared by the claim RPC.
create or replace function public.protect_profile_user_id() returns trigger
language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('app.claiming', true), '') <> 'on'
     and not (old.user_id is null and new.user_id = auth.uid()) then
    raise exception 'profiles.user_id can only be linked by its owner';
  end if;
  return new;
end;
$$;
create trigger protect_profile_user_id before update on public.profiles
  for each row execute function public.protect_profile_user_id();

-- teams
create policy teams_select on public.teams for select to authenticated
  using (public.is_member(id) or created_by = auth.uid());
create policy teams_insert on public.teams for insert to authenticated
  with check (created_by = auth.uid());
create policy teams_update on public.teams for update to authenticated
  using (public.is_admin(id) or (created_by = auth.uid() and public.team_role(id) is null))
  with check (public.is_admin(id) or created_by = auth.uid());

-- team_members: admins manage everyone, coaches manage players; the team
-- creator bootstraps the first admin membership for their own profile.
create policy members_select on public.team_members for select to authenticated
  using (public.is_member(team_id) or profile_id in (select public.my_profile_ids()));
create policy members_insert on public.team_members for insert to authenticated
  with check (
    public.is_admin(team_id)
    or (public.is_staff(team_id) and role = 'player')
    or (public.team_created_by_me(team_id) and role = 'admin' and profile_id in (select public.my_profile_ids()))
  );
create policy members_update on public.team_members for update to authenticated
  using (public.is_admin(team_id) or (public.is_staff(team_id) and role = 'player'))
  with check (public.is_admin(team_id) or (public.is_staff(team_id) and role = 'player'));

-- seasons, calendar events, games, lineups, game events: members read, staff write.
create policy seasons_select on public.seasons for select to authenticated using (public.is_member(team_id));
create policy seasons_write on public.seasons for insert to authenticated with check (public.is_staff(team_id));
create policy seasons_update on public.seasons for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

create policy events_select on public.events for select to authenticated using (public.is_member(team_id));
create policy events_write on public.events for insert to authenticated with check (public.is_staff(team_id));
create policy events_update on public.events for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

create policy games_select on public.games for select to authenticated using (public.is_member(team_id));
create policy games_write on public.games for insert to authenticated with check (public.is_staff(team_id));
create policy games_update on public.games for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

create policy lineups_select on public.lineups for select to authenticated using (public.is_member(team_id));
create policy lineups_write on public.lineups for insert to authenticated with check (public.is_staff(team_id));
create policy lineups_update on public.lineups for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

create policy game_events_select on public.game_events for select to authenticated using (public.is_member(team_id));
create policy game_events_write on public.game_events for insert to authenticated with check (public.is_staff(team_id));
create policy game_events_update on public.game_events for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

-- invites: staff only; accepting goes through accept_invite().
create policy invites_select on public.invites for select to authenticated using (public.is_staff(team_id));
create policy invites_write on public.invites for insert to authenticated
  with check (public.is_admin(team_id) or (public.is_staff(team_id) and role = 'player'));
create policy invites_update on public.invites for update to authenticated
  using (public.is_staff(team_id)) with check (public.is_staff(team_id));

-- attendance: a player answers for themself; staff see and edit all.
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_staff(team_id) or player_id in (select public.my_profile_ids()));
create policy attendance_insert on public.attendance for insert to authenticated
  with check ((public.is_member(team_id) and player_id in (select public.my_profile_ids())) or public.is_staff(team_id));
create policy attendance_update on public.attendance for update to authenticated
  using (player_id in (select public.my_profile_ids()) or public.is_staff(team_id))
  with check ((public.is_member(team_id) and player_id in (select public.my_profile_ids())) or public.is_staff(team_id));

-- training sessions: team plans (members read, staff write) or personal plans.
create policy sessions_select on public.training_sessions for select to authenticated
  using ((team_id is not null and public.is_member(team_id)) or (team_id is null and created_by = auth.uid()));
create policy sessions_insert on public.training_sessions for insert to authenticated
  with check ((team_id is not null and public.is_staff(team_id)) or (team_id is null and created_by = auth.uid()));
create policy sessions_update on public.training_sessions for update to authenticated
  using ((team_id is not null and public.is_staff(team_id)) or (team_id is null and created_by = auth.uid()))
  with check ((team_id is not null and public.is_staff(team_id)) or (team_id is null and created_by = auth.uid()));

-- personal data: training logs and motion analyses.
create policy logs_select on public.training_logs for select to authenticated using (public.can_access_player(player_id));
create policy logs_insert on public.training_logs for insert to authenticated with check (public.can_access_player(player_id));
create policy logs_update on public.training_logs for update to authenticated
  using (public.can_access_player(player_id)) with check (public.can_access_player(player_id));

create policy analyses_select on public.motion_analyses for select to authenticated using (public.can_access_player(player_id));
create policy analyses_insert on public.motion_analyses for insert to authenticated with check (public.can_access_player(player_id));
create policy analyses_update on public.motion_analyses for update to authenticated
  using (public.can_access_player(player_id)) with check (public.can_access_player(player_id));

-- No DELETE policies: rows are tombstoned with deleted_at so deletions sync.

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Accept an invite link. If the invite points at a roster profile without an
-- account, that profile is linked to the caller; data the caller already had
-- under another profile is moved onto it. Returns the caller's profile id and,
-- if a merge happened, the old profile id (the client remaps local data).
create or replace function public.accept_invite(invite_token text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  mine uuid;
  target uuid;
  merged_from uuid;
  meta jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.invites
    where token = invite_token and deleted_at is null and used_at is null and expires_at > now()
    for update;
  if not found then raise exception 'invite invalid or expired'; end if;

  select id into mine from public.profiles where user_id = auth.uid() and deleted_at is null limit 1;
  perform set_config('app.claiming', 'on', true);

  if inv.profile_id is not null then
    target := inv.profile_id;
    if exists (select 1 from public.profiles where id = target and user_id is not null and user_id <> auth.uid()) then
      raise exception 'this roster entry is already linked to another account';
    end if;
    if mine is not null and mine <> target then
      update public.profiles set user_id = null, deleted_at = now(), updated_at = now() where id = mine;
      update public.team_members set profile_id = target, updated_at = now() where profile_id = mine;
      update public.training_logs set player_id = target, updated_at = now() where player_id = mine;
      update public.motion_analyses set player_id = target, updated_at = now() where player_id = mine;
      update public.attendance set player_id = target, updated_at = now() where player_id = mine;
      merged_from := mine;
    end if;
    update public.profiles set user_id = auth.uid(), updated_at = now() where id = target;
  else
    target := mine;
    if target is null then
      select raw_user_meta_data into meta from auth.users where id = auth.uid();
      target := gen_random_uuid();
      insert into public.profiles (id, user_id, display_name, created_by)
        values (target, auth.uid(), coalesce(meta ->> 'full_name', meta ->> 'name', '新球員'), auth.uid());
    end if;
  end if;

  if not exists (select 1 from public.team_members where team_id = inv.team_id and profile_id = target and deleted_at is null) then
    insert into public.team_members (id, team_id, profile_id, role) values (gen_random_uuid(), inv.team_id, target, inv.role);
  else
    update public.team_members set role = inv.role, active = true, updated_at = now()
      where team_id = inv.team_id and profile_id = target and deleted_at is null
        and (case role when 'admin' then 3 when 'coach' then 2 else 1 end) < (case inv.role when 'admin' then 3 when 'coach' then 2 else 1 end);
  end if;
  -- Single-use for roster claims; open team links stay valid until they expire.
  if inv.profile_id is not null then
    update public.invites set used_at = now(), updated_at = now() where id = inv.id;
  end if;
  return json_build_object('profile_id', target, 'merged_from', merged_from, 'team_id', inv.team_id);
end;
$$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- Approximate storage usage for the admin page (admins of any team only).
create or replace function public.db_usage() returns json
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.team_members tm join public.profiles p on p.id = tm.profile_id
    where p.user_id = auth.uid() and tm.role = 'admin' and tm.deleted_at is null
  ) then
    raise exception 'admins only';
  end if;
  return json_build_object(
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'rows', json_build_object(
      'motion_analyses', (select count(*) from public.motion_analyses),
      'game_events', (select count(*) from public.game_events),
      'training_logs', (select count(*) from public.training_logs)
    )
  );
end;
$$;
revoke all on function public.db_usage() from public, anon;
grant execute on function public.db_usage() to authenticated;

-- Keep-alive ping for the scheduled GitHub Action (touches the database).
create or replace function public.ping() returns timestamptz
language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for analysis keyframes, path "<player_id>/<analysis_id>/<event>.jpg"
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('keyframes', 'keyframes', false, 524288, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function public.keyframe_player(object_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;

create policy keyframes_select on storage.objects for select to authenticated
  using (bucket_id = 'keyframes' and public.can_access_player(public.keyframe_player(name)));
create policy keyframes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'keyframes' and public.can_access_player(public.keyframe_player(name)));
create policy keyframes_update on storage.objects for update to authenticated
  using (bucket_id = 'keyframes' and public.can_access_player(public.keyframe_player(name)));
create policy keyframes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'keyframes' and public.can_access_player(public.keyframe_player(name)));
