import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "./audioEngine";
import { probeDuration } from "./probeDuration";

/**
 * Bridges the audioEngine singleton with the zustand store:
 * - loads the current track when it changes
 * - keeps currentTime/duration in sync
 * - probes every track duration on the current album (stylus travel)
 * - advances to the next track when one ends
 * - starts/stops playback in response to isPlaying
 */
export function useAudioSync() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setTime = usePlayerStore((s) => s.setTime);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);
  const setTrackDuration = usePlayerStore((s) => s.setTrackDuration);
  const nextTrack = usePlayerStore((s) => s.nextTrack);

  const loadedPathRef = useRef<string | null>(null);
  const hasSelection = currentAlbumIndex !== -1;

  const currentAlbum = albums[currentAlbumIndex];
  const currentTrack = currentAlbum?.tracks[currentTrackIndex];

  // Probe durations for the whole album so stylus can travel outer → inner.
  useEffect(() => {
    if (!currentAlbum) return;
    let cancelled = false;
    (async () => {
      for (const track of currentAlbum.tracks) {
        if (cancelled) return;
        if (usePlayerStore.getState().trackDurations[track.path]) continue;
        try {
          const d = await probeDuration(track.path);
          if (!cancelled && d > 0) setTrackDuration(track.path, d);
        } catch (err) {
          console.warn("[audio] duration probe failed", track.path, err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentAlbum, setTrackDuration]);

  // Load the current track whenever it changes.
  useEffect(() => {
    if (!currentTrack || !hasSelection) return;
    if (loadedPathRef.current === currentTrack.path) return;
    const path = currentTrack.path;
    loadedPathRef.current = path;
    let cancelled = false;
    (async () => {
      try {
        await audioEngine.load(path);
        if (cancelled) return;
        const d = audioEngine.duration;
        if (d > 0) setTrackDuration(path, d);
        if (usePlayerStore.getState().isPlaying) {
          await audioEngine.play();
        }
      } catch (err) {
        console.error("[audio] load/play failed", err);
        if (!cancelled) setIsPlaying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTrack, hasSelection, setIsPlaying, setTrackDuration]);

  // React to play/pause intent.
  useEffect(() => {
    if (!hasSelection) return;
    if (isPlaying) {
      audioEngine.play().catch((err) => {
        console.error("[audio] play failed", err);
        setIsPlaying(false);
      });
    } else {
      audioEngine.pause();
    }
  }, [isPlaying, hasSelection, setIsPlaying]);

  // Poll playback position; <audio> "timeupdate" fires ~4x/sec which is
  // plenty for a progress bar.
  useEffect(() => {
    return audioEngine.onUpdate(() => {
      const t = audioEngine.currentTime;
      const d = audioEngine.duration;
      setTime(t, d);
      const path = loadedPathRef.current;
      if (path && d > 0) setTrackDuration(path, d);
    });
  }, [setTime, setTrackDuration]);

  // Advance to the next track when the current one finishes.
  useEffect(() => {
    return audioEngine.onEnded(() => nextTrack());
  }, [nextTrack]);
}
