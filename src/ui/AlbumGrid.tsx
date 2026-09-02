import { usePlayerStore } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";

const VINYL_HUES = [
  "#e8a0b0",
  "#1a1a1c",
  "#4a5a78",
  "#e4dcd4",
  "#a83838",
  "#3a4a3a",
];

const PAGE = 8;

/** 2×4 shelf matching design.png: cover with a vinyl peeking out the right. */
export function AlbumGrid() {
  const albums = usePlayerStore((s) => s.albums);
  const browseAlbumIndex = usePlayerStore((s) => s.browseAlbumIndex);
  const browseAlbum = usePlayerStore((s) => s.browseAlbum);
  const error = usePlayerStore((s) => s.error);

  const pages: number[] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(albums.length / PAGE)); i++) {
    pages.push(i);
  }

  return (
    <div className="album-shelf-wrap">
      {albums.length === 0 ? (
        <div className="album-shelf-empty">
          {error ?? "内置曲库为空。可用左侧「添加文件夹」选择 root / 艺术家 / 专辑。"}
        </div>
      ) : (
        <div className="album-shelf">
          {pages.map((page) => (
            <div key={page} className="album-page">
              {albums.slice(page * PAGE, page * PAGE + PAGE).map((album, i) => {
                const index = page * PAGE + i;
                const hue = VINYL_HUES[index % VINYL_HUES.length];
                const selected = index === browseAlbumIndex;
                return (
                  <button
                    key={`${album.artist}:${album.name}:${index}`}
                    className={`album-card${selected ? " selected" : ""}`}
                    onClick={() => browseAlbum(index)}
                  >
                    <div className="album-art">
                      <div
                        className="album-vinyl"
                        style={{ ["--vinyl" as string]: hue }}
                      />
                      {album.cover ? (
                        <img
                          className="album-cover"
                          src={toAssetUrl(album.cover)}
                          alt=""
                          draggable={false}
                        />
                      ) : (
                        <div className="album-cover placeholder" />
                      )}
                    </div>
                    <div className="album-card-title">{album.name}</div>
                    <div className="album-card-artist">{album.artist ?? "—"}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
