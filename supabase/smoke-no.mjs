// smoke-no.mjs — grant-faithful smoke test for the Nonogram (no_)
// migration set. Runs the migration files in order against a REAL
// Postgres (PGlite/WASM) with Supabase stubs whose `profiles` matches
// production's real shape (NO email column), re-applies PASTE_ALL.sql
// (idempotency), then runs behavioral + grant probes.
//
// GRANT-FAITHFUL: no blanket function grants anywhere — privileges
// come ONLY from the migrations themselves + Postgres defaults.
// Probes run under SET ROLE anon / authenticated with a GUC-driven
// auth.uid() stub, so RLS policies and grant posture are real.
//
// Usage: node smoke-no.mjs 001_no_foundation.sql 002_no_rooms.sql \
//   003_no_growth.sql 004_no_challenge_realtime.sql \
//   005_no_room_chat_delete.sql PASTE_ALL.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid
    language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (
    id uuid primary key, username text, full_name text, birth_date date,
    avatar_url text, city text, country text,
    created_at timestamptz not null default now());
  create table public.game_registry (
    slug text primary key, name_vi text not null, name_en text not null,
    tagline_vi text, tagline_en text, site_url text not null,
    stats_source text, icon text, accent text, sort int,
    prefix text not null default '', match_col_a text, match_col_b text,
    active boolean not null default true);
  create table public.friendships (
    user_id uuid not null, friend_id uuid not null,
    primary key (user_id, friend_id));
  create publication supabase_realtime;
`);
await db.exec(`
  alter default privileges for role postgres in schema public
    grant select, insert, update, delete on tables to authenticated;
  alter default privileges for role postgres in schema public
    grant select on tables to anon;
