/**
 * Central i18n loader — vendored shared module (one copy per game;
 * piloted on Sudoku, design: ~/workspace/i18n-central/design.md §5–§6).
 *
 * Model: the hub is the source, the game is a cached copy. The bundled
 * dictionaries in ./i18n remain the always-available fallback — this
 * module NEVER removes or blocks on them:
 *   1. First paint uses the bundled VI/EN dictionaries (zero network, no
 *      flash of the wrong language).
 *   2. In the background it fetches the hub manifest, then the versioned
 *      `common` + game dictionaries for every locale the manifest marks
 *      ready for this game, verifies each file's sha256, merges
 *      { ...common, ...game } (game namespace wins on key clashes) and —
 *      only if the merge covers every bundled key — applies the values
 *      in place onto STR[locale] and notifies subscribers so the UI
 *      re-reads.
 *   3. Fetched dictionaries are cached in localStorage keyed by
 *      namespace+locale+version (at most 2 versions kept per pair), so
 *      repeat visits and hub outages run entirely from cache/bundled.
 *   4. Any failure (offline, hub down, bad sha, incomplete merge) is a
 *      silent no-op: the game keeps behaving exactly as it did before
 *      centralization.
 *
 * The country→locale table used by first-visit detection is also hub
 * data: it arrives inside the manifest (`countryMap`, published from
 * content/i18n/countries.json) and is exposed via getCountryMap(). No
 * locale list or country table is hardcoded here beyond the bundled
 * vi/en fallback — adding a locale at the hub lights it up in this
 * game with no code change.
 */

import { STR, type Lang } from "./i18n";

export type Dict = Record<string, string | string[]>;
export interface LocaleInfo {
  code: string;
  name: string;
}
export interface CountryMapData {
  default: string;
  map: Record<string, string>;
}

const HUB_ORIGIN = "https://synerworlds.com";
const GAME = "nonogram";
const NAMESPACES = ["common", GAME] as const;
const CACHE_PREFIX = `i18n-cache:${GAME}:`;
const FETCH_TIMEOUT_MS = 8000;

const BUNDLED_LOCALES: LocaleInfo[] = [
  { code: "vi", name: "Tiếng Việt" },
  { code: "en", name: "English" },
];

interface ManifestDictEntry {
  v: number;
  keys: number;
  bytes: number;
  sha: string;
}
interface Manifest {
  version: number;
  locales: { code: string; name: string; ready: boolean }[];
  dictionaries: Record<string, Record<string, ManifestDictEntry>>;
  ready: Record<string, string[]>;
  countryMap?: { default?: string; map?: Record<string, string> } | null;
}

/** Central dictionaries fetched at runtime, per locale (merged). */
const runtimeDicts = new Map<string, Dict>();
let availableLocales: LocaleInfo[] = [...BUNDLED_LOCALES];
let countryMap: CountryMapData | null = null;
let manifestSeen = false;

const listeners = new Set<() => void>();
export function subscribeI18n(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken subscriber must not break the loader */
    }
  });
}

/** Locales the switcher may offer: the manifest's ready list for this
 *  game (falling back to the bundled list until a manifest has been
 *  seen), restricted to locales STR can actually resolve right now. */
export function getAvailableLocales(): LocaleInfo[] {
  return availableLocales.filter((l) => l.code in STR);
}

/** The country→locale table from the hub manifest (null until a
 *  manifest has been read). The bundled fallback in ./i18n covers the
 *  pre-manifest first paint. */
export function getCountryMap(): CountryMapData | null {
  return countryMap;
}

/** Merge rule (design §3.3): game namespace wins over `common`. */
export function mergeDicts(common: Dict | null, game: Dict | null): Dict | null {
  if (!common && !game) return null;
  return { ...(common ?? {}), ...(game ?? {}) };
}

/** A central merge may only replace the bundled dictionary when it
 *  covers every bundled key — otherwise the bundled values stay. */
export function coversAll(bundled: Dict, merged: Dict): boolean {
  return Object.keys(bundled).every((k) => k in merged);
}

/** Per-string fallback chain: locale -> en -> vi -> the key itself. */
export function resolveString(
  locale: string,
  key: string,
  dicts: { runtime: Map<string, Dict>; bundled: Partial<Record<Lang, Dict>> }
): string | string[] {
  return (
    dicts.runtime.get(locale)?.[key] ??
    dicts.runtime.get("en")?.[key] ??
    dicts.bundled.en?.[key] ??
    dicts.runtime.get("vi")?.[key] ??
    dicts.bundled.vi?.[key] ??
    key
  );
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // verification unsupported here — do not block
  }
}

