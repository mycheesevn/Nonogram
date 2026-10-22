-- 001_no_foundation.sql
--
-- Nonogram foundation on the SHARED Supabase project (shared with the
-- other family games). All Nonogram objects use the `no_` prefix. The
-- `profiles` table is shared and is NEVER created here (and has NO
-- email column — email lives only in auth.users; display-name
-- fallback joins auth.users). `friendships`, `game_registry` and
-- `library_progress` are shared family objects: the registry is only
-- INSERTED into, library_progress is only ensured (create-if-missing,
-- the Checkers pattern).
--
-- Template: Sudoku 001 (sud_) with the quests/welcome block ported
-- from the fresher Checkers/Cờ Úp foundations (Sudoku's foundation
-- ships no quests — see SMOKE-REPORT.md deviations).
--
-- Contents:
--   1. no_stats                — per-player XP / record / race rating
--   2. no_leaderboard          — public leaderboard RPC (rating-first)
--   3. no_checkins + no_claim_checkin + no_checkin_history
--   4. no_quests + no_claim_welcome + no_claim_quest
--   5. no_games                — solve history (solo / daily / race)
--   6. no_rating_history       — rating sparkline points (race RPC)
--   7. no_solo_xp (internal) + no_record_game_result — solo/daily XP
--      from the LOCKED design table (design.md §6.5); daily +10 once
--      per day per SIZE, ledger = no_games itself (Sudoku pattern)
--   8. no_game_events + record_no_game_event + no_game_stats()
--   9. no_rating_progress      — caller's recent ratings (sparkline)
--  10. library_progress ensure (shared table, `no-` lesson ids)
--  11. game_registry insert   — slug 'nonogram', sort 98
--
-- Solo/daily play NEVER moves `rating` — the rating is the RACE
-- rating (pairwise Elo settled in 002's finish RPC). All statements
-- are idempotent. Run in the Dashboard SQL editor.

-- ================= 1. STATS =================
-- EXACT family shape (xp, wins, losses, draws, games_played, rating,
-- peak_rating + timestamps) plus welcome_claimed (Checkers/Cờ Úp
-- foundations carry it for the welcome-bonus RPC below).
create table if not exists no_stats (
  user_id uuid primary key references profiles(id) on delete cascade,
  xp int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  games_played int not null default 0,
  rating int not null default 800,
  peak_rating int not null default 800,
  welcome_claimed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table no_stats enable row level security;
drop policy if exists "no_stats self" on no_stats;
create policy "no_stats self" on no_stats
  for all using (auth.uid() = user_id);
drop policy if exists "no_stats leaderboard" on no_stats;
create policy "no_stats leaderboard" on no_stats
  for select using (true);

-- ================= 2. LEADERBOARD =================
-- Server-computed ranks; display names resolved server-side so the
-- shared profiles table is never exposed to anon.
create or replace function public.no_leaderboard(p_limit int default 15, p_offset int default 0)
returns table (rank bigint, user_id uuid, rating int, xp int,
               games_played int, wins int, display_name text)
language sql security definer stable set search_path = public as $$
  select row_number() over (order by s.rating desc, s.xp desc, s.user_id),
         s.user_id, s.rating, s.xp, s.games_played, s.wins,
         coalesce(nullif(p.full_name, ''), nullif(p.username, ''),
                  split_part(u.email, '@', 1), 'Player')
  from no_stats s
  join profiles p on p.id = s.user_id
  left join auth.users u on u.id = s.user_id
  order by s.rating desc, s.xp desc, s.user_id
  limit greatest(coalesce(p_limit, 15), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke all on function public.no_leaderboard(int, int) from public;
revoke all on function public.no_leaderboard(int, int) from anon;
grant execute on function public.no_leaderboard(int, int) to anon, authenticated;

-- ================= 3. DAILY CHECK-IN =================
create table if not exists no_checkins (
  user_id uuid not null references profiles(id) on delete cascade,
  checkin_date date not null,
  streak int not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, checkin_date)
);
alter table no_checkins enable row level security;
drop policy if exists "no_checkin self" on no_checkins;
create policy "no_checkin self" on no_checkins
  for all using (auth.uid() = user_id);

-- Claim semantics (family exactly): day boundary Asia/Ho_Chi_Minh;
-- streak = yesterday's streak + 1 else 1; XP = least(10 + 5*(streak-1), 40);
-- idempotent on the same day; XP lands in no_stats.
create or replace function public.no_claim_checkin()
returns table (streak int, xp_awarded int, already_claimed boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_yesterday date := v_today - 1;
  v_prev_streak int;
  v_streak int;
  v_xp int;
  v_existed boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  select exists(
    select 1 from no_checkins
    where user_id = v_uid and checkin_date = v_today
  ) into v_existed;
  if v_existed then
    select c.streak into v_streak from no_checkins c
     where c.user_id = v_uid and c.checkin_date = v_today;
    return query select v_streak, 0, true;
    return;
  end if;
  select c.streak into v_prev_streak from no_checkins c
   where c.user_id = v_uid and c.checkin_date = v_yesterday;
  v_streak := coalesce(v_prev_streak, 0) + 1;
  v_xp := least(10 + 5 * (v_streak - 1), 40);
  insert into no_checkins (user_id, checkin_date, streak)
  values (v_uid, v_today, v_streak);
  insert into no_stats (user_id, xp) values (v_uid, v_xp)
    on conflict (user_id) do update set
      xp = no_stats.xp + excluded.xp, updated_at = now();
  return query select v_streak, v_xp, false;
end $$;
revoke all on function public.no_claim_checkin() from public;
revoke all on function public.no_claim_checkin() from anon;
grant execute on function public.no_claim_checkin() to authenticated;

create or replace function public.no_checkin_history()
returns table (checkin_date date, streak int)
language sql security definer stable set search_path = public as $$
  select c.checkin_date, c.streak
  from no_checkins c
  where c.user_id = auth.uid()
  order by c.checkin_date desc
  limit 7;
$$;
revoke all on function public.no_checkin_history() from public;
revoke all on function public.no_checkin_history() from anon;
grant execute on function public.no_checkin_history() to authenticated;

-- ================= 4. QUESTS + WELCOME BONUS =================
create table if not exists no_quests (
  user_id uuid not null references profiles(id) on delete cascade,
  quest_id text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, quest_id)
);
alter table no_quests enable row level security;
drop policy if exists "no_quests self" on no_quests;
create policy "no_quests self" on no_quests
  for all using (auth.uid() = user_id);

-- Claim welcome bonus (+50 XP, one time). Returns true if newly granted.
create or replace function public.no_claim_welcome()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_already boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select welcome_claimed into v_already from no_stats where user_id = auth.uid();
  if v_already then return false; end if;
  insert into no_stats (user_id, xp, welcome_claimed)
    values (auth.uid(), 50, true)
    on conflict (user_id) do update set
      xp = no_stats.xp + 50,
      welcome_claimed = true,
      updated_at = now();
  return true;
end $$;
revoke all on function public.no_claim_welcome() from public;
revoke all on function public.no_claim_welcome() from anon;
grant execute on function public.no_claim_welcome() to authenticated;

-- Claim a quest (+20 XP each, one time per quest).
-- quest_id: 'play_1' | 'win_1' | 'join_room'
-- (join_room reads no_room_members — created in 002; plpgsql bodies
-- resolve relations at call time, the Checkers/Cờ Úp pattern.)
create or replace function public.no_claim_quest(p_quest_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_done_ok boolean := false;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_quest_id = 'play_1' then
    select exists (select 1 from no_games
      where user_id = auth.uid()) into v_done_ok;
  elsif p_quest_id = 'win_1' then
    select exists (select 1 from no_games
      where user_id = auth.uid() and result = 'win') into v_done_ok;
  elsif p_quest_id = 'join_room' then
    select exists (select 1 from no_room_members
      where user_id = auth.uid()) into v_done_ok;
  else
    return false;
  end if;
  if not v_done_ok then return false; end if;
  insert into no_quests (user_id, quest_id) values (auth.uid(), p_quest_id)
    on conflict do nothing;
  if found then
    insert into no_stats (user_id, xp) values (auth.uid(), 20)
      on conflict (user_id) do update set
        xp = no_stats.xp + 20, updated_at = now();
    return true;
  end if;
  return false;
end $$;
revoke all on function public.no_claim_quest(text) from public;
revoke all on function public.no_claim_quest(text) from anon;
grant execute on function public.no_claim_quest(text) to authenticated;

-- ================= 5. GAME HISTORY =================
-- One row per recorded game. mode: 'solo' | 'daily' | 'race'.
-- Solo/daily rows are written by no_record_game_result; race rows are
-- written by no_finish_room_match (002) with room_id/match_id set.
-- size: board size 5 | 10 | 15. tier: difficulty 1 (Easy) | 2 | 3.
-- seconds: solve time. moves: the move log text (cell-change log,
-- family replay format). perfect: 0 mistakes AND 0 hints.
create table if not exists no_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  mode text not null default 'solo' check (mode in ('solo','daily','race')),
  picture_id text not null default '',
  size int not null default 10 check (size in (5, 10, 15)),
  tier int not null default 2 check (tier between 1 and 3),
  result text not null check (result in ('win','loss','draw')),
  reason text,
  mistakes int not null default 0,
  hints_used int not null default 0,
  seconds int not null default 0,
  perfect boolean not null default false,
  moves text not null default '',
  room_id uuid,
  match_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists no_games_user_created_idx on no_games (user_id, created_at desc);
alter table no_games enable row level security;
drop policy if exists "no_games self" on no_games;
create policy "no_games self" on no_games
  for all using (auth.uid() = user_id);

-- ================= 6. RATING HISTORY =================
create table if not exists no_rating_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  rating int not null,
  xp int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists no_rating_history_user_idx on no_rating_history (user_id, created_at desc);
alter table no_rating_history enable row level security;
drop policy if exists "no_rating_history self" on no_rating_history;
create policy "no_rating_history self" on no_rating_history
  for select using (auth.uid() = user_id);

-- ================= 7. RECORD SOLO/DAILY RESULT + XP =================
-- LOCKED XP table (design.md §6.5 — do not "simplify" into a formula
-- that drifts; the CASE below IS the table):
--   win  5x5:  tier 1/2/3 = 15 / 20 / 25
--   win 10x10: tier 1/2/3 = 30 / 40 / 50
--   win 15x15: tier 1/2/3 = 55 / 70 / 90
--   loss (or draw): 5
--   daily win: +10 once per day per SIZE — the no_games row itself is
--   the claim ledger, checked BEFORE this game's row lands (Sudoku
--   pattern; there is deliberately no separate claim RPC, exactly as
--   Sudoku ships none).
-- Internal helper: only called from SECURITY DEFINER bodies.
create or replace function public.no_solo_xp(p_size int, p_tier int)
returns int language sql immutable set search_path = public as $$
  select case p_size
    when 5  then case p_tier when 1 then 15 when 2 then 20 else 25 end
    when 15 then case p_tier when 1 then 55 when 2 then 70 else 90 end
    else         case p_tier when 1 then 30 when 2 then 40 else 50 end
  end;
$$;
revoke all on function public.no_solo_xp(int, int) from public;
revoke all on function public.no_solo_xp(int, int) from anon;
revoke all on function public.no_solo_xp(int, int) from authenticated;

create or replace function public.no_record_game_result(
  p_result text,
  p_mode text,
  p_picture_id text,
  p_size int,
  p_tier int,
  p_seconds int,
  p_mistakes int,
  p_hints_used int,
  p_perfect boolean,
  p_moves text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_xp int;
  v_daily_bonus int := 0;
  v_size int := coalesce(p_size, 10);
  v_tier int := greatest(1, least(3, coalesce(p_tier, 2)));
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_result not in ('win', 'loss', 'draw') then
    raise exception 'invalid_result';
  end if;
  if coalesce(p_mode, 'solo') not in ('solo', 'daily') then
    raise exception 'invalid_mode';
  end if;
  if v_size not in (5, 10, 15) then
    raise exception 'invalid_size';
  end if;
  if p_result = 'win' and coalesce(p_mode, 'solo') = 'daily' then
    if not exists (
      select 1 from no_games
      where user_id = v_uid and mode = 'daily' and size = v_size
        and result = 'win'
        and (created_at at time zone 'Asia/Ho_Chi_Minh')::date
          = (now() at time zone 'Asia/Ho_Chi_Minh')::date
    ) then
      v_daily_bonus := 10;
    end if;
  end if;
  v_xp := (case when p_result = 'win'
             then public.no_solo_xp(v_size, v_tier)
             else 5 end) + v_daily_bonus;

  insert into no_games (user_id, mode, picture_id, size, tier, result,
                        mistakes, hints_used, seconds, perfect, moves)
  values (v_uid, coalesce(p_mode, 'solo'), coalesce(p_picture_id, ''),
          v_size, v_tier, p_result,
          greatest(0, coalesce(p_mistakes, 0)),
          greatest(0, coalesce(p_hints_used, 0)),
          greatest(0, coalesce(p_seconds, 0)),
          coalesce(p_perfect, false) and coalesce(p_mistakes, 0) = 0
            and coalesce(p_hints_used, 0) = 0,
          coalesce(p_moves, ''));
  insert into no_stats (user_id, xp, games_played, wins, losses, draws)
  values (
    v_uid,
    v_xp,
    1,
    case when p_result = 'win' then 1 else 0 end,
    case when p_result = 'loss' then 1 else 0 end,
    case when p_result = 'draw' then 1 else 0 end
  )
  on conflict (user_id) do update set
    xp = no_stats.xp + excluded.xp,
    games_played = no_stats.games_played + 1,
    wins = no_stats.wins + excluded.wins,
    losses = no_stats.losses + excluded.losses,
    draws = no_stats.draws + excluded.draws,
    updated_at = now();
  return v_xp;
end;
$$;
revoke all on function public.no_record_game_result(text, text, text, int, int, int, int, int, boolean, text) from public;
revoke all on function public.no_record_game_result(text, text, text, int, int, int, int, int, boolean, text) from anon;
grant execute on function public.no_record_game_result(text, text, text, int, int, int, int, int, boolean, text) to authenticated;

-- ================= 8. GAME EVENTS (append-only site stats) =================
create table if not exists no_game_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  event text not null check (event in ('start','finish','abandon')),
  result text check (result in ('win','loss','draw')),
  size int,
  tier int,
  created_at timestamptz not null default now()
);
create index if not exists no_game_events_created_idx on no_game_events (created_at desc);
create index if not exists no_game_events_event_idx on no_game_events (event);
alter table no_game_events enable row level security;
drop policy if exists "Anyone can record no game events" on no_game_events;
create policy "Anyone can record no game events" on no_game_events
  for insert to anon, authenticated with check (true);

-- Write path: SECURITY DEFINER, server stamps auth.uid() (guests NULL).
-- Guests may record events; XP-bearing RPCs stay authenticated-only.
create or replace function public.record_no_game_event(
  p_event text,
  p_result text default null,
  p_size int default null,
  p_tier int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('start', 'finish', 'abandon') then
    raise exception 'invalid event';
  end if;
  insert into no_game_events (user_id, event, result, size, tier)
  values (auth.uid(), p_event, p_result, p_size, p_tier);
end;
$$;
revoke all on function public.record_no_game_event(text, text, int, int) from public;
revoke all on function public.record_no_game_event(text, text, int, int) from anon;
grant execute on function public.record_no_game_event(text, text, int, int) to anon, authenticated;

-- Aggregates. Authenticated only (guests recording is fine; viewing
-- is a member surface). Buckets: {d: bucket-start date, c: count}.
create or replace function public.no_game_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r jsonb;
begin
  select jsonb_build_object(
    'plays_total',   (select count(*) from no_game_events where event = 'start'),
    'plays_member',  (select count(*) from no_game_events where event = 'start' and user_id is not null),
    'plays_guest',   (select count(*) from no_game_events where event = 'start' and user_id is null),
    'finished',      (select count(*) from no_game_events where event = 'finish'),
    'abandoned',     (select count(*) from no_game_events where event = 'abandon'),
    'members_total', (select count(*) from profiles),
    'members_today', (select count(*) from profiles where created_at >= date_trunc('day', now())),
    'members_week',  (select count(*) from profiles where created_at >= date_trunc('week', now())),
    'members_month', (select count(*) from profiles where created_at >= date_trunc('month', now())),
    'plays_daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('day', created_at)::date as d, count(*) as c
            from no_game_events where event = 'start' and created_at >= date_trunc('day', now()) - interval '29 days'
            group by 1) t),
    'plays_weekly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('week', created_at)::date as d, count(*) as c
            from no_game_events where event = 'start' and created_at >= date_trunc('week', now()) - interval '11 weeks'
            group by 1) t),
    'plays_monthly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('month', created_at)::date as d, count(*) as c
            from no_game_events where event = 'start' and created_at >= date_trunc('month', now()) - interval '11 months'
            group by 1) t),
    'plays_yearly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('year', created_at)::date as d, count(*) as c
            from no_game_events where event = 'start'
            group by 1) t),
    'members_daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('day', created_at)::date as d, count(*) as c
            from profiles where created_at >= date_trunc('day', now()) - interval '29 days'
            group by 1) t),
    'members_weekly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('week', created_at)::date as d, count(*) as c
            from profiles where created_at >= date_trunc('week', now()) - interval '11 weeks'
            group by 1) t),
    'members_monthly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('month', created_at)::date as d, count(*) as c
            from profiles where created_at >= date_trunc('month', now()) - interval '11 months'
            group by 1) t),
    'members_yearly', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'c', c) order by d), '[]'::jsonb)
      from (select date_trunc('year', created_at)::date as d, count(*) as c
            from profiles
            group by 1) t)
  ) into v_r;
  return v_r;
