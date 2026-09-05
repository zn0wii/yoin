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
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
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
