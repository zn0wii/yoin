import { useCallback, useEffect } from "react";
import { usePlayerStore } from "./store/playerStore";
import { useAudioSync } from "./audio/useAudioSync";
import { getDefaultMusicDir, scanLibrary } from "./audio/libraryApi";
import { LibraryNav } from "./ui/LibraryNav";
import { AlbumGrid } from "./ui/AlbumGrid";
import { NowPlayingArt3D } from "./scene/NowPlayingArt3D";
import { SearchPanel } from "./ui/SearchPanel";
import { TrackList } from "./ui/TrackList";
import { ControlPanel } from "./ui/ControlPanel";
import { LibraryManager } from "./ui/LibraryManager";
import { VinylStage } from "./scene/VinylStage";
import "./ui/LibraryNav.css";
import "./ui/AlbumGrid.css";
import "./ui/SearchPanel.css";
import "./ui/TrackList.css";
import "./ui/ControlPanel.css";
import "./App.css";

function App() {
  const replaceAlbums = usePlayerStore((s) => s.replaceAlbumsKeepPlayback);
  const setLoading = usePlayerStore((s) => s.setLoading);
  const setError = usePlayerStore((s) => s.setError);
  const setDefaultMusicDir = usePlayerStore((s) => s.setDefaultMusicDir);
  const libraryOpen = usePlayerStore((s) => s.libraryOpen);
  const searchOpen = usePlayerStore((s) => s.searchOpen);
  const libraryManagerOpen = usePlayerStore((s) => s.libraryManagerOpen);
  const activeLibraryId = usePlayerStore((s) => s.activeLibraryId);
  const browseAlbumIndex = usePlayerStore((s) => s.browseAlbumIndex);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);

  useAudioSync();

  // Resolve the bundled default music dir once, for display in the manager
  // (null in plain-browser dev — the demo library fallback kicks in there).
  useEffect(() => {
    void getDefaultMusicDir().then(setDefaultMusicDir);
  }, [setDefaultMusicDir]);

  // Scan the active library whenever it changes (startup included).
  // The playing album is carried over by replaceAlbumsKeepPlayback, so a
  // library switch never interrupts playback or hides the track panel.
  useEffect(() => {
    const lib = usePlayerStore
      .getState()
      .libraries.find((l) => l.id === activeLibraryId);
    if (!lib) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    scanLibrary(lib.path ?? undefined)
      .then((albums) => {
        if (cancelled) return;
        replaceAlbums(albums, lib.path);
        if (albums.length === 0) {
          setError("此库为空。可在「库管理」中切换库，或添加 root / 艺术家 / 专辑 结构的文件夹。");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeLibraryId, replaceAlbums, setLoading, setError]);

  /** Rescan one library: applies the result when it is the active one,
   *  otherwise just validates the path (errors bubble to the manager). */
  const refreshLibrary = useCallback(
    async (id: string) => {
      const lib = usePlayerStore.getState().libraries.find((l) => l.id === id);
      if (!lib) return;
      const apply = usePlayerStore.getState().activeLibraryId === id;
      if (apply) setLoading(true);
      try {
        const albums = await scanLibrary(lib.path ?? undefined);
        if (apply) {
          replaceAlbums(albums, lib.path);
          setError(albums.length === 0 ? "此库为空。" : null);
        }
      } finally {
        if (apply) setLoading(false);
      }
    },
    [replaceAlbums, setLoading, setError]
  );

  // SearchPanel downloads land in the active library's tree — rescan it.
  const refreshActiveLibrary = useCallback(
    () => refreshLibrary(usePlayerStore.getState().activeLibraryId),
    [refreshLibrary]
  );

  const showTracks = browseAlbumIndex >= 0 || currentAlbumIndex >= 0;

  return (
    <div className={`app-root${showTracks ? " tracks-open" : ""}`}>
      <main className="app-main">
        <VinylStage />
      </main>
      <LibraryNav />
      {libraryOpen && !searchOpen ? <AlbumGrid /> : null}
      {!libraryOpen && !searchOpen ? <NowPlayingArt3D /> : null}
      {searchOpen ? <SearchPanel onDownloaded={refreshActiveLibrary} /> : null}
      {showTracks ? (
        <aside className="app-sidebar">
          <TrackList />
        </aside>
      ) : null}
      <ControlPanel />
      {libraryManagerOpen ? (
        <LibraryManager onRefresh={refreshLibrary} />
      ) : null}
    </div>
  );
}

export default App;
