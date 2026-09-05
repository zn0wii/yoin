import { BACKGROUNDS, usePlayerStore } from "../store/playerStore";

function IconVinyl() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3 4.4h2.8v11.2H3zM6.8 4.4h2.8v11.2H6.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10.8 5.4l2.6-.7 2.9 10.9-2.6.7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <circle cx="8.6" cy="8.6" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.6 12.6 17 17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect
        x="3"
        y="4"
        width="14"
        height="12"
        rx="2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3.6 13.4l3.4-3.4 3 3 2.4-2.4 4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.3" cy="7.7" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function LibraryNav() {
  const libraryOpen = usePlayerStore((s) => s.libraryOpen);
  const toggleLibrary = usePlayerStore((s) => s.toggleLibrary);
  const searchOpen = usePlayerStore((s) => s.searchOpen);
  const toggleSearch = usePlayerStore((s) => s.toggleSearch);
  const toggleLibraryManager = usePlayerStore((s) => s.toggleLibraryManager);
  const backgroundIndex = usePlayerStore((s) => s.backgroundIndex);
  const cycleBackground = usePlayerStore((s) => s.cycleBackground);

  return (
    <nav className="library-nav">
      <button
        className={`library-nav-item${libraryOpen ? " active" : ""}`}
        onClick={toggleLibrary}
        aria-pressed={libraryOpen}
      >
        <IconVinyl />
        <span>唱片库</span>
      </button>
      <button
        className={`library-nav-item${searchOpen ? " active" : ""}`}
        onClick={toggleSearch}
        aria-pressed={searchOpen}
      >
        <IconSearch />
        <span>搜索</span>
      </button>
      <button
        className="library-nav-item"
        onClick={cycleBackground}
        title="切换主界面背景"
      >
        <IconImage />
        <span>
          背景 {backgroundIndex + 1}/{BACKGROUNDS.length}
        </span>
      </button>
      <button
        className="library-nav-item"
        onClick={toggleLibraryManager}
        title="库管理：重命名 / 刷新 / 删除 / 添加曲库"
      >
        <IconLibrary />
        <span>库管理</span>
      </button>
    </nav>
  );
}
