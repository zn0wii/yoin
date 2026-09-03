import { useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { usePlayerStore } from "../store/playerStore";
import { toAssetUrl } from "../audio/assetUrl";
import { useVinylPalette } from "./coverColor";

const PAGE = 8;

/** Disc behind the jacket, tinted from the cover's dominant color. */
function AlbumVinyl({ cover }: { cover?: string | null }) {
  const palette = useVinylPalette(cover ? toAssetUrl(cover) : null);
  const style = (
    palette
      ? {
          ["--vinyl-body" as string]: palette.body,
          ["--vinyl-label" as string]: palette.label,
        }
      : undefined
  ) as CSSProperties | undefined;
  return <div className="album-vinyl" style={style} />;
}

function Chevron({ dir }: { dir: -1 | 1 }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
      style={{ transform: dir === -1 ? "none" : "scaleX(-1)" }}
    >
      <path
        d="M6.5 1.5 3 5l3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 2×4 shelf matching design.png: cover with a vinyl peeking out the right.
 *  Beyond one page (8 albums) the shelf pages horizontally — arrows, dots and
 *  vertical-wheel-to-horizontal scrolling reach the further pages. */
export function AlbumGrid() {
  const albums = usePlayerStore((s) => s.albums);
  const browseAlbumIndex = usePlayerStore((s) => s.browseAlbumIndex);
  const browseAlbum = usePlayerStore((s) => s.browseAlbum);
  const error = usePlayerStore((s) => s.error);

  const shelfRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);

  const pages: number[] = [];
  for (let i = 0; i < Math.max(1, Math.ceil(albums.length / PAGE)); i++) {
    pages.push(i);
  }

  const scrollToPage = (target: number) => {
    const el = shelfRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, target));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setPage(clamped);
  };

  const handleScroll = () => {
    const el = shelfRef.current;
    if (!el || !el.clientWidth) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    setPage((prev) => (prev === p ? prev : p));
  };

  // A mouse wheel has no horizontal axis, so a horizontal-only shelf would be
  // unreachable. Translate vertical wheel motion into horizontal scrolling
  // (scroll-snap then re-aligns to the nearest page). Real horizontal input
  // (trackpad) and the mobile vertical layout are left alone.
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth + 4) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    <div className="album-shelf-wrap">
      {albums.length === 0 ? (
        <div className="album-shelf-empty">
          {error ?? "内置曲库为空。可用左侧「添加文件夹」选择 root / 艺术家 / 专辑。"}
        </div>
      ) : (
        <>
          <div className="album-shelf-area">
            <div
              className="album-shelf"
              ref={shelfRef}
              onScroll={handleScroll}
              onWheel={handleWheel}
            >
              {pages.map((p) => (
                <div key={p} className="album-page">
                  {albums.slice(p * PAGE, p * PAGE + PAGE).map((album, i) => {
                    const index = p * PAGE + i;
                    const selected = index === browseAlbumIndex;
                    return (
                      <button
                        key={`${album.artist}:${album.name}:${index}`}
                        className={`album-card${selected ? " selected" : ""}`}
                        onClick={() => browseAlbum(index)}
                      >
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
                              <span className="album-cover-name">
                                {album.name}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="album-card-title">{album.name}</div>
                        <div className="album-card-artist">
                          {album.artist ?? "—"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {pages.length > 1 && (
              <>
                <button
                  className="shelf-nav prev"
                  onClick={() => scrollToPage(page - 1)}
                  disabled={page === 0}
                  aria-label="上一页唱片"
                >
                  <Chevron dir={-1} />
                </button>
                <button
                  className="shelf-nav next"
                  onClick={() => scrollToPage(page + 1)}
                  disabled={page === pages.length - 1}
                  aria-label="下一页唱片"
                >
                  <Chevron dir={1} />
                </button>
              </>
            )}
          </div>
          {pages.length > 1 && (
            <div className="shelf-dots" role="tablist" aria-label="唱片分页">
              {pages.map((p) => (
                <button
                  key={p}
                  className={`shelf-dot${p === page ? " active" : ""}`}
                  onClick={() => scrollToPage(p)}
                  aria-label={`第 ${p + 1} 页`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
