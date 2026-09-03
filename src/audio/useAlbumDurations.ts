import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { Album } from "../store/playerStore";
import { probeDuration } from "./probeDuration";
import { trackKey, trackWindow } from "./albumProgress";

/**
 * Duration of track `i`, derived from the file's total duration: plain
 * tracks take it whole, CUE tracks span start → next start (clamped to the
 * file). Non-final CUE tracks derive from their neighbour's start even when
 * the file duration is unknown (0); the final one needs the real total.
 * Returns 0 when it can't be derived.
 */
function deriveDuration(
  album: Album,
  i: number,
  fileDuration: number
): number {
  const track = album.tracks[i];
  if (!track) return 0;
  if (track.start == null) return fileDuration;
  const { end } = trackWindow(album, i);
  if (Number.isFinite(end)) {
    const cap = fileDuration > 0 ? fileDuration : Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(end, cap) - track.start);
  }
  return fileDuration > 0 ? Math.max(0, fileDuration - track.start) : 0;
}

/**
 * Fill in missing durations for every track that lives in `filePath`, from a
 * now-known real file duration (e.g. the audio engine just loaded it). Used
 * to self-heal a track list whose metadata probe failed or timed out.
 */
export function deriveTrackDurations(
  album: Album | undefined,
  filePath: string,
  fileDuration: number
) {
  if (!album || !Number.isFinite(fileDuration) || fileDuration <= 0) return;
  const cached = usePlayerStore.getState().trackDurations;
  const updates: Array<[string, number]> = [];
  album.tracks.forEach((track, i) => {
    if (track.path !== filePath) return;
    const key = trackKey(track);
    if (cached[key] > 0) return;
    const d = deriveDuration(album, i, fileDuration);
    if (d > 0) updates.push([key, d]);
  });
  if (updates.length === 0) return;
  usePlayerStore.setState((s) => {
    const next = { ...s.trackDurations };
    for (const [key, value] of updates) {
      if (!next[key]) next[key] = value;
    }
    return { trackDurations: next };
  });
}

/**
 * Ensure every track of `album` has a duration in the store cache.
 *
 * Each distinct file is probed once (metadata-only, with a timeout) unless
 * all of its tracks are cached already; CUE tracks then derive their span
 * from the file duration. Used both for the playing album (stylus travel)
 * and the browsed one (track list shows per-song lengths).
 */
export function useAlbumDurations(album: Album | undefined) {
  const setTrackDuration = usePlayerStore((s) => s.setTrackDuration);

  useEffect(() => {
    if (!album) return;
    let cancelled = false;
    (async () => {
      const cached = () => usePlayerStore.getState().trackDurations;

      // Track indices grouped by the file they live in (CUE tracks share one).
      const byFile = new Map<string, number[]>();
      album.tracks.forEach((track, i) => {
        const indices = byFile.get(track.path) ?? [];
        indices.push(i);
        byFile.set(track.path, indices);
      });

      for (const [filePath, indices] of byFile) {
        if (cancelled) return;
        // Probe only while some track of this file is still missing — the
        // last CUE track always needs the file's total duration.
        const allCached = indices.every(
          (i) => cached()[trackKey(album.tracks[i])] > 0
        );
        if (allCached) continue;

        let fileDuration = 0;
        try {
          fileDuration = await probeDuration(filePath);
          if (cancelled) return;
        } catch (err) {
          console.warn("[audio] duration probe failed", filePath, err);
        }

        for (const i of indices) {
          const track = album.tracks[i];
          if (cached()[trackKey(track)] > 0) continue;
          const d = deriveDuration(album, i, fileDuration);
          if (d > 0) setTrackDuration(trackKey(track), d);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [album, setTrackDuration]);
}
