import { usePlayerStore } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";

/** Left-hand sidebar: every album's tracks, grouped, click to play. */
export function TrackList() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);
  const currentTrackIndex = usePlayerStore((s) => s.currentTrackIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const selectTrack = usePlayerStore((s) => s.selectTrack);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  const handleClick = (albumIndex: number, trackIndex: number) => {
    const isCurrent = albumIndex === currentAlbumIndex && trackIndex === currentTrackIndex;
    if (isCurrent) {
      setIsPlaying(!isPlaying);
    } else {
      selectTrack(albumIndex, trackIndex);
    }
  };

  if (albums.length === 0) {
    return (
      <div className="track-list">
        <div className="track-list-empty">No albums found</div>
      </div>
    );
  }

  return (
    <div className="track-list">
      {albums.map((album, albumIndex) => (
        <div key={album.name} className="track-list-album">
          <div className="track-list-album-header">
            {album.cover ? (
              <img
                className="track-list-cover"
                src={toAssetUrl(album.cover)}
                alt=""
                draggable={false}
              />
            ) : (
              <div className="track-list-cover placeholder" aria-hidden />
            )}
            <div className="track-list-album-name">{album.name}</div>
          </div>
          {album.tracks.map((track, trackIndex) => {
            const isCurrent = albumIndex === currentAlbumIndex && trackIndex === currentTrackIndex;
            return (
              <button
                key={track.path}
                className={`track-list-item${isCurrent ? " active" : ""}`}
                onClick={() => handleClick(albumIndex, trackIndex)}
              >
                <span className="track-list-item-icon">
                  {isCurrent && isPlaying ? "⏸" : "▶"}
                </span>
                <span className="track-list-item-title">{track.title}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
