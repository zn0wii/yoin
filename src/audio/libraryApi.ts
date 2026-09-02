import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Album } from "../store/playerStore";

const WEB_DEMO_ALBUMS: Album[] = [
  {
    name: "siren",
    cover: "/demo/cover.jpg",
    tracks: [
      { title: "running", path: "/demo/running.mp3" },
      { title: "siren", path: "/demo/siren.mp3" },
    ],
  },
];

/** Scan the default (or given) music directory into a list of albums. */
export async function scanLibrary(dir?: string): Promise<Album[]> {
  try {
    return await invoke<Album[]>("scan_library", { dir: dir ?? null });
  } catch (err) {
    // Browser `pnpm dev` has no Tauri backend — serve a tiny demo library.
    if (import.meta.env.DEV) {
      console.warn("scan_library unavailable, using web demo library:", err);
      return WEB_DEMO_ALBUMS;
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
