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
