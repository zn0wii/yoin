import { useEffect, useState } from "react";

/**
 * Derive a vinyl-disc palette from an album cover's dominant color.
 *
 * The disc body should read as tinted vinyl plastic (dark, hue preserved)
 * while the paper label keeps a brighter version of the same tone.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface VinylPalette {
  /** Dark plastic body of the disc, tinted toward the cover. */
  body: string;
  /** Brighter paper-label tone. */
  label: string;
  /** Bright translucent-PVC tone for the large 3D record. */
  sheer: string;
}

/* --- pixel access --------------------------------------------------------- */

const SAMPLE_SIZE = 32;

/**
 * Downscale the image to a tiny canvas and read its pixels.
 * Tries fetch → blob first (same-origin / CORS-permitted URLs, incl. Tauri's
 * asset protocol); falls back to a plain <img>. Returns null when the pixels
 * can't be read (tainted canvas, decode failure, …).
 */
async function loadPixels(
  url: string
): Promise<Uint8ClampedArray | null> {
  const read = (source: CanvasImageSource): Uint8ClampedArray | null => {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    try {
      return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
    } catch {
      return null; // canvas tainted by cross-origin pixels
    }
  };

  try {
    const res = await fetch(url);
    if (res.ok) {
      const bmp = await createImageBitmap(await res.blob());
      const pixels = read(bmp);
      bmp.close();
      if (pixels) return pixels;
    }
  } catch {
    // fall through to <img>
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = "async";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("cover decode failed"));
      el.src = url;
    });
    return read(img);
  } catch {
    return null;
  }
}

/* --- dominant color ------------------------------------------------------- */

/**
 * Saturation-weighted histogram: bucket pixels at 4 bits/channel and score
 * each bucket by count × (0.2 + saturation), so vivid areas win over muddy
 * gray-brown averages. Returns the mean color of the winning bucket.
 */
function dominantColor(data: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<
    number,
    { w: number; n: number; r: number; g: number; b: number }
  >();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { w: 0, n: 0, r: 0, g: 0, b: 0 };
    bucket.w += 0.2 + sat;
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  let best: { w: number; n: number; r: number; g: number; b: number } | null =
    null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.w > best.w) best = bucket;
  }
  if (!best || best.n === 0) return null;
  return {
    r: best.r / best.n,
    g: best.g / best.n,
    b: best.b / best.n,
  };
}

/* --- palette derivation ---------------------------------------------------- */

function rgbToHsl({ r, g, b }: Rgb) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const f = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, hue + 1 / 3);
    g = f(p, q, hue);
    b = f(p, q, hue - 1 / 3);
  }
  const to255 = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** Map a dominant cover color onto the disc body + label tones. */
export function vinylPaletteFrom(rgb: Rgb): VinylPalette {
  const { h, s, l } = rgbToHsl(rgb);
  // Grayscale covers stay neutral; colorful ones keep their hue but get
  // pressed into "vinyl plastic" range: saturated enough to read as a tint,
  // dark enough that the groove highlights still show.
  const bodyS = s < 0.12 ? s : clamp(s * 0.9, 0.28, 0.65);
  const body = hslToHex(h, bodyS, 0.24);
  const label = hslToHex(h, clamp(s, 0.3, 0.85), clamp(l, 0.46, 0.64));
  // Translucent colored pressing for the 3D record: same hue, lifted into
  // the milky-bright range the groove highlights still read through. Deeper
  // than the stock pink — short-wavelength hues (blue/green) need the extra
  // chroma to stay visible under the stage's warm lights.
  const sheerS = s < 0.12 ? 0.07 : clamp(s * 0.95, 0.5, 0.72);
  const sheer = hslToHex(h, sheerS, clamp(l + 0.38, 0.66, 0.74));
  return { body, label, sheer };
}

/** Translucent-PVC hex for a manual hue (0–360) — matches the sheer tone. */
export function sheerHueHex(hue: number): string {
  return hslToHex(hue, 0.64, 0.7);
}

/* --- public API ------------------------------------------------------------ */

const cache = new Map<string, VinylPalette | null>();

/** Extract the disc palette for a cover URL (memoized across cards/renders). */
export async function fetchVinylPalette(url: string): Promise<VinylPalette | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  const pixels = await loadPixels(url);
  let palette: VinylPalette | null = null;
  if (pixels) {
    const dominant = dominantColor(pixels);
    if (dominant) palette = vinylPaletteFrom(dominant);
  }
  cache.set(url, palette);
  return palette;
}

/** Resolve the disc palette for a cover path; null until extracted (or on failure). */
export function useVinylPalette(coverUrl: string | null): VinylPalette | null {
  const [palette, setPalette] = useState<VinylPalette | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!coverUrl) {
      setPalette(null);
      return;
    }
    const hit = cache.get(coverUrl);
    if (hit) {
      setPalette(hit);
      return;
    }
    fetchVinylPalette(coverUrl)
      .then((p) => {
        if (!cancelled) setPalette(p);
      })
      .catch(() => {
        if (!cancelled) setPalette(null);
      });
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return palette;
}
