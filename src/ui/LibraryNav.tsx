import { usePlayerStore } from "../store/playerStore";

function IconVinyl() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3 5.2h4.2l1.3 1.6H17v8.6H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
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

export function LibraryNav({
  onPickFolder,
}: {
  onPickFolder: () => void;
}) {
  const libraryOpen = usePlayerStore((s) => s.libraryOpen);
  const toggleLibrary = usePlayerStore((s) => s.toggleLibrary);
  const searchOpen = usePlayerStore((s) => s.searchOpen);
  const toggleSearch = usePlayerStore((s) => s.toggleSearch);
  const isLoading = usePlayerStore((s) => s.isLoading);

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
        onClick={onPickFolder}
        disabled={isLoading}
        title="选择音乐文件夹（root / 艺术家 / 专辑）"
      >
        <IconFolder />
        <span>{isLoading ? "扫描中…" : "添加文件夹"}</span>
      </button>
    </nav>
  );
}
