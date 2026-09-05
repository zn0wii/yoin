import { useEffect, useRef, useState } from "react";
import {
  usePlayerStore,
  type MusicLibrary,
} from "../store/playerStore";
import { pickMusicFolder } from "../audio/libraryApi";
import "./LibraryManager.css";

function IconRefresh() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75M13.2 2.6v2.55h-2.55"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 4.6h10M6.4 4.6V3.2h3.2v1.4M4.4 4.6l.6 8h6l.6-8M6.7 7v3.4M9.3 7v3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2 4.4h4l1.2 1.5H14v6.7H2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 3v10M3 8h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function displayPath(lib: MusicLibrary, defaultMusicDir: string | null): string {
  if (lib.path) return lib.path;
  return defaultMusicDir ?? "（内置曲库 · 浏览器模式）";
}

/** One library row: click to activate, click the name to rename inline,
 * refresh re-scans, delete removes (falls over to another library). */
function LibraryRow({
  lib,
  active,
  canDelete,
  busy,
  error,
  onRefresh,
}: {
  lib: MusicLibrary;
  active: boolean;
  canDelete: boolean;
  busy: boolean;
  error: string | null;
  onRefresh: (id: string) => void;
}) {
  const renameLibrary = usePlayerStore((s) => s.renameLibrary);
  const removeLibrary = usePlayerStore((s) => s.removeLibrary);
  const setActiveLibraryId = usePlayerStore((s) => s.setActiveLibraryId);
  const defaultMusicDir = usePlayerStore((s) => s.defaultMusicDir);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(lib.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== lib.name) {
      renameLibrary(lib.id, draft);
    } else {
      setDraft(lib.name);
    }
  };

  return (
    <li
      className={`lib-row${active ? " active" : ""}`}
      onClick={() => setActiveLibraryId(lib.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editing) setActiveLibraryId(lib.id);
      }}
      aria-pressed={active}
      title="点击切换到此库"
    >
      <span className="lib-row-dot" aria-hidden />
      <div className="lib-row-main">
        {editing ? (
          <input
            ref={inputRef}
            className="lib-row-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setDraft(lib.name);
                setEditing(false);
              }
            }}
            autoFocus
            aria-label="库名"
          />
        ) : (
          <button
            className="lib-row-name"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(lib.name);
              setEditing(true);
            }}
            title="点击重命名"
          >
            {lib.name}
          </button>
        )}
        <span className="lib-row-path" title={displayPath(lib, defaultMusicDir)}>
          {displayPath(lib, defaultMusicDir)}
        </span>
        {error ? <span className="lib-row-error">{error}</span> : null}
      </div>
      <span className="lib-row-tag">{active ? "使用中" : ""}</span>
      <button
        className="lib-row-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRefresh(lib.id);
        }}
        disabled={busy}
        title="重新扫描此库"
        aria-label="刷新库"
      >
        {busy ? <span className="lib-row-spinner" aria-hidden /> : <IconRefresh />}
      </button>
      <button
        className="lib-row-btn danger"
        onClick={(e) => {
          e.stopPropagation();
          removeLibrary(lib.id);
        }}
        disabled={!canDelete}
        title={canDelete ? "删除此库（不删除磁盘文件）" : "至少保留一个库"}
        aria-label="删除库"
      >
        <IconTrash />
      </button>
    </li>
  );
}

/** Centered glass modal for managing music libraries: rename / refresh /
 * delete / add (custom name + native folder picker). */
export function LibraryManager({
  onRefresh,
}: {
  /** Rescans a library; applies the result when it is the active one,
   *  otherwise just validates the path (throws on failure). */
  onRefresh: (id: string) => Promise<void>;
}) {
  const libraries = usePlayerStore((s) => s.libraries);
  const activeLibraryId = usePlayerStore((s) => s.activeLibraryId);
  const toggleLibraryManager = usePlayerStore((s) => s.toggleLibraryManager);
  const addLibrary = usePlayerStore((s) => s.addLibrary);
  const setActiveLibraryId = usePlayerStore((s) => s.setActiveLibraryId);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newPath, setNewPath] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleLibraryManager();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLibraryManager]);

  const handleRefresh = async (id: string) => {
    setBusyId(id);
    setRowError(null);
    try {
      await onRefresh(id);
    } catch (err) {
      setRowError({ id, msg: String(err) });
    } finally {
      setBusyId(null);
    }
  };

  const handlePick = async () => {
    setPicking(true);
    try {
      const dir = await pickMusicFolder();
      if (dir) setNewPath(dir);
    } finally {
      setPicking(false);
    }
  };

  const handleAdd = () => {
    if (!newPath) return;
    const lib = addLibrary(newName, newPath);
    setActiveLibraryId(lib.id); // switch to it right away
    setNewName("");
    setNewPath(null);
  };

  return (
    <div className="lib-manager-overlay" onClick={toggleLibraryManager}>
      <div className="lib-manager" onClick={(e) => e.stopPropagation()}>
        <div className="lib-manager-header">
          <span>库管理</span>
          <button
            className="lib-manager-close"
            onClick={toggleLibraryManager}
            aria-label="关闭库管理"
          >
            ×
          </button>
        </div>

        <ul className="lib-manager-list">
          {libraries.map((lib) => (
            <LibraryRow
              key={lib.id}
              lib={lib}
              active={lib.id === activeLibraryId}
              canDelete={libraries.length > 1}
              busy={busyId === lib.id}
              error={rowError?.id === lib.id ? rowError.msg : null}
              onRefresh={(id) => void handleRefresh(id)}
            />
          ))}
        </ul>

        <div className="lib-manager-add">
          <input
            className="lib-manager-name-input"
            placeholder="库名（可选，默认取文件夹名）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            aria-label="新库名"
          />
          <button
            className="lib-manager-pick"
            onClick={() => void handlePick()}
            disabled={picking}
            title="选择系统文件夹作为扫描路径"
          >
            <IconFolder />
            <span>{newPath ? "重选路径" : "选择路径"}</span>
          </button>
          {newPath ? (
            <span className="lib-manager-path" title={newPath}>
              {newPath}
            </span>
          ) : null}
          <button
            className="lib-manager-add-btn"
            onClick={handleAdd}
            disabled={!newPath}
            title={newPath ? "添加并切换到此库" : "请先选择路径"}
          >
            <IconPlus />
            <span>添加</span>
          </button>
        </div>
      </div>
    </div>
  );
}