end;
$$;
revoke all on function public.no_game_stats() from public;
revoke all on function public.no_game_stats() from anon;
grant execute on function public.no_game_stats() to authenticated;

-- ================= 9. RATING PROGRESS (sparkline) =================
create or replace function public.no_rating_progress(p_limit int)
returns table (rating int, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select h.rating, h.created_at
  from no_rating_history h
  where h.user_id = auth.uid()
  order by h.created_at asc
  limit least(coalesce(p_limit, 60), 200);
$$;
revoke all on function public.no_rating_progress(int) from public;
revoke all on function public.no_rating_progress(int) from anon;
grant execute on function public.no_rating_progress(int) to authenticated;

-- ================= 10. LIBRARY PROGRESS (shared table) =================
-- The table already exists in the shared database (created for
-- Xiangqi); this is idempotent and only ensures the table and an
-- own-rows policy exist. Nonogram lesson ids are prefixed `no-`.
create table if not exists library_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table library_progress enable row level security;
drop policy if exists "Nonogram users manage own library progress" on library_progress;
create policy "Nonogram users manage own library progress"
  on library_progress for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ================= 11. SynerWorlds hub registration =================
-- One registry row lights Nonogram up across the whole hub (home,
-- profiles, rooms, friends-playing, activity, LFG, family
-- statistics) — the hub's aggregators loop registry rows. Column set
-- matches the sibling foundation inserts exactly. Races have no
-- colors: the match table still carries blue_id/red_id seat columns
-- (= player_ids[1] / player_ids[2], the Sudoku race convention the
-- hub reads), so match_col_a/b name those, exactly as Sudoku
-- registered. Sort 98 follows Cờ Úp at 97 (design.md §7).
insert into public.game_registry
  (slug, name_vi, name_en, tagline_vi, tagline_en, site_url, stats_source, icon, accent, sort, prefix, match_col_a, match_col_b)
values
  ('nonogram', 'Nonogram', 'Nonogram',
   'Nonogram — giải tranh logic bằng số: 3 kích cỡ, puzzle mỗi ngày, đua phòng 2–4 người',
   'Nonogram — picture logic puzzles: 3 sizes, daily puzzles, 2–4 player race rooms',
   'https://nonogram.synerworlds.com', 'no_stats', '🖼️', '#db2777', 98, 'no_', 'blue_id', 'red_id')
on conflict (slug) do update set
  name_vi = excluded.name_vi, name_en = excluded.name_en,
  tagline_vi = excluded.tagline_vi, tagline_en = excluded.tagline_en,
  site_url = excluded.site_url, stats_source = excluded.stats_source,
  icon = excluded.icon, accent = excluded.accent, sort = excluded.sort,
  prefix = excluded.prefix,
  match_col_a = excluded.match_col_a, match_col_b = excluded.match_col_b,
  active = true;

-- 002_no_rooms.sql — Rooms + challenges for Nonogram — RACE matches.
--
-- Ported from Sudoku 002 (sud_ → no_) and adapted to Nonogram's race
-- model (design.md §6.3):
--   * A match seats 2-4 players (player_ids; blue_id = player_ids[1],
--     red_id = player_ids[2] for hub compat — races have no colors,
--     these are just the first two seats).
--   * The match carries `size` + `tier` + `seed` + `picture_id`. The
--     host picks size+tier; the picture is chosen DETERMINISTICALLY
--     from the room seed: picture_id = 's<size>t<tier>-<seed % 10>'
--     and every client resolves that id against the SAME client-side
--     verified picture pool (30 pictures per size, design §6.2). The
--     answer bitmap lives client-side, exactly like Sudoku races.
--   * There are no turns. Each racer reports ONLY their own progress
--     (no_update_progress merges the caller's row into the match's
--     `progress` jsonb): pct_correct 0-100 + mistakes + finished.
--     Server enforces MONOTONIC pct and a minimum plausible elapsed
--     time per size before a finished report is accepted (§8).
--   * no_finish_room_match DERIVES the ranks server-side from the
--     reported progress (finished first → finish time → fewer
--     mistakes → higher pct), settles rank XP 15/10/7/5 through
--     no_room_xp_ledger, writes per-player no_games race rows,
--     updates no_stats counters, and applies pairwise Elo (start
--     800, K 40→24 by games played, floor 100, peak tracked).
--     Idempotent: safe to call twice / by multiple clients.
--
-- Baked-in hard lessons from the sibling games:
--  * RLS helpers is_no_room_member/is_no_room_leader are GRANTED to
--    authenticated+anon (CCT 007: revoking them broke ALL room reads,
--    because policy expressions evaluate with the CALLER's rights).
--  * Room creation goes through no_create_room() (CCT 005/Chess 015:
--    a client INSERT + read-back is invisible to its own creator).
--
-- Friends REUSE the shared `friendships` table; a challenge is a
-- per-game no_challenges row whose accept path is "join the room by
-- code" (deep link ?challenge=, family rule 2026-10-16).
-- Idempotent throughout. Run AFTER 001.

-- ================= 1. Tables =================
create table if not exists no_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  leader_id uuid references profiles(id),
  max_players int not null default 8 check (max_players between 2 and 20),
  is_public boolean not null default false,
  status text not null default 'open' check (status in ('open','playing','closed')),
  turn_order uuid[] not null default '{}',
  rules text,
  created_at timestamptz not null default now()
);
alter table no_rooms enable row level security;

create table if not exists no_room_members (
  room_id uuid not null references no_rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'player' check (role in ('player','spectator')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
alter table no_room_members enable row level security;

-- The race match table (the task brief's shorthand "no_matches";
-- named no_room_matches to match the Sudoku template's table and the
-- no_*_room_match RPC family). progress: jsonb keyed by user_id ->
-- {pct, mistakes, finished, finished_at, secs}. results at finish:
-- {ranks: int[], xp: int[]} per seat.
create table if not exists no_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  blue_id uuid references profiles(id),
  red_id uuid references profiles(id),
  player_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active','finished','cancelled')),
  picture_id text not null default '',
  size int not null default 10 check (size in (5, 10, 15)),
  tier int not null default 2 check (tier between 1 and 3),
  seed bigint,
  progress jsonb not null default '{}'::jsonb,
  results jsonb,
  result text check (result in ('blue','red','draw','multi')),
  reason text,
  winner_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table no_matches enable row level security;

create table if not exists no_room_comments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  match_id uuid references no_matches(id) on delete cascade,
  move_number int not null default 0,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table no_room_comments enable row level security;

create table if not exists no_match_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  match_id uuid not null references no_matches(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now()
);
alter table no_match_reactions enable row level security;

create table if not exists no_room_xp_ledger (
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('play','host','comment','daily')),
  ref_id uuid not null,
  day date not null default current_date,
  xp int not null,
  primary key (user_id, kind, ref_id, day)
);
alter table no_room_xp_ledger enable row level security;

-- Challenges: per-game table. room_code is denormalized onto the row
-- at creation — the challenged player is not a room member yet and
-- rooms RLS hides the room from them, so resolving the code through
-- a rooms join would silently fail (the hard-won xiangqi lesson).
create table if not exists no_challenges (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  room_code text not null,
  challenger_id uuid not null references profiles(id) on delete cascade,
  challenged_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table no_challenges enable row level security;

-- Room tournaments: DORMANT in v1. Sudoku ships no tournament table;
-- the family's bracket shape (Checkers/Cờ Úp 003/004) is a room row +
-- a pairings jsonb settled by the finish RPC. Nonogram v1 races are
-- single-picture fields, not 1v1 pairings, so only the table ships
-- here — no create/advance RPCs until a bracket design is approved.
create table if not exists no_tournaments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  name text not null default '',
  pairings jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','finished','cancelled')),
  created_at timestamptz not null default now()
);
alter table no_tournaments enable row level security;

-- ================= RLS helpers (AFTER the tables: SQL-language
-- functions resolve their relations at creation time) =================
create or replace function public.is_no_room_member(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from no_room_members where room_id = rid and user_id = auth.uid());
$$;
revoke all on function public.is_no_room_member(uuid) from public;
-- 007 LESSON (CCT): RLS policies evaluate helpers with the CALLER's
-- privileges — the helpers MUST stay executable by authenticated+anon
-- or every room read fails 42501.
grant execute on function public.is_no_room_member(uuid) to authenticated, anon;

create or replace function public.is_no_room_leader(rid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from no_rooms where id = rid and leader_id = auth.uid());
$$;
revoke all on function public.is_no_room_leader(uuid) from public;
grant execute on function public.is_no_room_leader(uuid) to authenticated, anon;

-- ================= 2. RLS policies =================
drop policy if exists "no_rooms member read" on no_rooms;
create policy "no_rooms member read" on no_rooms
  for select using (
    is_no_room_member(id) or is_public or leader_id = auth.uid()
  );
drop policy if exists "no_rooms leader insert" on no_rooms;
create policy "no_rooms leader insert" on no_rooms
  for insert to authenticated with check (auth.uid() = leader_id);
drop policy if exists "no_rooms leader update" on no_rooms;
create policy "no_rooms leader update" on no_rooms
  for update using (is_no_room_leader(id));

drop policy if exists "no_members read" on no_room_members;
create policy "no_members read" on no_room_members
  for select using (is_no_room_member(room_id));
drop policy if exists "no_members self join" on no_room_members;
create policy "no_members self join" on no_room_members
  for insert with check (auth.uid() = user_id);

drop policy if exists "no_matches member read" on no_matches;
create policy "no_matches member read" on no_matches
  for select using (is_no_room_member(room_id));
drop policy if exists "no_matches player update" on no_matches;
create policy "no_matches player update" on no_matches
  for update using (
    status = 'active' and auth.uid() = any (player_ids));

drop policy if exists "no_comments member read" on no_room_comments;
create policy "no_comments member read" on no_room_comments
  for select using (is_no_room_member(room_id));
drop policy if exists "no_comments member write" on no_room_comments;
create policy "no_comments member write" on no_room_comments
  for insert with check (is_no_room_member(room_id) and auth.uid() = user_id);

drop policy if exists "no_reactions member" on no_match_reactions;
create policy "no_reactions member" on no_match_reactions
  for all using (is_no_room_member(room_id));

drop policy if exists "no_xp self read" on no_room_xp_ledger;
create policy "no_xp self read" on no_room_xp_ledger
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "no_challenges party" on no_challenges;
create policy "no_challenges party" on no_challenges
  for select using (auth.uid() = challenger_id or auth.uid() = challenged_id);
drop policy if exists "no_challenges challenger insert" on no_challenges;
create policy "no_challenges challenger insert" on no_challenges
  for insert with check (auth.uid() = challenger_id);
drop policy if exists "no_challenges party update" on no_challenges;
create policy "no_challenges party update" on no_challenges
  for update using (auth.uid() = challenger_id or auth.uid() = challenged_id);

drop policy if exists "no_tournaments member read" on no_tournaments;
create policy "no_tournaments member read" on no_tournaments
  for select using (is_no_room_member(room_id));
drop policy if exists "no_tournaments public read" on no_tournaments;
create policy "no_tournaments public read" on no_tournaments
  for select to anon, authenticated using (
    exists (select 1 from no_rooms r
            where r.id = room_id and r.is_public and r.status <> 'closed'));

-- ================= 3. Realtime =================
do $$ begin
  alter publication supabase_realtime add table public.no_rooms;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_room_members;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_matches;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_room_comments;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_match_reactions;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_challenges;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.no_tournaments;
exception when duplicate_object then null;
end $$;

-- ================= 4. Room XP award (internal) =================
-- Inserts into the ledger (idempotent); only when the insert lands
-- does XP move into no_stats. Never granted to clients — only
-- DEFINER functions and the comment trigger call it.
create or replace function public.no_award_room_xp(
  p_user_id uuid, p_kind text, p_ref_id uuid, p_xp int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_inserted boolean := false;
begin
  insert into no_room_xp_ledger (user_id, kind, ref_id, day, xp)
  values (p_user_id, p_kind, p_ref_id, current_date, p_xp)
  on conflict do nothing
  returning true into v_inserted;
  if coalesce(v_inserted, false) then
    insert into no_stats (user_id, xp)
    values (p_user_id, p_xp)
    on conflict (user_id) do update set
      xp = no_stats.xp + excluded.xp, updated_at = now();
    return true;
  end if;
  return false;
end $$;
revoke all on function public.no_award_room_xp(uuid, text, uuid, int) from public;
revoke all on function public.no_award_room_xp(uuid, text, uuid, int) from anon;
revoke all on function public.no_award_room_xp(uuid, text, uuid, int) from authenticated;

-- ================= 5. Membership RPCs =================
create or replace function public.no_join_room(p_code text)
returns no_rooms
language plpgsql security definer set search_path = public as $$
declare
  v_room no_rooms;
  v_count int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_room from no_rooms where code = upper(trim(p_code));
  if not found then raise exception 'room_not_found'; end if;
  if exists (select 1 from no_room_members
             where room_id = v_room.id and user_id = auth.uid()) then
    return v_room; -- idempotent for existing members
  end if;
  if v_room.status = 'closed' then raise exception 'room_closed'; end if;
  select count(*) into v_count from no_room_members where room_id = v_room.id;
  if v_count >= v_room.max_players then raise exception 'room_full'; end if;
  insert into no_room_members (room_id, user_id, role)
  values (v_room.id, auth.uid(), 'player');
  if not (auth.uid() = any (v_room.turn_order)) then
    update no_rooms
      set turn_order = turn_order || auth.uid()
      where id = v_room.id
      returning * into v_room;
  end if;
  return v_room;
end $$;
revoke all on function public.no_join_room(text) from public;
revoke all on function public.no_join_room(text) from anon;
grant execute on function public.no_join_room(text) to authenticated;

create or replace function public.no_leave_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if is_no_room_leader(p_room_id) then
    raise exception 'leader_cannot_leave';
  end if;
  delete from no_room_members
    where room_id = p_room_id and user_id = auth.uid();
  update no_rooms
    set turn_order = array_remove(turn_order, auth.uid())
    where id = p_room_id;
end $$;
revoke all on function public.no_leave_room(uuid) from public;
revoke all on function public.no_leave_room(uuid) from anon;
grant execute on function public.no_leave_room(uuid) to authenticated;

create or replace function public.no_kick_member(p_room_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  if p_user_id = auth.uid() then raise exception 'cannot_kick_self'; end if;
  delete from no_room_members
    where room_id = p_room_id and user_id = p_user_id;
  update no_rooms
    set turn_order = array_remove(turn_order, p_user_id)
    where id = p_room_id;
end $$;
revoke all on function public.no_kick_member(uuid, uuid) from public;
revoke all on function public.no_kick_member(uuid, uuid) from anon;
grant execute on function public.no_kick_member(uuid, uuid) to authenticated;

create or replace function public.no_set_member_role(
  p_room_id uuid, p_user_id uuid, p_role text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_room no_rooms;
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  if p_role not in ('player','spectator') then raise exception 'invalid_role'; end if;
  select * into v_room from no_rooms where id = p_room_id;
  if p_user_id = v_room.leader_id and p_role = 'spectator' then
    raise exception 'leader_must_play';
  end if;
  update no_room_members set role = p_role
    where room_id = p_room_id and user_id = p_user_id;
  if p_role = 'spectator' then
    update no_rooms
      set turn_order = array_remove(turn_order, p_user_id)
      where id = p_room_id;
  elsif not (p_user_id = any (v_room.turn_order)) then
    update no_rooms
      set turn_order = turn_order || p_user_id
      where id = p_room_id;
  end if;
end $$;
revoke all on function public.no_set_member_role(uuid, uuid, text) from public;
revoke all on function public.no_set_member_role(uuid, uuid, text) from anon;
grant execute on function public.no_set_member_role(uuid, uuid, text) to authenticated;

create or replace function public.no_set_turn_order(p_room_id uuid, p_order uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_clean uuid[];
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  select coalesce(array_agg(m.user_id order by array_position(p_order, m.user_id)), '{}')
    into v_clean
    from no_room_members m
    where m.room_id = p_room_id and m.role = 'player'
      and m.user_id = any (p_order);
  select v_clean || coalesce(array_agg(m.user_id order by m.joined_at), '{}')
    into v_clean
    from no_room_members m
    where m.room_id = p_room_id and m.role = 'player'
      and not (m.user_id = any (v_clean));
  update no_rooms set turn_order = v_clean where id = p_room_id;
end $$;
revoke all on function public.no_set_turn_order(uuid, uuid[]) from public;
revoke all on function public.no_set_turn_order(uuid, uuid[]) from anon;
grant execute on function public.no_set_turn_order(uuid, uuid[]) to authenticated;

create or replace function public.no_close_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  update no_rooms set status = 'closed' where id = p_room_id;
end $$;
revoke all on function public.no_close_room(uuid) from public;
revoke all on function public.no_close_room(uuid) from anon;
grant execute on function public.no_close_room(uuid) to authenticated;

create or replace function public.no_update_room_rules(p_room_id uuid, p_rules text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  update no_rooms
    set rules = nullif(left(trim(coalesce(p_rules, '')), 500), '')
    where id = p_room_id;
end $$;
revoke all on function public.no_update_room_rules(uuid, text) from public;
revoke all on function public.no_update_room_rules(uuid, text) from anon;
grant execute on function public.no_update_room_rules(uuid, text) to authenticated;

create or replace function public.no_set_room_public(p_room_id uuid, p_public boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  update no_rooms set is_public = p_public where id = p_room_id;
end $$;
revoke all on function public.no_set_room_public(uuid, boolean) from public;
revoke all on function public.no_set_room_public(uuid, boolean) from anon;
grant execute on function public.no_set_room_public(uuid, boolean) to authenticated;

-- ================= 6. Create-room RPC (CCT 005 pattern) =================
create or replace function public.no_gen_room_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
begin
  loop
    v_code := '';
    for v_i in 1..6 loop
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.no_rooms r where r.code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function public.no_gen_room_code() from public;
revoke all on function public.no_gen_room_code() from anon;
revoke all on function public.no_gen_room_code() from authenticated;

create or replace function public.no_create_room(
  p_name text,
  p_is_public boolean,
  p_max_players int default 8
)
returns public.no_rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_r public.no_rooms;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  insert into public.no_rooms (code, name, leader_id, is_public, max_players, turn_order)
  values (
    public.no_gen_room_code(),
    left(coalesce(nullif(trim(p_name), ''), 'Phòng chơi'), 60),
    v_uid,
    coalesce(p_is_public, false),
    least(20, greatest(2, coalesce(p_max_players, 8))),
    array[v_uid]
  )
  returning * into v_r;
  insert into public.no_room_members (room_id, user_id, role)
  values (v_r.id, v_uid, 'player');
  return v_r;
end;
$$;
revoke all on function public.no_create_room(text, boolean, int) from public;
revoke all on function public.no_create_room(text, boolean, int) from anon;
grant execute on function public.no_create_room(text, boolean, int) to authenticated;

-- ================= 7. Match RPCs =================
-- Start a race. p_players null → seat every room player in turn
-- order (2-4 seats). Size/tier: explicit params win, else the room
-- rules JSON ({"size":10,"tier":2}), else 10 / 2. The seed is drawn
-- server-side; picture_id is derived deterministically from it so
-- every client loads the same picture from the shared pool.
create or replace function public.no_start_next_match(
  p_room_id uuid,
  p_size int default null,
  p_tier int default null,
  p_players jsonb default null
)
returns no_matches
language plpgsql security definer set search_path = public as $$
declare
  v_room no_rooms;
  v_order uuid[];
  v_match no_matches;
  v_seated uuid[];
  v_size int := 10;
  v_tier int := 2;
  v_seed bigint;
begin
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  select * into v_room from no_rooms where id = p_room_id;
  if v_room.status = 'closed' then raise exception 'room_closed'; end if;
  if exists (select 1 from no_matches
             where room_id = p_room_id and status = 'active') then
    raise exception 'match_in_progress';
  end if;
  begin
    v_size := coalesce(p_size, (v_room.rules::jsonb ->> 'size')::int, 10);
    v_tier := coalesce(p_tier, (v_room.rules::jsonb ->> 'tier')::int, 2);
  exception when others then
    v_size := coalesce(p_size, 10);
    v_tier := coalesce(p_tier, 2);
  end;
  if v_size not in (5, 10, 15) then raise exception 'invalid_size'; end if;
  v_tier := greatest(1, least(3, v_tier));
  if p_players is not null then
    select array_agg((e ->> '')::uuid) into v_order
      from jsonb_array_elements(p_players) e;
    if coalesce(array_length(v_order, 1), 0) < 2
       or coalesce(array_length(v_order, 1), 0) > 4 then
      raise exception 'invalid_players';
    end if;
    if exists (select 1 from unnest(v_order) u
               where not exists (select 1 from no_room_members m
                                 where m.room_id = p_room_id
                                   and m.user_id = u and m.role = 'player')) then
      raise exception 'not_room_players';
    end if;
  else
    select coalesce(array_agg(m.user_id order by array_position(v_room.turn_order, m.user_id)), '{}')
      into v_order
      from no_room_members m
      where m.room_id = p_room_id and m.role = 'player'
        and m.user_id = any (v_room.turn_order);
    select v_order || coalesce(array_agg(m.user_id order by m.joined_at), '{}')
      into v_order
      from no_room_members m
      where m.room_id = p_room_id and m.role = 'player'
        and not (m.user_id = any (v_order));
    if coalesce(array_length(v_order, 1), 0) < 2 then
      raise exception 'room_need_two_players';
    end if;
    v_order := v_order[1:least(4, array_length(v_order, 1))];
  end if;
  v_seated := v_order;
  v_seed := (floor(random() * 2147483646) + 1)::bigint;
  insert into no_matches (room_id, blue_id, red_id, player_ids,
                          picture_id, size, tier, seed, progress)
  values (p_room_id, v_order[1], v_order[2], v_order,
          's' || v_size || 't' || v_tier || '-' || (v_seed % 10),
          v_size, v_tier, v_seed, '{}'::jsonb)
  returning * into v_match;
  -- Rotation: seated players move to the back of the turn order so
  -- everyone cycles in across matches.
  update no_rooms
    set turn_order =
          (select coalesce(array_agg(u order by array_position(v_room.turn_order, u)), '{}')
             from unnest(v_room.turn_order) u where not (u = any (v_seated)))
          || v_seated,
        status = 'playing'
    where id = p_room_id;
  return v_match;
end $$;
revoke all on function public.no_start_next_match(uuid, int, int, jsonb) from public;
revoke all on function public.no_start_next_match(uuid, int, int, jsonb) from anon;
grant execute on function public.no_start_next_match(uuid, int, int, jsonb) to authenticated;

-- Report race progress: the caller must be seated in the match.
-- ONLY the caller's own row is merged into the match's progress
-- jsonb — nobody can forge another racer's numbers.
-- Anti-cheat gates (design §8, family pattern):
--   * pct is MONOTONIC — a decrease raises 'progress_regression';
--   * a finished report is accepted only after a minimum plausible
--     elapsed time for the size (5x5: 10s, 10x10: 30s, 15x15: 60s,
--     measured server-side from the match's created_at), else
--     'too_fast'. finished also requires pct = 100.
-- mistakes are clamped 0..3 (the 3-mistake limit ends a solo game;
-- in a race the client stops at 3 and reports finished=false with
-- pct < 100 — the finish RPC ranks unfinished by pct).
create or replace function public.no_update_progress(
  p_match_id uuid,
  p_pct int,
  p_mistakes int,
  p_finished boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_match no_matches;
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_old_pct int := 0;
  v_pct int := greatest(0, least(100, coalesce(p_pct, 0)));
  v_mistakes int := greatest(0, least(3, coalesce(p_mistakes, 0)));
  v_finished boolean := coalesce(p_finished, false);
  v_elapsed int;
  v_min_secs int;
  v_finished_at timestamptz;
  v_row jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_match from no_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if v_match.status <> 'active' then raise exception 'match_not_active'; end if;
  if not (v_uid = any (v_match.player_ids)) then
    raise exception 'not_allowed';
  end if;
  v_old := v_match.progress -> v_uid::text;
  if v_old is not null then
    v_old_pct := coalesce((v_old ->> 'pct')::int, 0);
    if coalesce((v_old ->> 'finished')::boolean, false) then
      -- Already finished: the row is frozen (first finish stands).
      return;
    end if;
  end if;
  if v_pct < v_old_pct then
    raise exception 'progress_regression';
  end if;
  v_elapsed := greatest(0, floor(extract(epoch from (now() - v_match.created_at)))::int);
  if v_finished then
    if v_pct < 100 then raise exception 'not_solved'; end if;
    v_min_secs := case v_match.size when 5 then 10 when 10 then 30 else 60 end;
    if v_elapsed < v_min_secs then raise exception 'too_fast'; end if;
    v_finished_at := now();
  end if;
  v_row := jsonb_build_object(
    'pct', v_pct,
    'mistakes', v_mistakes,
    'finished', v_finished,
    'finished_at', case when v_finished_at is null then null
                        else to_char(v_finished_at at time zone 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'secs', v_elapsed
  );
  update no_matches
    set progress = progress || jsonb_build_object(v_uid::text, v_row)
    where id = p_match_id;
end $$;
revoke all on function public.no_update_progress(uuid, int, int, boolean) from public;
revoke all on function public.no_update_progress(uuid, int, int, boolean) from anon;
grant execute on function public.no_update_progress(uuid, int, int, boolean) to authenticated;

-- Idempotent finish. Ranks are DERIVED server-side from the
-- reported progress (never trusted from a client payload):
--   finished first → earlier finished_at → fewer mistakes →
--   higher pct → seat order. Equal keys share a rank (competition
--   ranking). XP by rank 15/10/7/5 (design §6.5 — the ladder applies
--   at every field size; Sudoku's special 2P 15/5 + draw 8/8 is NOT
--   carried over, see SMOKE-REPORT.md). Anti-farm gate: someone
--   finished OR the field's total pct >= 20. Stats counters +
--   pairwise Elo settle here (K = 40 under 20 games else 24,
--   floor 100, peak tracked, ratings snapshotted pre-match).
-- Host + daily participation bonuses as in the sibling games.
-- Returns the CALLER's XP breakdown + the derived ranks.
create or replace function public.no_finish_room_match(
  p_match_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_match no_matches;
  v_room no_rooms;
  v_winner uuid;
  v_result text;
  v_n int;
  v_play int := 0;
  v_host int := 0;
  v_daily int := 0;
  v_nil uuid := '00000000-0000-0000-0000-000000000000';
  v_host_today int;
  v_ok boolean;
  v_total_pct int := 0;
  v_any_finished boolean := false;
  v_ranks int[] := '{}';
  v_xps int[] := '{}';
  v_seat int;
  v_rank int;
  v_xp int;
  v_uid uuid;
  v_opp int;
  v_rating int;
  v_opp_rating int;
  v_games int;
  v_delta int;
  v_new int;
  v_score numeric;
  v_expected numeric;
  v_k int;
  v_top_tied int := 1;
  v_ratings int[] := '{}';
  v_row jsonb;
  v_fin boolean;
  v_fin_at text;
  v_mist int;
  v_pct int;
  v_better int;
  v_o_fin boolean;
  v_o_fin_at text;
  v_o_mist int;
  v_o_pct int;
  v_o_row jsonb;
begin
  select * into v_match from no_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  select * into v_room from no_rooms where id = v_match.room_id;
  if not (auth.uid() = any (v_match.player_ids))
     and auth.uid() <> v_room.leader_id then
    raise exception 'not_allowed';
  end if;
  if v_match.status <> 'active' then
    return jsonb_build_object('play_xp', 0, 'host_xp', 0, 'daily_xp', 0,
                              'already_finished', true);
  end if;
  v_n := coalesce(array_length(v_match.player_ids, 1), 0);
  if v_n < 2 then raise exception 'invalid_players'; end if;

  -- Derive ranks.
  for v_seat in 1..v_n loop
    v_row := v_match.progress -> v_match.player_ids[v_seat]::text;
    v_total_pct := v_total_pct + coalesce((v_row ->> 'pct')::int, 0);
    if coalesce((v_row ->> 'finished')::boolean, false) then
      v_any_finished := true;
    end if;
  end loop;
  for v_seat in 1..v_n loop
    v_row := v_match.progress -> v_match.player_ids[v_seat]::text;
    v_fin := coalesce((v_row ->> 'finished')::boolean, false);
    v_fin_at := v_row ->> 'finished_at';
    v_mist := coalesce((v_row ->> 'mistakes')::int, 0);
    v_pct := coalesce((v_row ->> 'pct')::int, 0);
    v_better := 0;
    for v_opp in 1..v_n loop
      if v_opp = v_seat then continue; end if;
      v_o_row := v_match.progress -> v_match.player_ids[v_opp]::text;
      v_o_fin := coalesce((v_o_row ->> 'finished')::boolean, false);
      v_o_fin_at := v_o_row ->> 'finished_at';
      v_o_mist := coalesce((v_o_row ->> 'mistakes')::int, 0);
      v_o_pct := coalesce((v_o_row ->> 'pct')::int, 0);
      if (v_o_fin and not v_fin)
         or (v_o_fin and v_fin and coalesce(v_o_fin_at, '') < coalesce(v_fin_at, ''))
         or (v_o_fin = v_fin and v_o_mist < v_mist)
         or (v_o_fin = v_fin and v_o_mist = v_mist and v_o_pct > v_pct) then
        v_better := v_better + 1;
      end if;
    end loop;
    v_ranks := v_ranks || (v_better + 1);
  end loop;
  select count(*) into v_top_tied from unnest(v_ranks) r where r = 1;

  if v_n = 2 then
    if v_ranks[1] = v_ranks[2] then
      v_result := 'draw'; v_winner := null;
    elsif v_ranks[1] < v_ranks[2] then
      v_result := 'blue'; v_winner := v_match.player_ids[1];
    else
      v_result := 'red'; v_winner := v_match.player_ids[2];
    end if;
  else
    v_result := 'multi';
    if v_top_tied = 1 then
      select v_match.player_ids[g.i] into v_winner
        from generate_series(1, v_n) g(i) where v_ranks[g.i] = 1 limit 1;
    end if;
  end if;

  -- Per-seat race XP from the derived ranks.
  for v_seat in 1..v_n loop
    v_xp := case v_ranks[v_seat] when 1 then 15 when 2 then 10 when 3 then 7 else 5 end;
    v_xps := v_xps || v_xp;
  end loop;

  update no_matches
    set status = 'finished', result = v_result, reason = 'race',
        results = jsonb_build_object(
          'ranks', to_jsonb(v_ranks), 'xp', to_jsonb(v_xps)),
        winner_id = v_winner, finished_at = now()
    where id = p_match_id;
  update no_rooms set status = 'open'
    where id = v_match.room_id and status = 'playing';

  -- Anti-farm gate: a real race makes real progress.
  if v_any_finished or v_total_pct >= 20 then
    for v_seat in 1..v_n loop
      v_ok := no_award_room_xp(v_match.player_ids[v_seat], 'play', p_match_id, v_xps[v_seat]);
      if v_ok and auth.uid() = v_match.player_ids[v_seat] then v_play := v_xps[v_seat]; end if;
      v_ok := no_award_room_xp(v_match.player_ids[v_seat], 'daily', v_nil, 10);
      if v_ok and auth.uid() = v_match.player_ids[v_seat] then v_daily := 10; end if;
    end loop;
    select coalesce(sum(xp), 0) into v_host_today from no_room_xp_ledger
      where user_id = v_room.leader_id and kind = 'host' and day = current_date;
    if v_host_today < 10 then
      v_ok := no_award_room_xp(v_room.leader_id, 'host', p_match_id, 5);
      if v_ok and auth.uid() = v_room.leader_id then v_host := 5; end if;
    end if;

    -- History rows (mode 'race') for every seat.
    for v_seat in 1..v_n loop
      v_row := v_match.progress -> v_match.player_ids[v_seat]::text;
      insert into no_games (user_id, mode, picture_id, size, tier, result,
                            mistakes, hints_used, seconds, perfect, moves,
                            room_id, match_id)
      values (v_match.player_ids[v_seat], 'race', v_match.picture_id,
              v_match.size, v_match.tier,
              case when v_ranks[v_seat] = 1 and v_top_tied = 1 then 'win'
                   when v_ranks[v_seat] = 1 then 'draw'
                   else 'loss' end,
              coalesce((v_row ->> 'mistakes')::int, 0), 0,
              coalesce((v_row ->> 'secs')::int, 0),
              coalesce((v_row ->> 'finished')::boolean, false)
                and coalesce((v_row ->> 'mistakes')::int, 0) = 0,
              '', v_match.room_id, p_match_id);
    end loop;

    -- Stats counters + pairwise Elo (the race rating). Every
    -- ordered pair settles one Elo game: rank better = win, equal
    -- = draw. Ratings are snapshotted pre-match first.
    select coalesce(array_agg(coalesce(st.rating, 800)
                    order by array_position(v_match.player_ids, pid)), '{}')
      into v_ratings
      from unnest(v_match.player_ids) pid
      left join no_stats st on st.user_id = pid;
    for v_seat in 1..v_n loop
      v_uid := v_match.player_ids[v_seat];
      v_rank := v_ranks[v_seat];
      select games_played into v_games
        from no_stats where user_id = v_uid;
      v_rating := v_ratings[v_seat];
      v_games := coalesce(v_games, 0);
      v_delta := 0;
      for v_opp in 1..v_n loop
        if v_opp = v_seat then continue; end if;
        v_opp_rating := v_ratings[v_opp];
        v_score := case
          when v_rank < v_ranks[v_opp] then 1.0
          when v_rank = v_ranks[v_opp] then 0.5
          else 0.0 end;
        v_expected := 1.0 / (1.0 + power(10.0, (v_opp_rating - v_rating) / 400.0));
        v_k := case when v_games < 20 then 40 else 24 end;
        v_delta := v_delta + floor(v_k * (v_score - v_expected) + 0.5)::int;
      end loop;
      v_new := greatest(100, v_rating + v_delta);
      insert into no_stats (user_id, xp, games_played, wins, losses, draws, rating, peak_rating)
      values (v_uid, 0, 1,
        case when v_rank = 1 and v_top_tied = 1 then 1 else 0 end,
        case when v_rank > 1 or v_top_tied > 1 then 1 else 0 end,
        case when v_rank = 1 and v_top_tied > 1 then 1 else 0 end,
        v_new, greatest(800, v_new))
      on conflict (user_id) do update set
        games_played = no_stats.games_played + 1,
        wins = no_stats.wins + excluded.wins,
        losses = no_stats.losses + excluded.losses,
        draws = no_stats.draws + excluded.draws,
        rating = v_new,
        peak_rating = greatest(no_stats.peak_rating, v_new),
        updated_at = now();
      select xp into v_xp from no_stats where user_id = v_uid;
      insert into no_rating_history (user_id, rating, xp)
      values (v_uid, v_new, coalesce(v_xp, 0));
    end loop;
  end if;

  return jsonb_build_object('play_xp', v_play, 'host_xp', v_host,
                            'daily_xp', v_daily,
                            'ranks', to_jsonb(v_ranks),
                            'winner_id', v_winner);
end $$;
revoke all on function public.no_finish_room_match(uuid) from public;
revoke all on function public.no_finish_room_match(uuid) from anon;
grant execute on function public.no_finish_room_match(uuid) to authenticated;

create or replace function public.no_cancel_room_match(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_match no_matches;
begin
  select * into v_match from no_matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if not is_no_room_leader(v_match.room_id) then
    raise exception 'not_leader';
  end if;
  update no_matches
    set status = 'cancelled', reason = 'cancelled', finished_at = now()
    where id = p_match_id and status = 'active';
  update no_rooms set status = 'open'
    where id = v_match.room_id and status = 'playing';
end $$;
revoke all on function public.no_cancel_room_match(uuid) from public;
revoke all on function public.no_cancel_room_match(uuid) from anon;
grant execute on function public.no_cancel_room_match(uuid) to authenticated;

create or replace function public.no_rematch(p_room_id uuid)
returns no_matches
language plpgsql security definer set search_path = public as $$
declare
  v_prev no_matches;
  v_match no_matches;
  v_seed bigint;
begin
  select * into v_prev from no_matches
    where room_id = p_room_id and status = 'finished'
    order by finished_at desc nulls last, created_at desc
    limit 1;
  if not found then raise exception 'match_not_found'; end if;
  if not (auth.uid() = any (v_prev.player_ids)) then
    raise exception 'not_allowed';
  end if;
  if exists (select 1 from no_matches
             where room_id = p_room_id and status = 'active') then
    raise exception 'match_in_progress';
  end if;
  -- Same seats, same size/tier, a FRESH seed (a new picture to race on).
  v_seed := (floor(random() * 2147483646) + 1)::bigint;
  insert into no_matches (room_id, blue_id, red_id, player_ids,
                          picture_id, size, tier, seed, progress)
  values (p_room_id, v_prev.player_ids[1], v_prev.player_ids[2], v_prev.player_ids,
          's' || v_prev.size || 't' || v_prev.tier || '-' || (v_seed % 10),
          v_prev.size, v_prev.tier, v_seed, '{}'::jsonb)
  returning * into v_match;
  update no_rooms set status = 'playing' where id = p_room_id;
  return v_match;
end $$;
revoke all on function public.no_rematch(uuid) from public;
revoke all on function public.no_rematch(uuid) from anon;
grant execute on function public.no_rematch(uuid) to authenticated;

-- ================= 8. Comment XP trigger =================
-- +2 per comment with body >= 4 chars, capped at 10 XP/day; also
-- attempts the daily +10 participation award.
create or replace function public.no_award_comment_xp()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_today int;
begin
  if length(trim(new.body)) >= 4 then
    select coalesce(sum(xp), 0) into v_today from no_room_xp_ledger
      where user_id = new.user_id and kind = 'comment' and day = current_date;
    if v_today < 10 then
      perform no_award_room_xp(new.user_id, 'comment', new.id, 2);
    end if;
  end if;
  perform no_award_room_xp(
    new.user_id, 'daily', '00000000-0000-0000-0000-000000000000', 10);
  return new;
end $$;
revoke all on function public.no_award_comment_xp() from public;
revoke all on function public.no_award_comment_xp() from anon;
revoke all on function public.no_award_comment_xp() from authenticated;
drop trigger if exists no_comments_xp on no_room_comments;
create trigger no_comments_xp
  after insert on no_room_comments
  for each row execute function public.no_award_comment_xp();

-- ================= 9. Discovery & guest RPCs (anon-safe) =================
create or replace function public.no_preview_room(p_code text)
returns table (name text, member_count bigint, is_public boolean, status text, rules text)
language sql security definer stable set search_path = public as $$
  select r.name,
         (select count(*) from no_room_members m where m.room_id = r.id),
         r.is_public, r.status, r.rules
  from no_rooms r
  where r.code = upper(trim(p_code));
$$;
revoke all on function public.no_preview_room(text) from public;
grant execute on function public.no_preview_room(text) to anon, authenticated;

create or replace function public.no_list_public_rooms()
returns table (id uuid, code text, name text, member_count bigint,
               max_players int, has_active_match boolean)
language sql security definer stable set search_path = public as $$
  select r.id, r.code, r.name,
         (select count(*) from no_room_members m where m.room_id = r.id),
         r.max_players,
         exists (select 1 from no_matches mt
                 where mt.room_id = r.id and mt.status = 'active')
  from no_rooms r
  where r.is_public and r.status <> 'closed'
  order by 6 desc, 4 desc
  limit 30;
$$;
revoke all on function public.no_list_public_rooms() from public;
grant execute on function public.no_list_public_rooms() to anon, authenticated;

create or replace function public.no_room_leaderboard()
returns table (room_id uuid, name text, code text,
               matches_7d bigint, member_count bigint)
language sql security definer stable set search_path = public as $$
  select r.id, r.name, r.code,
         (select count(*) from no_matches m
          where m.room_id = r.id and m.status = 'finished'
            and m.created_at > now() - interval '7 days'),
         (select count(*) from no_room_members mb where mb.room_id = r.id)
  from no_rooms r
  where r.is_public and r.status <> 'closed'
  order by 4 desc, 5 desc
  limit 20;
$$;
revoke all on function public.no_room_leaderboard() from public;
grant execute on function public.no_room_leaderboard() to anon, authenticated;

-- Guest room detail (race shape — the Sudoku 005 fix folded in from
-- the start): profile names are resolved server-side so the profiles
-- table is never exposed to anon. Spectators see the standings
-- (progress rows), NEVER a racer's board — a Nonogram board IS the
-- answer in progress (design §6.3). Public rooms only.
create or replace function public.no_guest_room_detail(p_room_id uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  v_room no_rooms;
  v_match no_matches;
  v_result jsonb;
begin
  select * into v_room from no_rooms where id = p_room_id;
  if not found or not v_room.is_public or v_room.status = 'closed' then
    return null;
  end if;
  select * into v_match from no_matches
    where room_id = p_room_id and status = 'active'
    order by created_at desc limit 1;
  select jsonb_build_object(
    'id', v_room.id,
    'code', v_room.code,
    'name', v_room.name,
    'max_players', v_room.max_players,
    'status', v_room.status,
    'rules', v_room.rules,
    'member_count', (select count(*) from no_room_members where room_id = p_room_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(p.full_name, ''), nullif(p.username, ''),
                         split_part(u.email, '@', 1), 'Player'),
        'role', m.role) order by m.joined_at)
      from no_room_members m
      join profiles p on p.id = m.user_id
      left join auth.users u on u.id = p.id
      where m.room_id = p_room_id), '[]'::jsonb),
    'active_match', case when v_match.id is null then null else jsonb_build_object(
      'id', v_match.id,
      'blue_id', v_match.blue_id,
      'red_id', v_match.red_id,
      'player_ids', v_match.player_ids,
      'players', coalesce((
        select jsonb_agg(coalesce(nullif(p.full_name, ''), nullif(p.username, ''),
                             split_part(u.email, '@', 1), 'Player')
                         order by array_position(v_match.player_ids, pid))
        from unnest(v_match.player_ids) pid
        join profiles p on p.id = pid
        left join auth.users u on u.id = p.id), '[]'::jsonb),
      'picture_id', v_match.picture_id,
      'size', v_match.size,
      'tier', v_match.tier,
      'seed', v_match.seed,
      'progress', v_match.progress,
      'status', v_match.status) end,
    'comments', coalesce((
      select jsonb_agg(c order by created_at desc) from (
        select jsonb_build_object(
          'user_name', coalesce(nullif(p.full_name, ''), nullif(p.username, ''),
                                split_part(u.email, '@', 1), 'Player'),
          'body', cm.body,
          'created_at', cm.created_at) as c,
          cm.created_at
        from no_room_comments cm
        join profiles p on p.id = cm.user_id
        left join auth.users u on u.id = p.id
        where cm.room_id = p_room_id
        order by cm.created_at desc limit 20) t), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.no_guest_room_detail(uuid) from public;
grant execute on function public.no_guest_room_detail(uuid) to anon, authenticated;

-- ================= 10. Anon read policies for public rooms =================
-- Lets guests load the standings/comments of a public room and
-- receive realtime updates. Write access stays member-only.
drop policy if exists "no_matches public read" on no_matches;
create policy "no_matches public read" on no_matches
  for select to anon, authenticated using (
    exists (select 1 from no_rooms r
            where r.id = room_id and r.is_public and r.status <> 'closed'));
drop policy if exists "no_comments public read" on no_room_comments;
create policy "no_comments public read" on no_room_comments
  for select to anon, authenticated using (
    exists (select 1 from no_rooms r
            where r.id = room_id and r.is_public and r.status <> 'closed'));
drop policy if exists "no_reactions public read" on no_match_reactions;
create policy "no_reactions public read" on no_match_reactions
  for select to anon, authenticated using (
    exists (select 1 from no_rooms r
            where r.id = room_id and r.is_public and r.status <> 'closed'));

-- 003_no_growth.sql — Growth for Nonogram: web-push subscriptions,
-- the notification inbox, and community (UGC) puzzles.
--
-- Ported from Sudoku 003 (sud_ → no_). A community puzzle here is a
-- player-drawn picture: `art` (size rows joined by '/', '.' = empty,
-- any other char = filled, keyed into `palette`) plus its size and
-- tier. Submissions are validated client-side by the engine's solver
-- (unique + line-solvable, design §3) before insert.
--
-- Per design §6.7 the puzzle tables ship DORMANT in v1 (the Workshop
-- opens in v2) — the schema + the same dormant RPC surface Sudoku
-- ships (cards / toggle-like / record-solve), nothing more. Library
-- progress reuses the SHARED `library_progress` table with `no-`
-- lesson ids (ensured in 001). Idempotent throughout. Run AFTER 002.

-- ================= 1. Push subscriptions =================
create table if not exists no_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table no_push_subscriptions enable row level security;
drop policy if exists "no_push_subscriptions owner all" on no_push_subscriptions;
create policy "no_push_subscriptions owner all" on no_push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ================= 2. Notification inbox =================
create table if not exists no_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null, -- 'challenge' | 'challenge_declined' | 'room_start'
  title text not null,
  body text not null default '',
  url text not null default '/',
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists no_notifications_user_idx
  on no_notifications (user_id, created_at desc);
alter table no_notifications enable row level security;
drop policy if exists "no_notifications select own" on no_notifications;
create policy "no_notifications select own" on no_notifications
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "no_notifications update own" on no_notifications;
create policy "no_notifications update own" on no_notifications
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Unread count for the avatar badge. AFTER the table: language sql
-- functions resolve relations at creation time.
create or replace function public.no_unread_notifications()
returns int
language sql security definer stable set search_path = public as $$
  select count(*)::int from no_notifications
  where user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.no_unread_notifications() from public;
revoke all on function public.no_unread_notifications() from anon;
grant execute on function public.no_unread_notifications() to authenticated;

-- ================= 3. Community puzzles (UGC, dormant in v1) =================
create table if not exists no_puzzles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  picture_id text not null default '', -- optional link to a pool picture id
  size int not null default 10 check (size in (5, 10, 15)),
  tier int not null default 2 check (tier between 1 and 3),
  art text not null default '', -- size rows joined by '/'; '.' = empty
  palette jsonb not null default '{}'::jsonb, -- char -> hex color
  solves int not null default 0,
  created_at timestamptz not null default now()
);
alter table no_puzzles enable row level security;
drop policy if exists "no_puzzles public read" on no_puzzles;
create policy "no_puzzles public read" on no_puzzles
  for select to anon, authenticated using (true);
drop policy if exists "no_puzzles creator insert" on no_puzzles;
create policy "no_puzzles creator insert" on no_puzzles
  for insert to authenticated with check (auth.uid() = creator_id);
drop policy if exists "no_puzzles creator update" on no_puzzles;
create policy "no_puzzles creator update" on no_puzzles
  for update to authenticated using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);
drop policy if exists "no_puzzles creator delete" on no_puzzles;
create policy "no_puzzles creator delete" on no_puzzles
  for delete to authenticated using (auth.uid() = creator_id);

create table if not exists no_puzzle_likes (
  puzzle_id uuid not null references no_puzzles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (puzzle_id, user_id)
);
alter table no_puzzle_likes enable row level security;
drop policy if exists "no_puzzle_likes public read" on no_puzzle_likes;
create policy "no_puzzle_likes public read" on no_puzzle_likes
  for select to anon, authenticated using (true);
drop policy if exists "no_puzzle_likes self write" on no_puzzle_likes;
create policy "no_puzzle_likes self write" on no_puzzle_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "no_puzzle_likes self delete" on no_puzzle_likes;
create policy "no_puzzle_likes self delete" on no_puzzle_likes
  for delete to authenticated using (auth.uid() = user_id);

-- Puzzle cards with server-resolved creator names (profiles is never
-- exposed to anon directly; names follow full_name → username →
-- email-prefix → 'Player').
create or replace function public.no_puzzle_cards(
  p_sort text, p_limit int, p_offset int, p_mine boolean
)
returns table (
  id uuid, creator_id uuid, creator_name text, title text,
  picture_id text, size int, tier int, art text, palette jsonb,
  solves int, likes bigint, created_at timestamptz, liked_by_me boolean
)
language plpgsql security definer stable set search_path = public as $$
begin
  return query
  select pz.id, pz.creator_id,
    coalesce(nullif(p.full_name, ''), nullif(p.username, ''),
             split_part(u.email, '@', 1), 'Player') as creator_name,
    pz.title, pz.picture_id, pz.size, pz.tier, pz.art, pz.palette, pz.solves,
    (select count(*) from no_puzzle_likes l where l.puzzle_id = pz.id) as likes,
    pz.created_at,
    exists (select 1 from no_puzzle_likes l
            where l.puzzle_id = pz.id and l.user_id = auth.uid()) as liked_by_me
  from no_puzzles pz
  join profiles p on p.id = pz.creator_id
  left join auth.users u on u.id = p.id
  where (not p_mine) or pz.creator_id = auth.uid()
  order by
    case when p_sort = 'popular' then (select count(*) from no_puzzle_likes l where l.puzzle_id = pz.id) end desc,
    pz.created_at desc
  limit least(coalesce(p_limit, 10), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.no_puzzle_cards(text, int, int, boolean) from public;
revoke all on function public.no_puzzle_cards(text, int, int, boolean) from anon;
grant execute on function public.no_puzzle_cards(text, int, int, boolean) to anon, authenticated;

-- Toggle like (idempotent).
create or replace function public.no_toggle_puzzle_like(p_puzzle_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from no_puzzle_likes
             where puzzle_id = p_puzzle_id and user_id = v_uid) then
    delete from no_puzzle_likes
      where puzzle_id = p_puzzle_id and user_id = v_uid;
    return false;
  end if;
  insert into no_puzzle_likes (puzzle_id, user_id)
  values (p_puzzle_id, v_uid);
  return true;
end $$;
revoke all on function public.no_toggle_puzzle_like(uuid) from public;
revoke all on function public.no_toggle_puzzle_like(uuid) from anon;
grant execute on function public.no_toggle_puzzle_like(uuid) to authenticated;

-- Record a solve (increments the counter).
create or replace function public.no_record_puzzle_solve(p_puzzle_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update no_puzzles set solves = solves + 1 where id = p_puzzle_id;
end $$;
revoke all on function public.no_record_puzzle_solve(uuid) from public;
revoke all on function public.no_record_puzzle_solve(uuid) from anon;
grant execute on function public.no_record_puzzle_solve(uuid) to authenticated;

-- 004_no_challenge_realtime.sql — full-row realtime payloads for
-- no_challenges + no_matches (Sudoku 004, sud_ → no_).
--
-- The challenger's client subscribes to UPDATEs of its outgoing
-- challenges (filter challenger_id=eq.<uid>) to auto-enter the room
-- on accept (family standing rule 2026-10-16). With the default
-- replica identity, an UPDATE's WAL record carries only the primary
-- key + changed columns, so the filter can never match and
-- payload.new lacks room_id — the subscription silently never
-- fires. FULL identity ships the whole row. no_matches gets the same
-- treatment so room clients filtering by room_id receive complete
-- progress updates.
--
-- Run AFTER 002 (the tables must exist). Idempotent.
alter table public.no_challenges replica identity full;
alter table public.no_matches replica identity full;

-- 005_no_room_chat_delete.sql — In-room private chat + owner-only
-- room deletion (Sudoku 007 + 008 consolidated — the two files were
-- one small room add-on split by history, not by concern).
--
-- CHAT: room-scoped messages for Phòng Chơi: members of a room
-- (players AND spectators) can message each other inside the room.
-- Only room members can read or post. This is NOT the per-match race
-- comments (no_room_comments, public, tied to a match); room chat is
-- a separate, member-only stream that lives for the room.
-- Direct table access + RLS via is_no_room_member, no RPC — mirrors
-- no_room_comments exactly. v1 is insert-only, so the default
-- replica identity suffices.
--
-- DELETE: permanent soft close (no_rooms.status := 'closed'), never
-- a hard DELETE — no_room_members, no_matches, no_room_comments and
-- no_room_messages all reference no_rooms(id) on delete cascade, so
-- a hard DELETE would destroy finished-race history. The 'closed'
-- state is the family's visibility gate: no_list_public_rooms,
-- no_room_leaderboard, no_guest_room_detail and no_join_room all
-- exclude closed rooms. Guards (server-side, never UI-only):
--   * owner-only: non-owner members and non-members are denied
--     (not_leader)
--   * active-race block: deleting while any no_matches row is
--     status='active' is refused (match_in_progress).
-- There is no reopen path in the app, so closing is effectively
-- irreversible by design.
--
-- IMPORTANT (the family production lesson): this migration does NOT
-- touch the is_no_room_member / is_no_room_leader helper grants —
-- the helpers must keep EXECUTE for authenticated AND anon
-- (granted in 002).
--
-- Run AFTER 001-004. Idempotent.

create table if not exists no_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references no_rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists no_room_messages_room_idx
  on no_room_messages (room_id, created_at);

alter table no_room_messages enable row level security;

drop policy if exists "no_messages member read" on no_room_messages;
create policy "no_messages member read" on no_room_messages
  for select using (is_no_room_member(room_id));

drop policy if exists "no_messages member write" on no_room_messages;
create policy "no_messages member write" on no_room_messages
  for insert with check (is_no_room_member(room_id) and auth.uid() = user_id);

do $$ begin
  alter publication supabase_realtime add table public.no_room_messages;
exception when duplicate_object then null;
end $$;

create or replace function public.no_delete_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_active int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not is_no_room_leader(p_room_id) then raise exception 'not_leader'; end if;
  select count(*) into v_active
  from no_matches
  where room_id = p_room_id and status = 'active';
  if v_active > 0 then raise exception 'match_in_progress'; end if;
  update no_rooms set status = 'closed' where id = p_room_id;
end $$;

revoke all on function public.no_delete_room(uuid) from public;
revoke all on function public.no_delete_room(uuid) from anon;
grant execute on function public.no_delete_room(uuid) to authenticated;
