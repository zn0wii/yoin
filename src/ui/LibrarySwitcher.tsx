import { useEffect, useMemo, useRef, useState } from "react";
import { usePlayerStore, type MusicLibrary } from "../store/playerStore";
import "./LibrarySwitcher.css";

/** Libraries shown as segmented pills before the overflow dropdown. */
const SEG_MAX = 4;

function IconChevronDown() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Library label with its scan path as a secondary line (dropdown rows). */
function LibraryLabel({ lib }: { lib: MusicLibrary }) {
  const defaultMusicDir = usePlayerStore((s) => s.defaultMusicDir);
  return (
    <span className="lib-dd-item-text">
      <span className="lib-dd-item-name">{lib.name}</span>
      <span className="lib-dd-item-path" title={lib.path ?? defaultMusicDir ?? ""}>
        {lib.path ?? defaultMusicDir ?? "内置曲库"}
      </span>
    </span>
  );
}

/** Top-of-shelf library switcher: segmented pills for the most-used
 *  libraries plus a searchable dropdown reaching all of them. */
export function LibrarySwitcher() {
  const libraries = usePlayerStore((s) => s.libraries);
  const activeLibraryId = usePlayerStore((s) => s.activeLibraryId);
  const setActiveLibraryId = usePlayerStore((s) => s.setActiveLibraryId);
  const toggleLibraryManager = usePlayerStore((s) => s.toggleLibraryManager);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Most recently used first, active library pinned to the front.
  const ordered = useMemo(
    () =>
      [...libraries]
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .sort((a, b) =>
          a.id === activeLibraryId ? -1 : b.id === activeLibraryId ? 1 : 0
        ),
    [libraries, activeLibraryId]
  );
  const segLibs = ordered.slice(0, SEG_MAX);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ordered.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.path ?? "").toLowerCase().includes(q)
      )
    : ordered;

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    setActiveLibraryId(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="lib-switcher" ref={rootRef}>
      <div className="lib-seg" role="tablist" aria-label="曲库切换">
        {segLibs.map((lib) => (
          <button
            key={lib.id}
            className={`lib-seg-item${lib.id === activeLibraryId ? " active" : ""}`}
            role="tab"
            aria-selected={lib.id === activeLibraryId}
            title={lib.path ?? "内置曲库"}
            onClick={() => setActiveLibraryId(lib.id)}
          >
            {lib.name}
          </button>
        ))}
        <button
          className="lib-seg-more"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="全部曲库（支持搜索）"
        >
          <IconChevronDown />
        </button>
        <button
          className="lib-seg-manage"
          onClick={toggleLibraryManager}
          title="库管理"
        >
          <IconGear />
        </button>
      </div>

      {open ? (
        <div className="lib-dropdown">
          <input
            className="lib-dd-search"
            placeholder="搜索库名或路径…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            aria-label="搜索曲库"
          />
          <ul className="lib-dd-list">
            {filtered.map((lib) => (
              <li key={lib.id}>
                <button
                  className={`lib-dd-item${lib.id === activeLibraryId ? " active" : ""}`}
                  onClick={() => pick(lib.id)}
                >
                  <span className="lib-dd-item-dot" aria-hidden />
                  <LibraryLabel lib={lib} />
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li className="lib-dd-empty">没有匹配的库</li>
            ) : null}
          </ul>
          <button
            className="lib-dd-manage"
            onClick={() => {
              setOpen(false);
              toggleLibraryManager();
            }}
          >
            管理曲库…
          </button>
        </div>
      ) : null}
    </div>
  );
}
