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

  /* --- CUE sheets: single-file rip → virtual tracks ----------------------- */

  interface CueEntry {
    file: string;
    title: string;
    start: number;
  }

  const quotedArg = (line: string): string | null => {
    const start = line.indexOf('"');
    const end = line.lastIndexOf('"');
    return start >= 0 && end > start ? line.slice(start + 1, end) : null;
  };

  /** `MM:SS:FF` (75 frames/sec) → seconds. */
  const cueIndexTime = (arg: string): number | null => {
    const parts = arg.split(":");
    if (parts.length !== 3) return null;
    const mm = Number(parts[0]);
    const ss = Number(parts[1]);
    const ff = Number(parts[2]);
    if ([mm, ss, ff].some((n) => !Number.isFinite(n))) return null;
    return mm * 60 + ss + ff / 75;
  };

  const parseCue = (buf: Buffer): CueEntry[] => {
    // BOMs win, then valid UTF-8, then GBK (common for Chinese CD rips).
    let text: string;
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      text = new TextDecoder("utf-16le").decode(buf);
    } else if (buf[0] === 0xfe && buf[1] === 0xff) {
      text = new TextDecoder("utf-16be").decode(buf);
    } else {
      text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("\uFFFD")) {
        try {
          text = new TextDecoder("gbk").decode(buf);
        } catch {
          // keep the lossy UTF-8 text
        }
      }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const entries: CueEntry[] = [];
    let file = "";
    let title: string | null = null;
    let start: number | null = null;
    let inTrack = false;

    const flush = () => {
      if (inTrack && title != null && start != null) {
        entries.push({ file, title, start });
      }
      title = null;
      start = null;
      inTrack = false;
    };

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("REM")) continue;
      const command = line.split(/\s+/)[0]?.toUpperCase();
      const arg = quotedArg(line) ?? line.split(/\s+/).slice(1).join(" ");
      switch (command) {
        case "FILE":
          flush();
          file = arg;
          break;
        case "TRACK": {
          flush();
          const type = line.split(/\s+/).pop();
          inTrack = type?.toUpperCase() === "AUDIO";
          break;
        }
        case "TITLE":
          if (inTrack) title = arg;
          break;
        case "INDEX": {
          if (!inTrack) break;
          const parts = line.split(/\s+/);
          if (parts[1] === "01") {
            const secs = cueIndexTime(parts[2] ?? "");
            if (secs != null) start = secs;
          }
          break;
        }
      }
    }
    flush();
    return entries;
  };

  /** Audio files directly inside `dir`. A `.cue` sheet replaces its
   *  single-file rip with virtual tracks carrying start offsets. */
  const collectAudio = (dir: string) => {
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    const cues = files.filter((f) => f.toLowerCase().endsWith(".cue"));

    const tracks: Array<{
      title: string;
      path: string;
      start?: number;
    }> = [];
    const consumed = new Set<string>(); // lowercase names claimed by cues

    for (const cue of cues) {
      const entries = parseCue(fs.readFileSync(path.join(dir, cue)));
      for (const entry of entries) {
        const target = path.join(dir, entry.file);
        if (!fs.existsSync(target) || !isAudio(entry.file)) continue;
        consumed.add(entry.file.toLowerCase());
        tracks.push({
          title: entry.title,
          path: asFsUrl(target),
          start: entry.start,
        });
      }
    }

    for (const name of files.filter(isAudio)) {
      if (consumed.has(name.toLowerCase())) continue;
      tracks.push({
        title: name.replace(stripAudioExt, ""),
        path: asFsUrl(path.join(dir, name)),
      });
    }

    // CUE order is authoritative; plain folders sort by title.
    if (tracks.every((t) => t.start == null)) {
      tracks.sort((a, b) => a.title.localeCompare(b.title));
    }
    return tracks;
  };

  const listSubdirs = (dir: string) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

  const scanAlbum = (
    dir: string,
    albumName: string,
    artist: string | null
  ) => {
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
          for (const first of listDirs(musicDir)) {
            const firstDir = path.join(musicDir, first);
            // Flat layout: audio files directly in the first-level folder
            // make it an album itself; otherwise it's an artist folder.
            if (collectAudio(firstDir).length > 0) {
              const hit = scanAlbum(firstDir, first, null);
              if (hit) albums.push(hit);
              continue;
            }
            for (const album of listDirs(firstDir)) {
              const hit = scanAlbum(
                path.join(firstDir, album),
                album,
                first
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
        // 3. tell Vite to ignore watching `src-tauri`, `music/` and anything
        //    under `assets/` (glob matching proved unreliable for deeply
        //    nested new files on Windows — a normalized-path function is
        //    airtight against EBUSY crashes from files locked by other apps;
        //    `music/` is only read per-request by the demo-library middleware)
        ignored: [
          "**/src-tauri/**",
          "**/music/**",
          (path: string) => {
            const p = path.replace(/\\/g, "/");
            return /\/assets$/.test(p) || /\/assets\//.test(p);
          },
        ],
      },
  },
}));
