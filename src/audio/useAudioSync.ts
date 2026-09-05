import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { audioEngine } from "./audioEngine";
import { getSongPlayUrl } from "./searchApi";
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

  const loadedPathRef = useRef<string | null>(null);
  const hasSelection = currentAlbumIndex !== -1;

  const currentAlbum = albums[currentAlbumIndex];
  const currentTrack = currentAlbum?.tracks[currentTrackIndex];

  // Probe durations for the whole album so stylus can travel outer → inner.
  useAlbumDurations(currentAlbum);

  // Load the current track whenever it changes. CUE tracks may share one
  // file — switching between them just moves the playback window. Online
  // tracks may arrive with only `onlineSongId`; fetch a CDN url first, then
  // this effect re-runs once `path` is filled in.
  useEffect(() => {
    if (!currentTrack || !hasSelection || !currentAlbum) return;

    if (!currentTrack.path && currentTrack.onlineSongId) {
      let cancelled = false;
      const songId = currentTrack.onlineSongId;
      const title = currentTrack.title;
      const artist = currentAlbum.artist ?? undefined;
      (async () => {
        try {
          const url = await getSongPlayUrl(songId, title, artist);
          if (cancelled) return;
          if (!url) {
            setIsPlaying(false);
            return;
          }
          const s = usePlayerStore.getState();
          const albumIndex = s.currentAlbumIndex;
          const trackIndex = s.currentTrackIndex;
          const nextAlbums = s.albums.map((a, i) => {
            if (i !== albumIndex) return a;
            return {
              ...a,
              tracks: a.tracks.map((t, j) =>
                j === trackIndex ? { ...t, path: url } : t
              ),
            };
          });
          s.setAlbums(nextAlbums, s.musicDir);
        } catch (err) {
          console.error("[audio] online url fetch failed", err);
          if (!cancelled) setIsPlaying(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!currentTrack.path) return;

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
  }, [currentTrack, currentTrackIndex, hasSelection, currentAlbum, setIsPlaying, setTrackDuration]);

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

  // Advance to the next track when the current one finishes. Online tracks
  // without a cached `path` still advance if they have `onlineSongId` — the
  // load effect above fetches a fresh CDN url before playing. Shuffle and
  // repeat (transport toggles) steer the auto-advance.
  useEffect(() => {
    return audioEngine.onEnded(() => {
      const s = usePlayerStore.getState();
      const album = s.albums[s.currentAlbumIndex];
      if (!album || album.tracks.length === 0) {
        setIsPlaying(false);
        return;
      }
      // Repeat-one: indices don't change so the load effect won't refire —
      // restart the audio element directly.
      if (s.repeatMode === "one") {
        audioEngine.seek(0);
        audioEngine.play().catch(() => setIsPlaying(false));
        setTime(0, audioEngine.duration);
        return;
      }
      let nextIndex: number;
      if (s.shuffle && album.tracks.length > 1) {
        // Random pick that isn't the track that just ended.
        do {
          nextIndex = Math.floor(Math.random() * album.tracks.length);
        } while (nextIndex === s.currentTrackIndex);
      } else {
        nextIndex = s.currentTrackIndex + 1;
        if (nextIndex >= album.tracks.length) {
          // Reached the album end: loop on repeat-all, otherwise stop. Online
          // albums always play through once unless repeat-all is explicit.
          const loops = album.onlineId ? s.repeatMode === "all" : s.repeatMode !== "off";
          if (!loops) {
            setIsPlaying(false);
            return;
          }
          nextIndex = 0;
        }
      }
      const next = album.tracks[nextIndex];
      if (!next?.path && !next?.onlineSongId) {
        setIsPlaying(false);
        return;
      }
      usePlayerStore.setState({ currentTrackIndex: nextIndex, currentTime: 0 });
    });
  }, [setIsPlaying, setTime]);
}
