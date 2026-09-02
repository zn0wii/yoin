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
          const [s, e] = f.split(".");
          return (
            s?.toLowerCase() === stem && e?.toLowerCase() === ext
          );
        });
        if (hit) return asFsUrl(path.join(dir, hit));
      }
    }
    return null;
  };

  const scanAlbum = (dir: string, name: string) => {
    const tracks = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp3"))
      .map((e) => ({
        title: e.name.replace(/\.mp3$/i, ""),
        path: asFsUrl(path.join(dir, e.name)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return tracks.length > 0 ? { name, tracks, cover: findCover(dir) } : null;
  };

  return {
    name: "demo-library",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/demo-library.json", (_req, res) => {
        try {
          const albums: unknown[] = [];
          const root = scanAlbum(musicDir, "Root");
          if (root) albums.push(root);
          for (const entry of fs
            .readdirSync(musicDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()) {
            const album = scanAlbum(
              path.join(musicDir, entry),
              entry
            );
            if (album) albums.push(album);
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
      //    and design-reference assets (locked files there crash the watcher)
      ignored: ["**/src-tauri/**", "assets/**"],
    },
  },
}));
