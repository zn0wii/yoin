import type { Album, Track } from "../store/playerStore";

/** Cache key for a track's duration — CUE tracks share a file path, so the
 *  start offset disambiguates them. */
export function trackKey(track: Track): string {
  return track.start != null ? `${track.path}@${track.start}` : track.path;
}

/** Playable span of track `i`: its CUE start (0 for plain tracks) and the
 *  start of the next track in the same file (Infinity = file end). */
export function trackWindow(
  album: Album | undefined,
  i: number
): { start: number; end: number } {
  const track = album?.tracks[i];
  if (!track || track.start == null) return { start: 0, end: Number.POSITIVE_INFINITY };
  const next = album.tracks[i + 1];
  const end =
    next && next.path === track.path && next.start != null && next.start > track.start
      ? next.start
      : Number.POSITIVE_INFINITY;
  return { start: track.start, end };
}

/**
 * Album-as-one-side progress in [0, 1]:
 * lead-in (outer) → spiral inward → run-out (inner).
 *
 * elapsed = sum(durations of prior tracks) + currentTime
 * total   = sum(track durations) — missing ones estimated from known average
 */
export function albumStylusProgress(
  album: Album | undefined,
  trackIndex: number,
  currentTime: number,
  durations: Record<string, number>,
  /** Fallback duration for the current track (e.g. live audioEngine.duration). */
  currentTrackDuration = 0
): number {
  if (!album || album.tracks.length === 0) return 0;

  const n = album.tracks.length;
  const resolved: number[] = album.tracks.map((t, i) => {
    const cached = durations[trackKey(t)] ?? 0;
    if (cached > 0) return cached;
    if (i === trackIndex && currentTrackDuration > 0) return currentTrackDuration;
    return 0;
  });

  const known = resolved.filter((d) => d > 0);
  const avg = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;

  const lengths = resolved.map((d) => (d > 0 ? d : avg));
  const total = lengths.reduce((a, b) => a + b, 0);

  if (total <= 0) {
    // Nothing usable — distribute evenly by index + intra-track guess.
    const frac =
      currentTrackDuration > 0
        ? Math.min(1, Math.max(0, currentTime / currentTrackDuration))
        : 0;
    return Math.min(1, Math.max(0, (trackIndex + frac) / n));
  }

  let elapsed = Math.max(0, currentTime);
  for (let i = 0; i < trackIndex; i++) elapsed += lengths[i];

  return Math.min(1, Math.max(0, elapsed / total));
}

export function albumTotalDuration(
  album: Album | undefined,
  durations: Record<string, number>
): number {
  if (!album) return 0;
  return album.tracks.reduce((sum, t) => sum + (durations[t.path] ?? 0), 0);
}

export function albumElapsed(
  album: Album | undefined,
  trackIndex: number,
  currentTime: number,
  durations: Record<string, number>
): number {
  if (!album) return 0;
  let elapsed = Math.max(0, currentTime);
  for (let i = 0; i < trackIndex; i++) {
    elapsed += durations[album.tracks[i]?.path] ?? 0;
  }
  return elapsed;
}
