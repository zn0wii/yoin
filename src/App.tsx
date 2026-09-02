import { useCallback, useEffect } from "react";
import { usePlayerStore } from "./store/playerStore";
import { useAudioSync } from "./audio/useAudioSync";
import { scanLibrary, pickMusicFolder } from "./audio/libraryApi";
import { TrackList } from "./ui/TrackList";
import { ControlPanel } from "./ui/ControlPanel";
import { VinylStage } from "./scene/VinylStage";
import "./ui/TrackList.css";
import "./ui/ControlPanel.css";
import "./App.css";

function App() {
  const setAlbums = usePlayerStore((s) => s.setAlbums);
  const setLoading = usePlayerStore((s) => s.setLoading);
  const setError = usePlayerStore((s) => s.setError);

  useAudioSync();

  const loadLibrary = useCallback(
    async (dir?: string) => {
      setLoading(true);
      setError(null);
      try {
        const albums = await scanLibrary(dir);
        setAlbums(albums, dir ?? null);
        if (albums.length === 0) {
          setError("No mp3 files found in this folder.");
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

  return (
    <div className="app-root">
      <main className="app-main">
        <VinylStage />
      </main>
      <aside className="app-sidebar">
        <TrackList />
      </aside>
      <ControlPanel onPickFolder={handlePickFolder} />
    </div>
  );
}

export default App;
