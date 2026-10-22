# Nonogram (no_) SQL — Smoke Report

Date: 2026-10-21 (CDT) · Harness: `smoke-no.mjs` (grant-faithful PGlite,
modeled on `~/workspace/tools/chk-sql-smoke.mjs`) · Template: Sudoku
migrations 001–008 (`sud_` → `no_`), cross-checked against
Checkers/Cờ Úp foundations for the blocks Sudoku lacks.

## Result

**43 passed, 0 failed** — run twice with identical results:

1. Files `001…005` in order, then `PASTE_ALL.sql` re-applied on top
   (idempotency on a populated schema).
2. `PASTE_ALL.sql` alone on a fresh stub database (standalone
   completeness).

The 43 PASS lines comprise 24 behavioral test blocks + 19 inner
grant/raise probes (`expectDenied`/`expectRaise`, counted individually
by the harness); the blocks contain **81 `eq()` value assertions**
(exact XP amounts, ratings, row fields, counts). Migration application
itself: `OK` for all 6 inputs in both runs.

Static audits (scripted, re-runnable):

- **No bare DELETE/UPDATE**: every `UPDATE`/`DELETE FROM` statement in
  001–005 + PASTE_ALL carries a `WHERE` in the same statement — **0
  violations** (production pg_safeupdate rule).
- **plpgsql variables**: every `DECLARE`d variable is `v_`-prefixed —
  **0 violations** (the Sudoku template's own unprefixed `xp` declare,
  a known family landmine, was not copied).
- **Grants**: every SECURITY DEFINER function does
  `revoke all … from public` AND `… from anon` with explicit grants;
  internal helpers (`no_award_room_xp`, `no_gen_room_code`,
  `no_solo_xp`, `no_award_comment_xp`) are revoked from
  public+anon+authenticated. The two RLS helpers
  (`is_no_room_member`, `is_no_room_leader`) keep execute for
  authenticated **and** anon, per the CCT policy-evaluation lesson.

## What was executed as `authenticated` (highlights)

- **Solo XP = locked design table, all 9 cells swept**: 5×5 15/20/25,
  10×10 30/40/50, 15×15 55/70/90 by tier; loss = 5; solo never moves
  rating (stays 800); game row + stats row + `perfect` flag verified.
- **Daily**: first daily win of a size pays base +10 (25 for 5×5 t1);
  second same-size daily pays base only (tier does not re-key the
  ledger); a different size pays its own +10; daily loss pays 5.
- **Check-in**: streak 1, +10 XP, second claim `already_claimed`, 0 XP.
  **Welcome** +50 once. **Quests** play_1/win_1 +20 each once,
  join_room correctly false before any room, bogus id false.
- **Events**: anon (guest) `record_no_game_event('start')` lands with
  NULL user_id; `no_game_stats()` aggregates plays_total 2 / guest 1 /
  member 1 / finished 1 / members_total 4; anon is denied the aggregate.
- **Two-player race, full flow**: create room (RPC) → join ×2
  (idempotent) → non-leader start raises `not_leader` → leader starts
  10×10 t2: `picture_id = 's10t2-' || (seed % 30)` verified against the
  stored seed, seats blue=A/red=B → progress gates: finished report at
  ~0s raises **`too_fast`** (min 30s for 10×10), pct 50 stored, pct 40
  raises **`progress_regression`**, non-seated user raises
  `not_allowed`; after backdating the match clock, finished accepted
  with server-stamped `finished_at`.
- **Finish (server-derived ranks)**: ranks `[1,2]`, caller XP
  play 15 / host 5 / daily 10; loser total +20 (10 play + 10 daily);
  per-seat `no_games` race rows (2) + rating-history snapshots (2);
  re-finish returns `already_finished` and pays 0 (idempotent).
- **Elo, hand-verified**:
  - Race 1 (both 800, K40): winner `floor(40·0.5+0.5)=+20 → 820`,
    loser `floor(40·(−0.5)+0.5)=−20 → 780`. ✔ matches DB.
  - Race 2 (K split): veteran set to 25 games (K24) at 820 vs 800
    (K40): expected 0.52875 → `floor(24·0.47125+0.5)=+11 → 831`;
    loser `floor(40·(−0.47125)+0.5)=−19 → 781`. ✔ matches DB.
  - Race 3 (floor): 100-rated player loses to 780:
    expected 0.01957 → `floor(40·(−0.01957)+0.5)=−1 → 99 → floored
    100`; winner `floor(40·0.01957+0.5)=+1 → 781`. ✔ matches DB.
- **Comment trigger** +2 XP (daily already paid via race, so exactly
  +2). **Room chat**: member posts/reads; non-member reads 0 rows and
  insert is RLS-denied. **Challenge**: row carries `room_code` readable
  by the challenged player pre-join; accept = status update + join by
  code → 2 members.
- **Room delete**: non-leader `not_leader`; during an active match
  `match_in_progress`; after cancel, closes; a non-member joining the
  closed room raises `room_closed`.
- **Growth**: dormant puzzle create → anon `no_puzzle_cards` sees it,
  like toggles on/off, solve counter increments; push subscription
  owner-only; notifications reject client inserts, server-written row
  gives unread count 1.
- **Grant posture (exact 42501 asserted)**: anon denied on
  `no_record_game_result`, `no_claim_checkin`, `no_claim_welcome`,
  `no_game_stats`, `no_finish_room_match`, `no_delete_room`,
  `no_award_room_xp`, `no_gen_room_code`, `no_solo_xp`; authenticated
  also denied on the three internal helpers; anon **allowed** on event
  recording, preview/list/room-leaderboard, leaderboard, guest detail,
  puzzle cards, and both RLS helpers.
