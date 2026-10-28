// The saved settings: their shape, defaults and a typed, validated merge (AC-G.1).
// No Obsidian here, so node --test covers it.

/** Saved settings; the keys and defaults are those of 0.1.0. */
export interface PublisherSettings {
  cpubPath: string;
  showRibbon: boolean;
  timeoutSeconds: number;
}

export const DEFAULT_SETTINGS: Readonly<PublisherSettings> = {
  cpubPath: '',
  showRibbon: true,
  timeoutSeconds: 120,
};

/** The smallest timeout accepted, in seconds. */
export const MIN_TIMEOUT_SECONDS = 10;

/**
 * Settings from whatever ``loadData()`` returned: each known key is taken only
 * when it has the right type and a valid value; anything else falls back to its
 * default, and unknown keys are dropped.
 */
export function parseSettings(raw: unknown): PublisherSettings {
  const out: PublisherSettings = { ...DEFAULT_SETTINGS };
  if (raw === null || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.cpubPath === 'string') out.cpubPath = r.cpubPath.trim();
  if (typeof r.showRibbon === 'boolean') out.showRibbon = r.showRibbon;
  if (isValidTimeout(r.timeoutSeconds)) out.timeoutSeconds = Math.round(r.timeoutSeconds);
  return out;
}

export function isValidTimeout(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MIN_TIMEOUT_SECONDS;
}
