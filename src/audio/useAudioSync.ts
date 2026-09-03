import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "./audioEngine";
import { trackKey, trackWindow } from "./albumProgress";
import {
  deriveTrackDurations,
  useAlbumDurations,
} from "./useAlbumDurations";

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
  useAlbumDurations(currentAlbum);

  // Load the current track whenever it changes. CUE tracks may share one
  // file — switching between them just moves the playback window.
  useEffect(() => {
    if (!currentTrack || !hasSelection || !currentAlbum) return;
    const { start, end } = trackWindow(currentAlbum, currentTrackIndex);
    audioEngine.setWindow(start, end);
    if (loadedPathRef.current === currentTrack.path) {
      audioEngine.seek(0);
      if (usePlayerStore.getState().isPlaying) {
        audioEngine.play().catch(() => setIsPlaying(false));
      }
      return;
    }
    const path = currentTrack.path;
    loadedPathRef.current = path;
    let cancelled = false;
    (async () => {
      try {
        await audioEngine.load(path);
        if (cancelled) return;
        const d = audioEngine.duration;
        if (d > 0) setTrackDuration(trackKey(currentTrack), d);
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
  }, [currentTrack, currentTrackIndex, hasSelection, setIsPlaying, setTrackDuration]);

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
      const s = usePlayerStore.getState();
      const album = s.albums[s.currentAlbumIndex];
      const track = album?.tracks[s.currentTrackIndex];
      if (track && d > 0) setTrackDuration(trackKey(track), d);
      // The real file duration is now known — heal any sibling CUE tracks
      // whose durations couldn't be derived during the metadata probe.
      const fileDur = audioEngine.fileDuration;
      if (album && track && fileDur > 0) {
        deriveTrackDurations(album, track.path, fileDur);
      }
    });
  }, [setTime, setTrackDuration]);

  // Advance to the next track when the current one finishes.
  useEffect(() => {
    return audioEngine.onEnded(() => nextTrack());
  }, [nextTrack]);
}