- **RLS isolation**: B sees exactly its own 2 `no_games` rows;
  leaderboard (anon) rank 1 = the 831-rated player; guest detail
  carries room code + member_count 2.
- **Registry**: slug `nonogram`, prefix `no_`, stats_source `no_stats`,
  sort 98, accent `#db2777`, icon 🖼️, site_url
  `https://nonogram.synerworlds.com`, match cols blue_id/red_id.

## Deviations from the Sudoku template (and why)

1. **File split consolidated 8 → 5.** Sudoku's 005 (guest-detail fix)
   is folded into 002 — on a fresh DB the race-shaped guest payload is
   written correctly the first time. Sudoku's 006 (4-tier → 12-level
   rescale + history remap) has no Nonogram analog: the design's
   size×tier model is native from 001, so there is nothing to rescale.
   Sudoku 007 (chat) + 008 (delete) are one small room add-on split by
   history; they ship together as 005.
2. **Race XP ladder is 15/10/7/5 at every field size.** Sudoku's
   finish special-cases 2P (winner 15 / loser 5, draw 8/8). The locked
   Nonogram design (§6.3/§6.5) states the plain rank ladder with no 2P
   exception, so a 2P loser earns 10. Design wins over template.
3. **`no_finish_room_match(p_match_id)` takes no results payload.**
   Sudoku trusts a client-computed `{scores, ranks}`; the Nonogram
   brief + design §8 require the server to *derive* ranks from
   reported progress (finished → finish time → fewer mistakes →
   higher pct), which is what the RPC does. Anti-farm gate mirrors
   Sudoku's (someone finished OR field pct sum ≥ 20).
4. **`no_update_progress(p_match_id, p_pct, p_mistakes, p_finished)`**
   uses explicit params (not Sudoku's progress jsonb, whose `filled`
   count has no Nonogram meaning) and adds the two gates Sudoku lacks:
   monotonic pct (`progress_regression`) and a per-size minimum
   elapsed time before `finished` is accepted (10s/30s/60s for
   5/10/15, server clock). Sudoku's only gate is at finish time.
5. **No separate `no_claim_daily_bonus` RPC** — Sudoku's shape is the
   bonus inside the record RPC with the games table as the ledger
   (keyed here by *size* per day, per the design: "1 lần/ngày/kích
   thước"), so that is what shipped.
6. **Quests/welcome come from Checkers/Cờ Úp, not Sudoku** — Sudoku's
   foundation ships none. Same shapes, adapted predicates
   (play_1/win_1 read `no_games`; join_room reads `no_room_members`).
   `no_stats` therefore also carries `welcome_claimed` +
   `created_at`/`updated_at` alongside the exact family columns.
7. **Aggregates are named `no_game_stats()`** (Checkers/Cờ Úp shape,
   per the brief's stats pattern) rather than Sudoku's
   `sud_site_stats()` name; body is Sudoku's/Checkers' bucket set.
   `no_leaderboard(p_limit, p_offset)` uses the fresher two-arg
   Checkers signature (Sudoku's is one-arg).
8. **The match table is `no_matches`** per the brief's table list
   (Sudoku calls it `sud_room_matches`); RPCs keep the family
   `no_*_room_match` names. Legacy Sudoku columns with no Nonogram
   meaning (`state`, `current_turn`, `start_pos`, `moves`) are not
   carried; the match instead stores `picture_id`, `size`, `tier`,
   `seed`, `progress`, `results`.
9. **`no_tournaments` ships as a dormant table only.** Sudoku has no
   tournament table at all; the family bracket implementations
   (Checkers/Cờ Úp) settle 1v1 pairings inside their turn-based finish
   RPCs, which does not map onto a 2–4-player race field. Table +
   member/public-read policies + realtime are in place so a future
   bracket design needs no schema migration.
10. **Race rows are written to `no_games`** (mode `race`, with
    room_id/match_id) by the finish RPC, per the brief's history
    spec. Sudoku races never write `sud_games`; Nonogram history/
    replay wants race solves listed alongside solo ones. Stats
    counters still settle exactly once, in the same RPC.
11. **Check-ins table is `no_checkins`** (Checkers/Cờ Úp naming) rather
    than Sudoku's `sud_daily_checkins`; `no_checkin_history()` kept
    from Sudoku.

## Reproduce

```bash
ln -s ~/workspace/tools/node_modules ~/workspace/nonogram-staging/node_modules
cd ~/workspace/nonogram-staging/sql
node smoke-no.mjs 001_no_foundation.sql 002_no_rooms.sql 003_no_growth.sql \
  004_no_challenge_realtime.sql 005_no_room_chat_delete.sql PASTE_ALL.sql
# or standalone:  node smoke-no.mjs PASTE_ALL.sql
```

Stubs mirror the shared project: production-shaped `profiles` (no
email column), `auth.users`, GUC-driven `auth.uid()`,
`game_registry`, `friendships`, `supabase_realtime` publication.
Function privileges come only from the migrations (+ Postgres
defaults); table privileges use Supabase's default-privileges shape,
exactly as in the Checkers harness.

## Correction (integration, 2026-10-21)
The original smoke asserted `picture_id = 's10t2-' || (seed % 30)` — but
pool picture ids are `s{size}t{tier}-{k}` with k = 0..9 WITHIN the tier
(see lib/nonogram/pool.ts), so seed % 30 produced invalid ids for 2/3 of
seeds. Both the SQL (no_start_next_match + no_rematch in 002) and this
probe now use `seed % 10` (k within the leader-chosen tier). Re-run
after the fix: 43 passed, 0 failed (probe asserts seed % 10).