function cacheKey(ns: string, locale: string, v: number): string {
  return `${CACHE_PREFIX}${ns}:${locale}:v${v}`;
}

function readCache(ns: string, locale: string, entry: ManifestDictEntry): Dict | null {
  try {
    const raw = localStorage.getItem(cacheKey(ns, locale, entry.v));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sha: string; dict: Dict };
    return parsed.sha === entry.sha ? parsed.dict : null;
  } catch {
    return null;
  }
}

function writeCache(ns: string, locale: string, entry: ManifestDictEntry, dict: Dict): void {
  try {
    localStorage.setItem(cacheKey(ns, locale, entry.v), JSON.stringify({ sha: entry.sha, dict }));
    // Keep at most the 2 newest versions per namespace+locale.
    const prefix = `${CACHE_PREFIX}${ns}:${locale}:v`;
    const versions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) versions.push({ k, v: Number(k.slice(prefix.length)) || 0 });
    }
    versions.sort((a, b) => b.v - a.v);
    for (const old of versions.slice(2)) localStorage.removeItem(old.k);
  } catch {
    /* storage full/blocked — running without cache is fine */
  }
}

async function loadNamespace(ns: string, locale: string, entry: ManifestDictEntry): Promise<Dict | null> {
  const cached = readCache(ns, locale, entry);
  if (cached) return cached;
  const text = await fetchText(`${HUB_ORIGIN}/i18n/v${entry.v}/${ns}.${locale}.json`);
  const sha = await sha256Hex(text);
  if (sha !== null && sha !== entry.sha) return null; // corrupt/stale — reject, keep fallback
  const dict = JSON.parse(text) as Dict;
  writeCache(ns, locale, entry, dict);
  return dict;
}

function applyLocale(locale: string, merged: Dict): void {
  runtimeDicts.set(locale, merged);
  const record = STR as Partial<Record<string, Dict>>;
  const bundled = record[locale];
  if (bundled) {
    if (coversAll(bundled, merged)) {
      // In-place: every existing reader of STR[locale] picks the central
      // values up on the re-render triggered by notify().
      Object.assign(bundled, merged);
    }
    return;
  }
  // A locale with no bundled dictionary (fr/lo/km/th, later ja/ko/es):
  // only materialise STR[locale] when the merge covers the whole
  // reference key set, filling any gap down the fallback chain
  // locale -> en -> vi so no key can render blank.
  const reference = record.vi;
  if (!reference || !coversAll(reference, merged)) return;
  const resolved: Dict = {};
  for (const k of Object.keys(reference)) {
    resolved[k] =
      merged[k] ??
      runtimeDicts.get("en")?.[k] ??
      record.en?.[k] ??
      reference[k];
  }
  record[locale] = resolved as (typeof STR)[Lang];
}

let started = false;
/** Kick off the background sync. Idempotent; safe to call on the server
 *  (no-ops) and any number of times. */
export function initCentralI18n(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void (async () => {
    try {
      const manifest = JSON.parse(await fetchText(`${HUB_ORIGIN}/i18n/manifest.json`)) as Manifest;
      manifestSeen = true;
      if (manifest.countryMap?.map) {
        countryMap = {
          default: manifest.countryMap.default ?? "en",
          map: manifest.countryMap.map,
        };
      }
      const readyCodes = manifest.ready?.[GAME] ?? [];
      const resolvable = readyCodes.filter(
        (code) => code in STR || manifest.dictionaries?.[GAME]?.[code] || manifest.dictionaries?.common?.[code]
      );
      if (resolvable.length > 0) {
        availableLocales = resolvable.map((code) => {
          const info = manifest.locales?.find((l) => l.code === code);
          return {
            code,
            name: info?.name ?? BUNDLED_LOCALES.find((l) => l.code === code)?.name ?? code,
          };
        });
      }
      let changed = false;
      for (const locale of resolvable) {
        const parts: (Dict | null)[] = [];
        for (const ns of NAMESPACES) {
          const entry = manifest.dictionaries?.[ns]?.[locale];
          parts.push(entry ? await loadNamespace(ns, locale, entry).catch(() => null) : null);
        }
        const merged = mergeDicts(parts[0], parts[1]);
        if (merged) {
          const before = runtimeDicts.get(locale);
          if (JSON.stringify(before) !== JSON.stringify(merged)) changed = true;
          applyLocale(locale, merged);
        }
      }
      if (changed || resolvable.length > 0) notify();
    } catch {
      /* offline / hub down / bad manifest — bundled dictionaries carry on */
    }
  })();
}

/** Whether a manifest has been successfully read at least once. */
export function hasSeenManifest(): boolean {
  return manifestSeen;
}