`);

const files = process.argv.slice(2);
for (const f of files) {
  const sql = readFileSync(f, "utf8");
  try {
    await db.exec(sql);
    console.log(`OK   ${f}`);
  } catch (e) {
    console.log(`FAIL ${f}\n  ${e.message.split("\n")[0]}`);
    process.exit(1);
  }
}
console.log("MIGRATIONS APPLIED (files in order, then PASTE_ALL re-run = idempotency)");

// ---------- probe helpers ----------
let pass = 0, fail = 0;
async function asRole(role, uid) {
  await db.exec(`reset role; reset request.jwt.claim.sub;`);
  if (role) await db.exec(`set role ${role};`);
  if (uid) await db.exec(`set request.jwt.claim.sub = '${uid}';`);
}
const q = (sql) => db.query(sql);
async function ok(name, fn) {
  try { await fn(); pass++; console.log(`PASS ${name}`); }
  catch (e) { fail++; console.log(`FAIL ${name}\n  ${e.message.split("\n")[0]}`); }
}
function eq(a, b, what) {
  if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function expectDenied(name, sql) {
  try { await db.query(sql); fail++; console.log(`FAIL ${name}: expected 42501, succeeded`); }
  catch (e) {
    if (/42501|permission denied|policy/.test(e.message)) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}: wrong error: ${e.message.split("\n")[0]}`); }
  }
}
async function expectRaise(name, sql, needle) {
  try { await db.query(sql); fail++; console.log(`FAIL ${name}: expected raise ${needle}, succeeded`); }
  catch (e) {
    if (e.message.includes(needle)) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}: wrong error: ${e.message.split("\n")[0]}`); }
  }
}

// ---------- seed users ----------
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";
const D = "44444444-4444-4444-4444-444444444444";
await asRole(null, null);
for (const [u, em, fn] of [
  [A, "mai@example.com", "Mai Chi"], [B, "kien@example.com", "Kiên"],
  [C, "c@example.com", "C"], [D, "d@example.com", "D"],
]) {
  await q(`insert into auth.users (id, email) values ('${u}', '${em}')`);
  await q(`insert into profiles (id, username, full_name) values ('${u}', '${fn}', '${fn}')`);
}

// ---------- 1. registry ----------
await ok("registry row exact", async () => {
  await asRole(null, null);
  const r = await q(`select slug, prefix, stats_source, sort, accent, icon, site_url, match_col_a, match_col_b from game_registry where slug='nonogram'`);
  eq(r.rows.length, 1, "one row");
  eq(r.rows[0].prefix, "no_", "prefix"); eq(r.rows[0].stats_source, "no_stats", "stats_source");
  eq(r.rows[0].sort, 98, "sort"); eq(r.rows[0].accent, "#db2777", "accent");
  eq(r.rows[0].icon, "🖼️", "icon"); eq(r.rows[0].site_url, "https://nonogram.synerworlds.com", "site_url");
  eq(r.rows[0].match_col_a, "blue_id", "col a"); eq(r.rows[0].match_col_b, "red_id", "col b");
});

// ---------- 2. solo XP (LOCKED table) ----------
await ok("solo win 10x10 t2 -> XP 40, rating untouched", async () => {
  await asRole("authenticated", A);
  const r = await q(`select public.no_record_game_result('win','solo','cat',10,2,300,1,0,false,'log') as xp`);
  eq(r.rows[0].xp, 40, "xp");
  const s = await q(`select xp, wins, games_played, rating from no_stats where user_id='${A}'`);
  eq(s.rows[0].xp, 40, "stats xp"); eq(s.rows[0].wins, 1, "wins");
  eq(s.rows[0].games_played, 1, "games"); eq(s.rows[0].rating, 800, "solo never moves rating");
  const g = await q(`select mode, picture_id, size, tier, result, mistakes, seconds from no_games where user_id='${A}'`);
  eq(g.rows.length, 1, "game row"); eq(g.rows[0].picture_id, "cat", "picture");
  eq(g.rows[0].size, 10, "size"); eq(g.rows[0].tier, 2, "tier");
});
await ok("solo win 5x5 t1 -> 15; 15x15 t3 -> 90; loss -> 5", async () => {
  await asRole("authenticated", A);
  eq((await q(`select public.no_record_game_result('win','solo','apple',5,1,60,0,0,true,'') as xp`)).rows[0].xp, 15, "5x5 t1");
  eq((await q(`select public.no_record_game_result('win','solo','boat',15,3,900,2,1,false,'') as xp`)).rows[0].xp, 90, "15x15 t3");
  eq((await q(`select public.no_record_game_result('loss','solo','boat',15,3,120,3,0,false,'') as xp`)).rows[0].xp, 5, "loss");
  const s = await q(`select xp, games_played, wins, losses from no_stats where user_id='${A}'`);
  eq(s.rows[0].xp, 150, "total 40+15+90+5"); eq(s.rows[0].games_played, 4, "games");
  eq(s.rows[0].wins, 3, "wins"); eq(s.rows[0].losses, 1, "losses");
  const p = await q(`select perfect from no_games where user_id='${A}' and picture_id='apple'`);
  eq(p.rows[0].perfect, true, "perfect flag (0 mistakes, 0 hints)");
});
await ok("full XP table sweep (all 9 size x tier wins)", async () => {
  await asRole("authenticated", D);
  const table = { "5,1": 15, "5,2": 20, "5,3": 25, "10,1": 30, "10,2": 40, "10,3": 50, "15,1": 55, "15,2": 70, "15,3": 90 };
  for (const [k, want] of Object.entries(table)) {
    const [sz, tr] = k.split(",").map(Number);
    const r = await q(`select public.no_record_game_result('win','solo','p${sz}x${tr}',${sz},${tr},100,0,0,false,'') as xp`);
    eq(r.rows[0].xp, want, `xp ${k}`);
  }
});

// ---------- 3. daily bonus (once/day/size) ----------
await ok("daily +10 once per day per size", async () => {
  await asRole("authenticated", C);
  eq((await q(`select public.no_record_game_result('win','daily','d5',5,1,60,0,0,false,'') as xp`)).rows[0].xp, 25, "15+10 first daily 5x5");
  eq((await q(`select public.no_record_game_result('win','daily','d5b',5,2,70,0,0,false,'') as xp`)).rows[0].xp, 20, "no second bonus same size (tier irrelevant)");
  eq((await q(`select public.no_record_game_result('win','daily','d10',10,1,200,0,0,false,'') as xp`)).rows[0].xp, 40, "30+10 first daily 10x10");
  eq((await q(`select public.no_record_game_result('loss','daily','d10',10,1,50,3,0,false,'') as xp`)).rows[0].xp, 5, "daily loss pays 5, no bonus");
});

// ---------- 4. checkin / welcome / quests ----------
await ok("checkin: streak 1, +10 xp, idempotent", async () => {
  await asRole("authenticated", C);
  const r1 = await q(`select * from public.no_claim_checkin()`);
  eq(r1.rows[0].streak, 1, "streak"); eq(r1.rows[0].xp_awarded, 10, "xp"); eq(r1.rows[0].already_claimed, false, "fresh");
  const r2 = await q(`select * from public.no_claim_checkin()`);
  eq(r2.rows[0].already_claimed, true, "idempotent"); eq(r2.rows[0].xp_awarded, 0, "no double xp");
  const h = await q(`select * from public.no_checkin_history()`);
  eq(h.rows.length, 1, "history 1 row");
});
await ok("welcome +50 once; quests play_1/win_1 +20 once; bogus false", async () => {
  await asRole("authenticated", C);
  eq((await q(`select public.no_claim_welcome()`)).rows[0].no_claim_welcome, true, "welcome");
  eq((await q(`select public.no_claim_welcome()`)).rows[0].no_claim_welcome, false, "welcome once");
  eq((await q(`select public.no_claim_quest('play_1')`)).rows[0].no_claim_quest, true, "play_1");
  eq((await q(`select public.no_claim_quest('play_1')`)).rows[0].no_claim_quest, false, "play_1 once");
  eq((await q(`select public.no_claim_quest('win_1')`)).rows[0].no_claim_quest, true, "win_1");
  eq((await q(`select public.no_claim_quest('join_room')`)).rows[0].no_claim_quest, false, "join_room not yet");
  eq((await q(`select public.no_claim_quest('bogus')`)).rows[0].no_claim_quest, false, "bogus quest");
});

// ---------- 5. events + game_stats ----------
await ok("guest event record allowed; game_stats aggregates", async () => {
  await asRole("anon", null);
  await q(`select public.record_no_game_event('start', null, 10, 2)`);
  await asRole("authenticated", A);
  await q(`select public.record_no_game_event('start', null, 5, 1)`);
  await q(`select public.record_no_game_event('finish', 'win', 5, 1)`);
  const s = await q(`select public.no_game_stats() as j`);
  const j = s.rows[0].j;
  eq(j.plays_total, 2, "plays_total"); eq(j.plays_guest, 1, "guest plays");
  eq(j.plays_member, 1, "member plays"); eq(j.finished, 1, "finished");
  eq(j.members_total, 4, "members_total");
  const ev = await asRole(null, null).then(() => q(`select count(*)::int c from no_game_events where user_id is null`));
  eq(ev.rows[0].c, 1, "guest event row has NULL user");
});

// ---------- 6. race flow ----------
let roomCode, roomId, matchId;
await ok("create room via RPC; join idempotent", async () => {
  await asRole("authenticated", A);
  const r = await q(`select * from public.no_create_room('Race room', true, 8)`);
  roomCode = r.rows[0].code; roomId = r.rows[0].id;
  eq(r.rows[0].code.length, 6, "code len");
  await asRole("authenticated", B);
  eq((await q(`select * from public.no_join_room('${roomCode}')`)).rows[0].id, roomId, "join");
  eq((await q(`select * from public.no_join_room('${roomCode}')`)).rows[0].id, roomId, "join idempotent");
  await asRole(null, null);
  eq((await q(`select count(*)::int c from no_room_members where room_id='${roomId}'`)).rows[0].c, 2, "2 members");
});
await ok("non-leader cannot start; leader starts 10x10 t2 with deterministic picture", async () => {
  await asRole("authenticated", B);
  await expectRaise("start by non-leader", `select * from public.no_start_next_match('${roomId}', 10, 2)`, "not_leader");
  await asRole("authenticated", A);
  const r = await q(`select * from public.no_start_next_match('${roomId}', 10, 2)`);
  matchId = r.rows[0].id;
  eq(r.rows[0].size, 10, "size"); eq(r.rows[0].tier, 2, "tier");
  if (!/^s10t2-\d+$/.test(r.rows[0].picture_id)) throw new Error(`picture_id shape: ${r.rows[0].picture_id}`);
  eq(r.rows[0].picture_id, `s10t2-${r.rows[0].seed % 10}`, "picture derived from seed (k within tier)");
  eq(r.rows[0].blue_id, A, "blue = seat 1"); eq(r.rows[0].red_id, B, "red = seat 2");
  eq(JSON.stringify(r.rows[0].player_ids), JSON.stringify([A, B]), "player_ids");
  eq(r.rows[0].status, "active", "active");
});
await ok("progress gates: too_fast + monotonic regression rejected", async () => {
  await asRole("authenticated", A);
  await expectRaise("finished before min time (30s for 10x10)",
    `select public.no_update_progress('${matchId}', 100, 0, true)`, "too_fast");
  await q(`select public.no_update_progress('${matchId}', 50, 1, false)`);
  const p = await q(`select progress -> '${A}' as row from no_matches where id='${matchId}'`);
  eq(p.rows[0].row.pct, 50, "pct 50 stored");
  await expectRaise("pct decrease rejected",
    `select public.no_update_progress('${matchId}', 40, 1, false)`, "progress_regression");
});
await ok("progress: non-seated user rejected; finish accepted after min time", async () => {
  await asRole("authenticated", C);
  try {
    await q(`select public.no_update_progress('${matchId}', 10, 0, false)`);
    throw new Error("should have raised not_allowed");
  } catch (e) { if (!/not_allowed/.test(e.message)) throw e; }
  await asRole(null, null); // backdate the match start (test clock control)
  await q(`update no_matches set created_at = now() - interval '120 seconds' where id='${matchId}'`);
  await asRole("authenticated", A);
  await q(`select public.no_update_progress('${matchId}', 100, 1, true)`);
  const p = await q(`select progress -> '${A}' as row from no_matches where id='${matchId}'`);
  eq(p.rows[0].row.finished, true, "finished stored");
  if (!p.rows[0].row.finished_at) throw new Error("finished_at stamped");
  await asRole("authenticated", B);
  await q(`select public.no_update_progress('${matchId}', 80, 2, false)`);
});
// Hand-verified Elo, race 1: A and B both 800, both <20 games -> K=40.
// A wins: expected 0.5, delta floor(40*0.5+0.5)=20 -> 820.
// B loses: delta floor(40*(-0.5)+0.5)=floor(-19.5)=-20 -> 780.
await ok("finish race 1: derived ranks, XP 15/10, Elo 820/780, idempotent", async () => {
  await asRole("authenticated", A);
  const bx = await q(`select coalesce((select xp from no_stats where user_id='${B}'),0) as xp`);
  const r = await q(`select public.no_finish_room_match('${matchId}') as j`);
  const j = r.rows[0].j;
  eq(j.play_xp, 15, "winner play xp"); eq(j.host_xp, 5, "host xp"); eq(j.daily_xp, 10, "daily xp");
  eq(JSON.stringify(j.ranks), JSON.stringify([1, 2]), "derived ranks");
  eq(j.winner_id, A, "winner");
  const sa = await q(`select rating, xp, games_played, wins from no_stats where user_id='${A}'`);
  eq(sa.rows[0].rating, 820, "A rating 800+20"); eq(sa.rows[0].xp, 180, "A xp 150 solo +15+5+10");
  eq(sa.rows[0].games_played, 5, "A games 4 solo +1 race"); eq(sa.rows[0].wins, 4, "A wins");
  const sb = await q(`select rating, xp, games_played, losses from no_stats where user_id='${B}'`);
  eq(sb.rows[0].rating, 780, "B rating 800-20"); eq(sb.rows[0].xp, bx.rows[0].xp + 20, "B xp +10 play +10 daily");
  eq(sb.rows[0].games_played, 1, "B games"); eq(sb.rows[0].losses, 1, "B losses");
  await asRole(null, null); // count as owner: RLS would hide the other seat's rows
  const g = await q(`select count(*)::int c from no_games where match_id='${matchId}' and mode='race'`);
  eq(g.rows[0].c, 2, "race history rows for both seats");
  const h = await q(`select count(*)::int c from no_rating_history where user_id in ('${A}','${B}')`);
  eq(h.rows[0].c, 2, "rating history snapshots");
  await asRole("authenticated", A);
  const r2 = await q(`select public.no_finish_room_match('${matchId}') as j`);
  eq(r2.rows[0].j.play_xp, 0, "re-finish pays 0");
  eq(r2.rows[0].j.already_finished, true, "already_finished flag");
  eq((await q(`select xp from no_stats where user_id='${A}'`)).rows[0].xp, 180, "no double award");
});
// Hand-verified Elo, race 2 (K split): A set to 25 games -> K=24, rating 820.
// C is 800 with 4 games -> K=40. A beats C.
// A expected = 1/(1+10^((800-820)/400)) = 1/(1+10^-0.05) = 0.52875
//   delta = floor(24*(1-0.52875)+0.5) = floor(11.81) = 11 -> 831.
// C expected = 0.47125, delta = floor(40*(0-0.47125)+0.5) = floor(-18.35) = -19 -> 781.
await ok("race 2: K=24 for veteran, K=40 for newcomer (831 / 781)", async () => {
  await asRole(null, null);
  await q(`update no_stats set games_played = 25 where user_id='${A}'`);
  await asRole("authenticated", A);
  const rm = await q(`select * from public.no_create_room('K room', false, 4)`);
  await asRole("authenticated", C);
  await q(`select * from public.no_join_room('${rm.rows[0].code}')`);
  await asRole("authenticated", A);
  const m = await q(`select * from public.no_start_next_match('${rm.rows[0].id}', 5, 1)`);
  await asRole(null, null);
  await q(`update no_matches set created_at = now() - interval '120 seconds' where id='${m.rows[0].id}'`);
  await asRole("authenticated", A);
  await q(`select public.no_update_progress('${m.rows[0].id}', 100, 0, true)`);
  await asRole("authenticated", C);
  await q(`select public.no_update_progress('${m.rows[0].id}', 10, 3, false)`);
  const r = await q(`select public.no_finish_room_match('${m.rows[0].id}') as j`);
  eq(JSON.stringify(r.rows[0].j.ranks), JSON.stringify([1, 2]), "ranks");
  eq((await q(`select rating from no_stats where user_id='${A}'`)).rows[0].rating, 831, "A 820+11 (K24)");
  eq((await q(`select rating from no_stats where user_id='${C}'`)).rows[0].rating, 781, "C 800-19 (K40)");
});
// Hand-verified Elo, race 3 (floor): D set to rating 100. B (780) beats D.
// D expected = 1/(1+10^((780-100)/400)) = 1/(1+10^1.7) = 0.01957
//   delta = floor(40*(0-0.01957)+0.5) = floor(-0.28) = -1 -> 99 -> floored 100.
// B expected = 0.98043, delta = floor(40*0.01957+0.5) = floor(1.28) = 1 -> 781.
await ok("race 3: rating floor 100 holds", async () => {
  await asRole(null, null);
  await q(`insert into no_stats (user_id, rating, peak_rating) values ('${D}', 100, 800)
           on conflict (user_id) do update set rating = 100 where no_stats.user_id = '${D}'`);
  await asRole("authenticated", B);
  const rm = await q(`select * from public.no_create_room('Floor room', false, 4)`);
  await asRole("authenticated", D);
  await q(`select * from public.no_join_room('${rm.rows[0].code}')`);
  await asRole("authenticated", B);
  const m = await q(`select * from public.no_start_next_match('${rm.rows[0].id}', 5, 1)`);
  await asRole(null, null);
  await q(`update no_matches set created_at = now() - interval '120 seconds' where id='${m.rows[0].id}'`);
  await asRole("authenticated", B);
  await q(`select public.no_update_progress('${m.rows[0].id}', 100, 0, true)`);
  await asRole("authenticated", D);
  await q(`select public.no_update_progress('${m.rows[0].id}', 30, 1, false)`);
  await q(`select public.no_finish_room_match('${m.rows[0].id}')`);
  eq((await q(`select rating from no_stats where user_id='${D}'`)).rows[0].rating, 100, "D floored at 100");
  eq((await q(`select rating from no_stats where user_id='${B}'`)).rows[0].rating, 781, "B 780+1");
});

// ---------- 7. comments / chat / challenges ----------
await ok("comment XP trigger (+2)", async () => {
  await asRole("authenticated", B);
  const before = (await q(`select xp from no_stats where user_id='${B}'`)).rows[0].xp;
  await q(`insert into no_room_comments (room_id, user_id, body, move_number) values ('${roomId}','${B}','Nice solve!',0)`);
  const after = (await q(`select xp from no_stats where user_id='${B}'`)).rows[0].xp;
  eq(after - before, 2, "comment +2 (daily already paid by race 1)");
});
await ok("room chat: members only", async () => {
  await asRole("authenticated", A);
  await q(`insert into no_room_messages (room_id, user_id, body) values ('${roomId}','${A}','gg!')`);
  eq((await q(`select count(*)::int c from no_room_messages where room_id='${roomId}'`)).rows[0].c, 1, "member reads chat");
  await asRole("authenticated", C);
  eq((await q(`select count(*)::int c from no_room_messages where room_id='${roomId}'`)).rows[0].c, 0, "non-member reads none");
  await expectDenied("non-member cannot post chat",
    `insert into no_room_messages (room_id, user_id, body) values ('${roomId}','${C}','hi')`);
});
await ok("challenge flow with denormalized room_code", async () => {
  await asRole("authenticated", A);
  const rm = await q(`select * from public.no_create_room('duel', false, 2)`);
  await q(`insert into no_challenges (challenger_id, challenged_id, room_id, room_code)
           values ('${A}','${D}','${rm.rows[0].id}','${rm.rows[0].code}')`);
  await asRole("authenticated", D);
  const ch = await q(`select room_code, status from no_challenges where challenged_id='${D}'`);
  eq(ch.rows[0].room_code, rm.rows[0].code, "room_code visible pre-join");
  await q(`update no_challenges set status='accepted' where challenged_id='${D}'`);
  await q(`select * from public.no_join_room('${rm.rows[0].code}')`);
  await asRole(null, null);
  eq((await q(`select count(*)::int c from no_room_members where room_id='${rm.rows[0].id}'`)).rows[0].c, 2, "both in room after accept-join");
});

// ---------- 8. room delete ----------
await ok("delete room: not_leader, active-match block, then closes", async () => {
  await asRole("authenticated", B);
  await expectRaise("non-leader delete", `select public.no_delete_room('${roomId}')`, "not_leader");
  await asRole("authenticated", A);
  const rm = await q(`select * from public.no_create_room('del room', false, 4)`);
  await asRole("authenticated", B);
  await q(`select * from public.no_join_room('${rm.rows[0].code}')`);
  await asRole("authenticated", A);
  const m = await q(`select * from public.no_start_next_match('${rm.rows[0].id}', 5, 1)`);
  await expectRaise("delete during active match", `select public.no_delete_room('${rm.rows[0].id}')`, "match_in_progress");
  await q(`select public.no_cancel_room_match('${m.rows[0].id}')`);
  await q(`select public.no_delete_room('${rm.rows[0].id}')`);
  await asRole(null, null);
  eq((await q(`select status from no_rooms where id='${rm.rows[0].id}'`)).rows[0].status, "closed", "closed");
  // A non-member joining a closed room is refused (existing members
  // short-circuit idempotently first — Sudoku's exact join shape).
  await asRole("authenticated", C);
  await expectRaise("join closed room", `select * from public.no_join_room('${rm.rows[0].code}')`, "room_closed");
});

// ---------- 9. growth: puzzles / push / notifications ----------
await ok("dormant puzzles: create, anon cards, like, solve counter", async () => {
  await asRole("authenticated", A);
  const p = await q(`insert into no_puzzles (creator_id, title, size, tier, art, palette)
    values ('${A}','Tiny cat',5,1,'.....','{}'::jsonb) returning id`);
  const pid = p.rows[0].id;
  await asRole("anon", null);
  const cards = await q(`select * from public.no_puzzle_cards('new',10,0,false)`);
  eq(cards.rows.length, 1, "anon sees card"); eq(cards.rows[0].liked_by_me, false, "anon like state");
  await asRole("authenticated", B);
  eq((await q(`select public.no_toggle_puzzle_like('${pid}')`)).rows[0].no_toggle_puzzle_like, true, "like on");
  eq((await q(`select public.no_toggle_puzzle_like('${pid}')`)).rows[0].no_toggle_puzzle_like, false, "like off (toggle)");
  await q(`select public.no_record_puzzle_solve('${pid}')`);
  await asRole(null, null);
  eq((await q(`select solves from no_puzzles where id='${pid}'`)).rows[0].solves, 1, "solves incremented");
});
await ok("push owner-only; notifications server-written + unread count", async () => {
  await asRole("authenticated", A);
  await q(`insert into no_push_subscriptions (user_id, endpoint, p256dh, auth) values ('${A}','https://x','p','a')`);
  await asRole("authenticated", B);
  eq((await q(`select count(*)::int c from no_push_subscriptions`)).rows[0].c, 0, "B cannot read A's subscription");
  await asRole("authenticated", A);
  await expectDenied("no client insert on notifications",
    `insert into no_notifications (user_id, kind, title) values ('${A}','challenge','t')`);
  await asRole(null, null);
  await q(`insert into no_notifications (user_id, kind, title, url) values ('${A}','challenge','Thách đấu!','/?room=${roomCode}')`);
  await asRole("authenticated", A);
  eq((await q(`select public.no_unread_notifications()`)).rows[0].no_unread_notifications, 1, "unread 1");
});

// ---------- 10. grant posture ----------
await ok("grant posture probes", async () => {
  await asRole("anon", null);
  await expectDenied("anon cannot record solo result", `select public.no_record_game_result('win','solo','x',5,1,10,0,0,false,'')`);
  await expectDenied("anon cannot claim checkin", `select * from public.no_claim_checkin()`);
  await expectDenied("anon cannot claim welcome", `select public.no_claim_welcome()`);
  await expectDenied("anon cannot read game_stats aggregate", `select public.no_game_stats()`);
  await expectDenied("anon cannot finish a match", `select public.no_finish_room_match('${matchId}')`);
  await expectDenied("anon cannot delete a room", `select public.no_delete_room('${roomId}')`);
  await expectDenied("anon cannot call award_room_xp", `select public.no_award_room_xp('${A}','play','${A}',5)`);
  await expectDenied("anon cannot call gen_room_code", `select public.no_gen_room_code()`);
  await expectDenied("anon cannot call solo_xp helper", `select public.no_solo_xp(10,2)`);
  // anon CAN: events, discovery, leaderboard, puzzle cards, RLS helpers
  await q(`select public.record_no_game_event('start', null, 5, 1)`);
  await q(`select * from public.no_preview_room('${roomCode}')`);
  await q(`select * from public.no_list_public_rooms()`);
  await q(`select * from public.no_room_leaderboard()`);
  await q(`select * from public.no_leaderboard(15, 0)`);
  await q(`select public.no_guest_room_detail('${roomId}')`);
  await q(`select public.is_no_room_member('${roomId}')`);
  await asRole("authenticated", A);
  await expectDenied("authenticated cannot call award_room_xp", `select public.no_award_room_xp('${A}','play','${A}',5)`);
  await expectDenied("authenticated cannot call gen_room_code", `select public.no_gen_room_code()`);
  await expectDenied("authenticated cannot call solo_xp helper", `select public.no_solo_xp(10,2)`);
  await q(`select public.is_no_room_leader('${roomId}')`);
});

// ---------- 11. RLS isolation + leaderboard + guest detail ----------
await ok("RLS isolation + leaderboard + guest detail", async () => {
  await asRole("authenticated", B);
  eq((await q(`select count(*)::int c from no_games`)).rows[0].c, 2, "B sees only own games (2 race rows)");
  await asRole("authenticated", A);
  if ((await q(`select count(*)::int c from no_games`)).rows[0].c < 6) throw new Error("A should see own rows");
  await asRole("anon", null);
  const lb = await q(`select * from public.no_leaderboard(15,0)`);
  if (lb.rows.length === 0) throw new Error("leaderboard empty");
  eq(String(lb.rows[0].rank), "1", "rank 1 first");
  eq(lb.rows[0].user_id, A, "A leads on rating (831)");
  const gd = await q(`select public.no_guest_room_detail('${roomId}') as j`);
  eq(gd.rows[0].j.code, roomCode, "guest detail carries code");
  eq(gd.rows[0].j.member_count, 2, "guest detail member count");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
