/**
 * Nonogram race-match helpers.
 *
 * A room match is a RACE: every seated player paints the SAME pool
 * picture (named by the match's picture_id; the seed merely picked
 * which one, server-side) on their own board. Each client reports its
 * own progress — percent of correct fills, mistakes, and whether it
 * has SOLVED — through no_update_progress; the server keeps them in
 * the match's `progress` jsonb, keyed by user id.
 *
 * Client contract with the server derivation (002): `finished` means
 * SOLVED (100%). A racer who busts out on 3 mistakes or gives up
 * stays finished=false with their final pct — the server ranks
 * solvers by finish time first, then everyone else by fewer
 * mistakes, then higher pct. Ranks are ALWAYS derived server-side in
 * no_finish_room_match; the helpers below only mirror them for live
 * display.
 */
import { getPicture, type NoPicture } from "@/lib/nonogram/pool";
import type { Lang } from "@/lib/nonogram/i18n";
import type { RoomMatch } from "./rooms";

export const SEAT_COLORS = ["#dc2626", "#2563eb", "#eab308", "#16a34a"];
export const SEAT_EMOJI = ["🔴", "🔵", "🟡", "🟢"];

export interface RaceProgress {
  /** Correct fills as a percent of the picture's filled cells. */
  pct: number;
  mistakes: number;
  /** Elapsed seconds on this racer's clock. */
  secs: number;
  /** This racer has SOLVED the picture (server's `finished`). */
  finished: boolean;
  /** ISO timestamp of the solve, when finished. */
  finished_at: string | null;
  /** Local-only spectator board (cell states base-3 string). Never
   *  stored by the server — rows arriving from the DB lack it, so
   *  spectators see live % bars and boards only of FINISHED racers
   *  (design §6.3). */
  board?: string;
}

export const emptyProgress = (): RaceProgress => ({
  pct: 0,
  mistakes: 0,
  secs: 0,
  finished: false,
  finished_at: null,
});

/** Normalize a raw progress jsonb row (the server's shape) — older or
 *  partial rows get safe defaults. */
export function normProgress(raw: unknown): RaceProgress {
  const p = (raw ?? {}) as Partial<RaceProgress>;
  return {
    pct: typeof p.pct === "number" ? p.pct : 0,
    mistakes: typeof p.mistakes === "number" ? p.mistakes : 0,
    secs: typeof p.secs === "number" ? p.secs : 0,
    finished: p.finished === true,
    finished_at: typeof p.finished_at === "string" ? p.finished_at : null,
    board: typeof p.board === "string" ? p.board : undefined,
  };
}

/** Seat index of the user in a match, or -1 when spectating. */
export function mySeatInMatch(
  userId: string | null | undefined,
  players: string[] | null | undefined,
): number {
  if (!userId || !Array.isArray(players)) return -1;
  return players.indexOf(userId);
}

/** "Ghế 1" / "Seat 1" — human seat label. */
export function seatLabel(seat: number, lang: Lang): string {
  return lang === "vi" ? `Ghế ${seat + 1}` : `Seat ${seat + 1}`;
}

/** The picture this race is painting (every client resolves the same
 *  pool entry from the server-assigned picture_id). */
export function racePicture(m: { picture_id?: string | null }): NoPicture | null {
  if (!m.picture_id) return null;
  return getPicture(m.picture_id) ?? null;
}

export interface Standing {
  userId: string;
  seat: number;
  progress: RaceProgress;
}

/** Mirror of the server's derivation: solvers first (earliest solve
 *  first), then fewer mistakes, then higher pct. */
export function compareProgress(a: RaceProgress, b: RaceProgress): number {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished) {
    return (a.finished_at ?? "").localeCompare(b.finished_at ?? "") ||
      a.mistakes - b.mistakes;
  }
  if (a.mistakes !== b.mistakes) return a.mistakes - b.mistakes;
  return b.pct - a.pct;
}

export function raceStandings(m: RoomMatch): Standing[] {
  const prog = m.progress ?? {};
  return m.players
    .map((userId, seat) => ({
      userId,
      seat,
      progress: normProgress(prog[userId]),
    }))
    .sort((x, y) => compareProgress(x.progress, y.progress));
}

/** Display ranks from the FINAL server results when present
 *  (results.ranks[seat]), else from the live mirror. */
export function finalRanks(m: RoomMatch): number[] | null {
  const r = (m.results as { ranks?: number[] } | null)?.ranks;
  return Array.isArray(r) && r.length === m.players.length ? r : null;
}

/** Everyone is out of the race: solved, or busted on 3 mistakes. */
export function allDone(m: RoomMatch): boolean {
  const prog = m.progress ?? {};
  return (
    m.players.length > 0 &&
    m.players.every((u) => {
      const p = normProgress(prog[u]);
      return p.finished || p.mistakes >= 3;
    })
  );
}

/** Someone solved the picture — the race can be settled. */
export function anyoneSolved(m: RoomMatch): boolean {
  const prog = m.progress ?? {};
  return m.players.some((u) => normProgress(prog[u]).finished);
}
