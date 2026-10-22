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
