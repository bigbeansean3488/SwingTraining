-- Reference motions ("標竿動作", docs/DECISIONS.md D22): a copy of one motion
-- analysis (keypoints, events, metrics; never the video) that the team uses as
-- an imitation target, e.g. a coach's or senior player's demonstration.
--
-- Access:
--   * read:   members of the team (or only the creator when team_id is null);
--   * create: any team member, for an athlete whose data they can access;
--   * change / tombstone: the creator, or staff (coach/admin) of the team.

create table public.reference_motions (
  id uuid primary key,
  team_id uuid references public.teams (id) on delete cascade,
  -- Who performed the motion (null when unknown or not a team profile).
  player_id uuid references public.profiles (id) on delete set null,
  -- The motion_analyses row it was copied from (no FK: the source may stay local).
  source_analysis_id uuid,
  kind text not null check (kind in ('batting', 'pitching')),
  label text not null check (length(label) between 1 and 80),
  -- {arm_slot: overhand|three_quarter|sidearm|submarine, arm_action: long|short, tag: text}
  style jsonb not null default '{}'::jsonb,
  source_note text check (source_note is null or length(source_note) <= 500),
  recorded_at timestamptz,
  fps real not null,
  time_scale real not null default 1,
  forward smallint not null default 0,
  model_version text not null,
  engine_version text not null,
  events jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  keypoints text not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  check (style ->> 'arm_slot' is null
    or style ->> 'arm_slot' in ('overhand', 'three_quarter', 'sidearm', 'submarine')),
  check (style ->> 'arm_action' is null or style ->> 'arm_action' in ('long', 'short'))
);
create index on public.reference_motions (team_id, kind);
create index on public.reference_motions (server_updated_at);
create trigger touch_row before insert or update on public.reference_motions
  for each row execute function public.touch_row();
alter table public.reference_motions enable row level security;

create policy references_select on public.reference_motions for select to authenticated
  using ((team_id is not null and public.is_member(team_id)) or created_by = auth.uid());

-- Staff may also "insert" rows created by others: the sync engine edits through
-- upsert, and Postgres checks the INSERT policy on the proposed row even when the
-- statement ends up updating an existing one.
create policy references_insert on public.reference_motions for insert to authenticated
  with check (
    (created_by = auth.uid() or (team_id is not null and public.is_staff(team_id)))
    and (team_id is null or public.is_member(team_id))
    and (player_id is null or public.can_access_player(player_id))
  );

create policy references_update on public.reference_motions for update to authenticated
  using (created_by = auth.uid() or (team_id is not null and public.is_staff(team_id)))
  with check (
    (created_by = auth.uid() or (team_id is not null and public.is_staff(team_id)))
    and (team_id is null or public.is_member(team_id))
  );

-- No DELETE policy: rows are tombstoned with deleted_at so deletions sync.
