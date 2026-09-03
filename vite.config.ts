import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Dev-only: serve /demo-library.json built from the real `music/` folder so
 * plain-browser `pnpm dev` (no Tauri backend) shows the same library as the
 * desktop app. Files are exposed through Vite's same-origin /@fs/ URLs.
 */
function demoLibraryPlugin(): Plugin {
  const musicDir = path.resolve(__dirname, "music");
  const asFsUrl = (p: string) => "/@fs/" + p.split(path.sep).join("/");

  const findCover = (dir: string): string | null => {
    const stems = ["cover", "folder", "album", "front", "artwork"];
    const exts = ["jpg", "jpeg", "png", "webp", "gif"];
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    for (const stem of stems) {
      for (const ext of exts) {
        const hit = files.find((f) => {
          const dot = f.lastIndexOf(".");
          if (dot <= 0) return false;
          return (
            f.slice(0, dot).toLowerCase() === stem &&
            f.slice(dot + 1).toLowerCase() === ext
          );
        });
        if (hit) return asFsUrl(path.join(dir, hit));
      }
    }
    // Last resort: any image in the folder — the largest one wins (covers
    // usually dwarf back scans and thumbnails).
    const isImage = (name: string) => {
      const dot = name.lastIndexOf(".");
      return dot > 0 && exts.includes(name.slice(dot + 1).toLowerCase());
    };
    let best: { name: string; size: number } | null = null;
    for (const name of files.filter(isImage)) {
      const size = fs.statSync(path.join(dir, name)).size;
      if (!best || size > best.size) best = { name, size };
    }
    return best ? asFsUrl(path.join(dir, best.name)) : null;
  };

  const AUDIO_EXTS = ["mp3", "flac", "m4a", "ogg", "opus", "wav", "aac"];
  const isAudio = (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot > 0 && AUDIO_EXTS.includes(name.slice(dot + 1).toLowerCase());
  };
  const stripAudioExt = new RegExp(`\\.(${AUDIO_EXTS.join("|")})$`, "i");

  /** Audio files directly inside `dir`, sorted by title. */
  const collectAudio = (dir: string) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && isAudio(e.name))
      .map((e) => ({
        title: e.name.replace(stripAudioExt, ""),
        path: asFsUrl(path.join(dir, e.name)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

  const listSubdirs = (dir: string) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

  const scanAlbum = (dir: string, albumName: string, artist: string) => {
    // Multi-disc layouts: album/cd1, album/cd2 — own files first, then each
    // subfolder in name order so disc order is preserved.
    const tracks = [...collectAudio(dir)];
    const subs = listSubdirs(dir);
    for (const sub of subs) {
      tracks.push(...collectAudio(path.join(dir, sub)));
    }
    if (tracks.length === 0) return null;
    const cover =
      findCover(dir) ??
      subs.map((sub) => findCover(path.join(dir, sub))).find(Boolean) ??
      null;
    return { name: albumName, artist, tracks, cover };
  };

  const listDirs = (dir: string) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

  return {
    name: "demo-library",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/demo-library.json", (_req, res) => {
        try {
          const albums: unknown[] = [];
          for (const artist of listDirs(musicDir)) {
            const artistDir = path.join(musicDir, artist);
            for (const album of listDirs(artistDir)) {
              const hit = scanAlbum(
                path.join(artistDir, album),
                album,
                artist
              );
              if (hit) albums.push(hit);
            }
          }
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(albums));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), demoLibraryPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      //    plus anything under `assets/` (glob matching proved unreliable for
      //    deeply nested new files on Windows — a normalized-path function is
      //    airtight against EBUSY crashes from files locked by other apps)
      ignored: [
        "**/src-tauri/**",
        (path: string) => {
        const p = path.replace(/\\/g, "/");
        return /\/assets$/.test(p) || /\/assets\//.test(p);
        },
      ],
    },
  },
}));
