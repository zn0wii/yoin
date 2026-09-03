import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Album } from "../store/playerStore";

/**
 * Scan the default (or given) music directory into a list of albums.
 * In plain-browser dev (no Tauri backend) fall back to /demo-library.json,
 * which the Vite dev server generates from the real `music/` folder.
 */
export async function scanLibrary(dir?: string): Promise<Album[]> {
  try {
    return await invoke<Album[]>("scan_library", { dir: dir ?? null });
  } catch (err) {
    if (import.meta.env.DEV) {
      try {
        const res = await fetch("/demo-library.json");
        if (res.ok) return (await res.json()) as Album[];
      } catch {
        // fall through
      }
      console.warn("scan_library unavailable, dev library fetch failed:", err);
      return [];
    }
    throw err;
  }
}

/** Open a native folder picker. Returns null if the user cancelled. */
export async function pickMusicFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}
