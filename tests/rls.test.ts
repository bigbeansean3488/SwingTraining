// Runs the real migration in PGlite (Postgres in WASM) with stub Supabase
// `auth` and `storage` schemas, then checks the row-level security rules by
// acting as different users.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const STUB = `
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
alter table storage.objects enable row level security;
create role authenticated;
create role anon;
`;

const GRANTS = `
grant usage on schema public, auth, storage to authenticated, anon;
grant select, insert, update on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to authenticated, anon;
`;

const U = {
  coach: '00000000-0000-4000-8000-00000000000c',
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  out: '00000000-0000-4000-8000-0000000000ff',
};
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const P = { coach: id(1), rosterA: id(2), rosterB: id(3), meA: id(4), out: id(5) };
const T = id(100);
const NOW = '2026-11-14T00:00:00Z';

let db: PGlite;

async function as<T = Record<string, unknown>>(
  user: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

async function fails(user: string, sql: string, params: unknown[] = []) {
  try {
    await as(user, sql, params);
    return false;
  } catch {
    return true;
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  await db.exec(GRANTS);
  await db.exec(`insert into auth.users (id, raw_user_meta_data) values
    ('${U.coach}', '{"full_name":"教練"}'), ('${U.a}', '{"full_name":"小明"}'),
    ('${U.b}', '{"full_name":"小華"}'), ('${U.out}', '{}')`);

  // Coach: own profile, team, admin membership (bootstrap), two roster entries.
  await as(
    U.coach,
    `insert into profiles (id, user_id, display_name, created_by) values ($1, $2, '教練', $2)`,
    [P.coach, U.coach],
  );
  await as(U.coach, `insert into teams (id, name, created_by) values ($1, '成大棒球隊', $2)`, [
    T,
    U.coach,
  ]);
  await as(
    U.coach,
    `insert into team_members (id, team_id, profile_id, role) values ($1, $2, $3, 'admin')`,
    [id(200), T, P.coach],
  );
  for (const [pid, name, mid] of [
    [P.rosterA, '小明', id(201)],
    [P.rosterB, '小華', id(202)],
  ] as const) {
    await as(U.coach, `insert into profiles (id, display_name, created_by) values ($1, $2, $3)`, [
      pid,
      name,
      U.coach,
    ]);
    await as(
      U.coach,
      `insert into team_members (id, team_id, profile_id, role) values ($1, $2, $3, 'player')`,
      [mid, T, pid],
    );
  }
  // Invites: claim roster A; open link for B.
  await as(
    U.coach,
    `insert into invites (id, team_id, token, role, profile_id, expires_at, created_by)
    values ($1, $2, 'claim-token-aaaaaaaa', 'player', $3, now() + interval '7 days', $4)`,
    [id(300), T, P.rosterA, U.coach],
  );
  await as(
    U.coach,
    `insert into invites (id, team_id, token, role, profile_id, expires_at, created_by)
    values ($1, $2, 'open-token-bbbbbbbbb', 'player', null, now() + interval '7 days', $3)`,
    [id(301), T, U.coach],
  );

  // Player A signed up earlier on their own and has an analysis under their own profile.
  await as(
    U.a,
    `insert into profiles (id, user_id, display_name, created_by) values ($1, $2, '我', $2)`,
    [P.meA, U.a],
  );
  await as(
    U.a,
    `insert into motion_analyses (id, player_id, kind, recorded_at, fps, model_version, engine_version, keypoints)
    values ($1, $2, 'batting', $3, 240, 'm', '1.0.0', 'gz:')`,
    [id(400), P.meA, NOW],
  );
  // Outsider with their own profile.
  await as(
    U.out,
    `insert into profiles (id, user_id, display_name, created_by) values ($1, $2, '路人', $2)`,
    [P.out, U.out],
  );
});

describe('row-level security', () => {
  it('player A claims the roster entry and their earlier data moves with them', async () => {
    const [r] = await as<{ accept_invite: { profile_id: string; merged_from: string } }>(
      U.a,
      `select accept_invite('claim-token-aaaaaaaa')`,
    );
    expect(r!.accept_invite.profile_id).toBe(P.rosterA);
    expect(r!.accept_invite.merged_from).toBe(P.meA);
    const rows = await as<{ player_id: string }>(U.a, `select player_id from motion_analyses`);
    expect(rows.map((x) => x.player_id)).toEqual([P.rosterA]);
  });

  it('player B joins through the open link and gets a new profile', async () => {
    const [r] = await as<{ accept_invite: { profile_id: string } }>(
      U.b,
      `select accept_invite('open-token-bbbbbbbbb')`,
    );
    const pid = r!.accept_invite.profile_id;
    const [p] = await as<{ display_name: string }>(
      U.b,
      `select display_name from profiles where id = $1`,
      [pid],
    );
    expect(p!.display_name).toBe('小華');
    await as(
      U.b,
      `insert into motion_analyses (id, player_id, kind, recorded_at, fps, model_version, engine_version, keypoints)
      values ($1, $2, 'pitching', $3, 240, 'm', '1.0.0', 'gz:')`,
      [id(401), pid, NOW],
    );
  });

  it('a claim invite cannot be reused', async () => {
    expect(await fails(U.b, `select accept_invite('claim-token-aaaaaaaa')`)).toBe(true);
  });

  it('players see only their own analyses; the coach sees the whole team', async () => {
    expect((await as(U.a, `select id from motion_analyses`)).length).toBe(1);
    expect((await as(U.b, `select id from motion_analyses`)).length).toBe(1);
    expect((await as(U.coach, `select id from motion_analyses`)).length).toBe(2);
  });

  it('non-members can read nothing of the team', async () => {
    expect(await as(U.out, `select id from motion_analyses`)).toEqual([]);
    expect(await as(U.out, `select id from teams`)).toEqual([]);
    expect(await as(U.out, `select id from team_members`)).toEqual([]);
    const names = (
      await as<{ display_name: string }>(U.out, `select display_name from profiles`)
    ).map((x) => x.display_name);
    expect(names).toEqual(['路人']);
    expect(await as(null, `select id from profiles`).catch(() => [])).toEqual([]);
  });

  it("a player cannot write another player's data", async () => {
    expect(
      await fails(
        U.a,
        `insert into training_logs (id, player_id, date, kind) values ($1, $2, '2026-11-14', 'batting')`,
        [id(500), P.rosterB],
      ),
    ).toBe(true);
    const upd = await as(U.a, `update motion_analyses set note = 'x' where id = $1 returning id`, [
      id(401),
    ]);
    expect(upd).toEqual([]);
    // Positive controls: the same statements succeed for those allowed to make them.
    await as(
      U.coach,
      `insert into training_logs (id, player_id, date, kind) values ($1, $2, '2026-11-14', 'batting')`,
      [id(501), P.rosterB],
    );
    await as(
      U.a,
      `insert into training_logs (id, player_id, date, kind) values ($1, $2, '2026-11-14', 'batting')`,
      [id(502), P.rosterA],
    );
    expect(
      (
        await as(U.coach, `update motion_analyses set note = 'x' where id = $1 returning id`, [
          id(401),
        ])
      ).length,
    ).toBe(1);
  });

  it('a player cannot hijack another profile or promote themself', async () => {
    const r = await as(U.a, `update profiles set user_id = $1 where id = $2 returning id`, [
      U.a,
      P.rosterB,
    ]);
    expect(r).toEqual([]);
    expect(
      await fails(
        U.a,
        `insert into team_members (id, team_id, profile_id, role) values ($1, $2, $3, 'admin')`,
        [id(600), T, P.rosterA],
      ),
    ).toBe(true);
  });

  it('coaches write games; players read but cannot write them', async () => {
    await as(
      U.coach,
      `insert into games (id, team_id, opponent, game_date, home_away, mode) values ($1, $2, '交大', '2026-11-20', 'home', 'simple')`,
      [id(700), T],
    );
    expect((await as(U.a, `select id from games`)).length).toBe(1);
    expect(
      await fails(
        U.a,
        `insert into games (id, team_id, opponent, game_date, home_away, mode) values ($1, $2, 'x', '2026-11-20', 'home', 'simple')`,
        [id(701), T],
      ),
    ).toBe(true);
    expect(
      await fails(
        U.a,
        `insert into game_events (id, game_id, team_id, seq, type) values ($1, $2, $3, 1, 'pa')`,
        [id(702), id(700), T],
      ),
    ).toBe(true);
    await as(
      U.coach,
      `insert into game_events (id, game_id, team_id, seq, type) values ($1, $2, $3, 1, 'pa')`,
      [id(703), id(700), T],
    );
  });

  it('players answer attendance only for themselves and see only their own replies', async () => {
    await as(
      U.coach,
      `insert into events (id, team_id, kind, title, starts_at) values ($1, $2, 'training', '練習', now())`,
      [id(800), T],
    );
    await as(
      U.a,
      `insert into attendance (id, event_id, team_id, player_id, status) values ($1, $2, $3, $4, 'yes')`,
      [id(801), id(800), T, P.rosterA],
    );
    expect(
      await fails(
        U.a,
        `insert into attendance (id, event_id, team_id, player_id, status) values ($1, $2, $3, $4, 'no')`,
        [id(802), id(800), T, P.rosterB],
      ),
    ).toBe(true);
    const bProfile = (
      await as<{ id: string }>(U.b, `select id from profiles where user_id = $1`, [U.b])
    )[0]!.id;
    await as(
      U.b,
      `insert into attendance (id, event_id, team_id, player_id, status) values ($1, $2, $3, $4, 'no')`,
      [id(803), id(800), T, bProfile],
    );
    expect((await as(U.a, `select id from attendance`)).length).toBe(1);
    expect((await as(U.coach, `select id from attendance`)).length).toBe(2);
  });

  it('last write wins: an older client change does not overwrite a newer one', async () => {
    await as(
      U.a,
      `update motion_analyses set note = 'new', updated_at = '2099-01-02T00:00:00Z' where id = $1`,
      [id(400)],
    );
    await as(
      U.a,
      `update motion_analyses set note = 'old', updated_at = '2099-01-01T00:00:00Z' where id = $1`,
      [id(400)],
    );
    const [r] = await as<{ note: string }>(U.a, `select note from motion_analyses where id = $1`, [
      id(400),
    ]);
    expect(r!.note).toBe('new');
  });

  it('upsert (as the sync engine does) respects last write wins', async () => {
    await as(
      U.a,
      `insert into motion_analyses (id, player_id, kind, recorded_at, fps, model_version, engine_version, keypoints, note, updated_at)
      values ($1, $2, 'batting', $3, 240, 'm', '1.0.0', 'gz:', 'stale', '2000-01-01T00:00:00Z')
      on conflict (id) do update set note = excluded.note, updated_at = excluded.updated_at`,
      [id(400), P.rosterA, NOW],
    );
    const [r] = await as<{ note: string }>(U.a, `select note from motion_analyses where id = $1`, [
      id(400),
    ]);
    expect(r!.note).toBe('new');
  });

  it('only the athlete and staff can mark an analysis as good', async () => {
    await as(U.b, `update motion_analyses set marked_good = true where id = $1`, [id(400)]);
    const q = `select marked_good from motion_analyses where id = $1`;
    expect((await as<{ marked_good: boolean }>(U.a, q, [id(400)]))[0]!.marked_good).toBe(false);
    await as(U.a, `update motion_analyses set marked_good = true where id = $1`, [id(400)]);
    expect((await as<{ marked_good: boolean }>(U.a, q, [id(400)]))[0]!.marked_good).toBe(true);
    await as(U.coach, `update motion_analyses set marked_good = false where id = $1`, [id(400)]);
    expect((await as<{ marked_good: boolean }>(U.a, q, [id(400)]))[0]!.marked_good).toBe(false);
  });

  it('keyframe storage follows player access', async () => {
    await as(
      U.a,
      `insert into storage.objects (bucket_id, name, metadata) values ('keyframes', $1, '{"size": 100}')`,
      [`${P.rosterA}/${id(400)}/plant.jpg`],
    );
    expect(
      await fails(U.a, `insert into storage.objects (bucket_id, name) values ('keyframes', $1)`, [
        `${P.rosterB}/x/plant.jpg`,
      ]),
    ).toBe(true);
    expect((await as(U.coach, `select name from storage.objects`)).length).toBe(1);
    expect(await as(U.out, `select name from storage.objects`)).toEqual([]);
  });

  it('only admins can read database usage', async () => {
    const [r] = await as<{ db_usage: { db_bytes: number } }>(U.coach, `select db_usage()`);
    expect(r!.db_usage.db_bytes).toBeGreaterThan(0);
    expect(await fails(U.a, `select db_usage()`)).toBe(true);
  });
});
