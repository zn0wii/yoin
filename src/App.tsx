import { useCallback, useEffect } from "react";
import { usePlayerStore } from "./store/playerStore";
import { useAudioSync } from "./audio/useAudioSync";
import { scanLibrary, pickMusicFolder } from "./audio/libraryApi";
import { LibraryNav } from "./ui/LibraryNav";
import { AlbumGrid } from "./ui/AlbumGrid";
import { SearchPanel } from "./ui/SearchPanel";
import { TrackList } from "./ui/TrackList";
import { ControlPanel } from "./ui/ControlPanel";
import { VinylStage } from "./scene/VinylStage";
import "./ui/LibraryNav.css";
import "./ui/AlbumGrid.css";
import "./ui/SearchPanel.css";
import "./ui/TrackList.css";
import "./ui/ControlPanel.css";
import "./App.css";

function App() {
  const setAlbums = usePlayerStore((s) => s.setAlbums);
  const setLoading = usePlayerStore((s) => s.setLoading);
  const setError = usePlayerStore((s) => s.setError);
  const libraryOpen = usePlayerStore((s) => s.libraryOpen);
  const searchOpen = usePlayerStore((s) => s.searchOpen);
  const musicDir = usePlayerStore((s) => s.musicDir);
  const browseAlbumIndex = usePlayerStore((s) => s.browseAlbumIndex);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);

  useAudioSync();

  const loadLibrary = useCallback(
    async (dir?: string) => {
      setLoading(true);
      setError(null);
      try {
        const albums = await scanLibrary(dir);
        setAlbums(albums, dir ?? null);
        if (albums.length === 0) {
          setError("未找到专辑。请选择 root / 艺术家 / 专辑 文件夹。");
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [setAlbums, setLoading, setError]
  );

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const handlePickFolder = useCallback(async () => {
    const dir = await pickMusicFolder();
    if (dir) {
      await loadLibrary(dir);
    }
  }, [loadLibrary]);

  const showTracks = browseAlbumIndex >= 0 || currentAlbumIndex >= 0;

  return (
    <div className={`app-root${showTracks ? " tracks-open" : ""}`}>
      <main className="app-main">
        <VinylStage />
      </main>
      <LibraryNav onPickFolder={handlePickFolder} />
      {libraryOpen && !searchOpen ? <AlbumGrid /> : null}
      {searchOpen ? (
        <SearchPanel onDownloaded={() => loadLibrary(musicDir ?? undefined)} />
      ) : null}
      {showTracks ? (
        <aside className="app-sidebar">
          <TrackList />
        </aside>
      ) : null}
      <ControlPanel onPickFolder={handlePickFolder} />
    </div>
  );
}

export default App;
