import { usePlayerStore } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";
import { AlbumVinyl } from "./AlbumGrid";

/** Center overlay while the library shelf is collapsed: the playing album's
 *  jacket + vinyl, same look as the shelf card but twice the size. */
export function NowPlayingArt() {
  const albums = usePlayerStore((s) => s.albums);
  const currentAlbumIndex = usePlayerStore((s) => s.currentAlbumIndex);

  const album = currentAlbumIndex >= 0 ? albums[currentAlbumIndex] : undefined;
  if (!album) return null;

  return (
    <div className="now-playing-art" aria-hidden>
      <div className="album-art">
        <AlbumVinyl cover={album.cover} />
        {album.cover ? (
          <img
            className="album-cover"
            src={toAssetUrl(album.cover)}
            alt=""
            draggable={false}
          />
        ) : (
          <div className="album-cover placeholder">
            <span className="album-cover-name">{album.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}
