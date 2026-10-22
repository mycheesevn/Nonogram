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
