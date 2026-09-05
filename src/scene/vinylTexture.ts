import * as THREE from "three";

const GROOVE_SIZE = 2048;
const LABEL_SIZE = 1024;
/** Disc fills the texture so RingGeometry UVs (0–1) land on the rim. */
const DISC_R = 0.5;
/** Center label radius as a fraction of disc radius. */
export const LABEL_OF_DISC = 0.4;
/** Pixels near this luminance count as "border / letterbox". */
const BORDER_LUMA = 245;

export type VinylGrooveMaps = {
  map: THREE.DataTexture;
  /** The original pink-baked albedo — the pre-custom-color "默认" look. */
  legacyMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

/** The original (pre-custom-color) pink ramp, restored verbatim from the
 *  earliest version: pinker near the label, paler toward the rim. */
const VINYL_STOPS_ORIGINAL: { t: number; r: number; g: number; b: number }[] = [
  { t: 0.0, r: 204, g: 118, b: 138 },
  { t: 0.06, r: 220, g: 122, b: 142 },
  { t: 0.22, r: 232, g: 136, b: 154 },
  { t: 0.48, r: 236, g: 150, b: 164 },
  { t: 0.75, r: 238, g: 168, b: 178 },
  { t: 0.92, r: 240, g: 186, b: 194 },
  { t: 0.98, r: 236, g: 178, b: 188 },
  { t: 1.0, r: 220, g: 150, b: 164 },
];

/** Opaque grayscale luminance ramp (t = 0 at label edge, 1 at rim). The hue
 *  lives in material.color (final albedo = map × color), so the disc can be
 *  re-tinted per frame without regenerating this texture. Disc translucency
 *  is applied via material.opacity so alpha blending stays reliable with
 *  MeshPhysicalMaterial + clearcoat. Tuned against assets/vinyl.png. */
const VINYL_STOPS: { t: number; r: number; g: number; b: number }[] = [
  { t: 0.0, r: 204, g: 204, b: 204 },
  { t: 0.06, r: 220, g: 220, b: 220 },
  { t: 0.22, r: 232, g: 232, b: 232 },
  { t: 0.48, r: 236, g: 236, b: 236 },
  { t: 0.75, r: 238, g: 238, b: 238 },
  { t: 0.92, r: 240, g: 240, b: 240 },
  { t: 0.98, r: 236, g: 236, b: 236 },
  { t: 1.0, r: 220, g: 220, b: 220 },
];

/** Stock rose-quartz tint — multiplies the grayscale albedo back to the
 *  original pink (calibrated at the mid-groove stop, 236 × #ffa2b1 ≈ pink). */
export const DEFAULT_DISC_TINT = "#ffa2b1";

function lerpStops(
  t: number,
  stops: { t: number; r: number; g: number; b: number }[] = VINYL_STOPS
): { r: number; g: number; b: number } {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 2 && stops[i + 1].t < x) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const u = (x - a.t) / Math.max(1e-6, b.t - a.t);
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
  };
}

/** sinc(x) = sin(πx)/(πx) — used to anti-alias groove sine rings. */
function sinc(x: number) {
  if (Math.abs(x) < 1e-5) return 1;
  const p = x * Math.PI;
  return Math.sin(p) / p;
}

function grooveWave(r: number, period: number) {
  const phase = (r / period) * Math.PI * 2;
  // Mild 2nd harmonic → slightly V-shaped lands, like a pressed groove.
  const s = Math.sin(phase) * 0.78 + Math.sin(phase * 2) * 0.22;
  return s * sinc(1 / period);
}

function toDataTexture(
  data: Uint8Array,
  size: number,
  srgb: boolean
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 16;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * PBR pack for the grooved PVC: grayscale milky albedo (with alpha — tint
 * via material.color), concentric groove normals, roughness, and a circular
 * anisotropy direction field. Generated once — independent of the center label.
 */
export function makeVinylGrooveMaps(): VinylGrooveMaps {
  const size = GROOVE_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const discPx = size * DISC_R;
  const labelPx = discPx * LABEL_OF_DISC;
  const deadWax = labelPx + size * 0.012;
  const period = 2.0;
  const amp = 0.28;

  const albedo = new Uint8Array(size * size * 4);
  const albedoLegacy = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);

  // 1D radial profiles — analytical normals stay perfectly circular.
  const nProf = size + 2;
  const height = new Float32Array(nProf);
  const hPrime = new Float32Array(nProf);

  for (let i = 0; i < nProf; i++) {
    const r = i;
    if (r < labelPx || r > discPx) {
      height[i] = 0;
      continue;
    }
    const t = (r - labelPx) / (discPx - labelPx);
    const inDead = r < deadWax ? (deadWax - r) / (deadWax - labelPx) : 0;
    const envelope = (0.5 + 0.5 * Math.pow(t, 0.55)) * (1 - inDead * 0.92);
    const group = Math.sin(r * 0.4) * 0.22;
    const lead =
      1 +
      0.28 * (1 - smooth01((r - labelPx) / 22)) +
      0.2 * smooth01((r - (discPx - 26)) / 18);
    height[i] = (grooveWave(r, period) + group) * envelope * lead * amp;
    // Raised lip at the physical rim.
    if (t > 0.975) height[i] += ((t - 0.975) / 0.025) * 0.22;
  }
  for (let i = 1; i < nProf - 1; i++) {
    hPrime[i] = (height[i + 1] - height[i - 1]) * 0.5;
  }

  const flatN = 127;

  for (let y = 0; y < size; y++) {
    const py = y + 0.5 - cy; // +up, GL-style (flipY = false)
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - cx;
      const r = Math.hypot(px, py);
      const i = (y * size + x) * 4;

      if (r > discPx + 0.6) {
        albedo[i] = 0;
        albedo[i + 1] = 0;
        albedo[i + 2] = 0;
        albedo[i + 3] = 0;
        albedoLegacy[i] = 0;
        albedoLegacy[i + 1] = 0;
        albedoLegacy[i + 2] = 0;
        albedoLegacy[i + 3] = 0;
        normal[i] = flatN;
        normal[i + 1] = flatN;
        normal[i + 2] = 255;
        normal[i + 3] = 255;
        rough[i] = 80;
        rough[i + 1] = 80;
        rough[i + 2] = 80;
        rough[i + 3] = 255;
        continue;
      }

      const t = (r - labelPx) / Math.max(1, discPx - labelPx);
      const col = lerpStops(t);
      const ri = Math.min(nProf - 2, Math.max(1, r | 0));
      const frac = r - ri;
      const hp = hPrime[ri] + (hPrime[ri + 1] - hPrime[ri]) * frac;

      // Very soft land/valley albedo — the silvery band mostly comes from
      // normals + anisotropy, not painted dark rings. Grayscale only: the
      // hue is applied by material.color at draw time.
      const wave = grooveWave(r, period);
      const inGroove = r >= labelPx && r <= discPx ? 1 : 0;
      const lift = wave * 12 * inGroove;
      const silver = Math.max(0, wave) * 20 * inGroove;
      const rC = Math.min(255, Math.max(0, col.r + lift + silver));
      const gC = rC;
      const bC = rC;
      // Original pink bake: per-channel groove lift (restored verbatim).
      const colL = lerpStops(t, VINYL_STOPS_ORIGINAL);
      const rL = Math.min(255, Math.max(0, colL.r + lift + silver));
      const gL = Math.min(255, Math.max(0, colL.g + lift * 0.75 + silver));
      const bL = Math.min(255, Math.max(0, colL.b + lift * 0.8 + silver * 0.95));
      const aa = r > discPx ? Math.max(0, 1 - (r - discPx)) : 1;

      albedo[i] = rC;
      albedo[i + 1] = gC;
      albedo[i + 2] = bC;
      albedo[i + 3] = 255 * aa;

      albedoLegacy[i] = rL;
      albedoLegacy[i + 1] = gL;
      albedoLegacy[i + 2] = bL;
      albedoLegacy[i + 3] = 255 * aa;

      // Tangent-space normal from radial height. nz stays ~1 (shallow grooves).
      const invR = r > 0.25 ? 1 / r : 0;
      let nx = -hp * px * invR;
      let ny = -hp * py * invR;
      const invLen = 1 / Math.hypot(nx, ny, 1);
      nx *= invLen;
      ny *= invLen;
      const nz = invLen;
      normal[i] = Math.min(255, Math.max(0, nx * 127.5 + 127.5));
      normal[i + 1] = Math.min(255, Math.max(0, ny * 127.5 + 127.5));
      normal[i + 2] = Math.min(255, Math.max(0, nz * 127.5 + 127.5));
      normal[i + 3] = 255;

      // Peaks glossier — that's where the silvery band lives.
      const rg = 0.22 + wave * -0.08 + (1 - inGroove) * 0.1;
      const rv = Math.min(255, Math.max(0, rg * 255));
      rough[i] = rv;
      rough[i + 1] = rv;
      rough[i + 2] = rv;
      rough[i + 3] = 255;
    }
  }

  return {
    map: toDataTexture(albedo, size, true),
    legacyMap: toDataTexture(albedoLegacy, size, true),
    normalMap: toDataTexture(normal, size, false),
    roughnessMap: toDataTexture(rough, size, false),
  };
}

/* --- Custom-hue tint ramp --------------------------------------------------
 * The original pink bake's radial chroma profile (pinker near the label,
 * paler toward the rim), re-hued on demand and applied inside the face
 * shader: RGB = original stops re-hued to the tint, A = the matching
 * grayscale stop in LINEAR bytes (sRGB textures leave alpha undecoded),
 * so the shader can lift the groove silver back on top. */

const RAMP_N = 256;

export interface TintRamp {
  tex: THREE.DataTexture;
  /** Re-hue the ramp; tint given in LINEAR working-space rgb (0–1). */
  update: (r: number, g: number, b: number) => void;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function srgbByteToLinearByte(v: number): number {
  const c = v / 255;
  const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return Math.round(Math.min(255, Math.max(0, lin * 255)));
}

export function makeTintRamp(): TintRamp {
  const data = new Uint8Array(RAMP_N * 4);
  const tex = new THREE.DataTexture(data, RAMP_N, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;

  // Texel index → label→rim stop parameter (same mapping the albedo uses).
  const ts = new Float32Array(RAMP_N);
  for (let i = 0; i < RAMP_N; i++) {
    const f = i / (RAMP_N - 1);
    ts[i] = Math.min(1, Math.max(0, (f - LABEL_OF_DISC) / (1 - LABEL_OF_DISC)));
  }

  const linToSrgb = (c: number) =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  const update = (r: number, g: number, b: number) => {
    // Extract the hue from the (linear) tint in sRGB terms.
    const [th] = rgbToHsl(
      Math.round(linToSrgb(r) * 255),
      Math.round(linToSrgb(g) * 255),
      Math.round(linToSrgb(b) * 255)
    );
    for (let i = 0; i < RAMP_N; i++) {
      const o = lerpStops(ts[i], VINYL_STOPS_ORIGINAL);
      const [, s, l] = rgbToHsl(o.r, o.g, o.b);
      const [rr, gg, bb] = hslToRgb(th, s, l);
      data[i * 4] = Math.round(rr * 255);
      data[i * 4 + 1] = Math.round(gg * 255);
      data[i * 4 + 2] = Math.round(bb * 255);
      data[i * 4 + 3] = srgbByteToLinearByte(lerpStops(ts[i]).r);
    }
    tex.needsUpdate = true;
  };

  const stock = new THREE.Color(DEFAULT_DISC_TINT);
  update(stock.r, stock.g, stock.b);
  return { tex, update };
}

function smooth01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Find the content box of a cover by trimming near-white letterbox / margins,
 * then return a centered square crop inside that box.
 */
function contentSquare(
  img: HTMLImageElement
): { sx: number; sy: number; sw: number; sh: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const probe = document.createElement("canvas");
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(img, 0, 0);
  const { data } = pctx.getImageData(0, 0, w, h);

  const isBorder = (i: number) => {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 8) return true;
    return r >= BORDER_LUMA && g >= BORDER_LUMA && b >= BORDER_LUMA - 8;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  outerTop: for (; top < h; top++) {
    for (let x = 0; x < w; x++) {
      if (!isBorder((top * w + x) * 4)) break outerTop;
    }
  }
  outerBottom: for (; bottom > top; bottom--) {
    for (let x = 0; x < w; x++) {
      if (!isBorder((bottom * w + x) * 4)) break outerBottom;
    }
  }
  outerLeft: for (; left < w; left++) {
    for (let y = top; y <= bottom; y++) {
      if (!isBorder((y * w + left) * 4)) break outerLeft;
    }
  }
  outerRight: for (; right > left; right--) {
    for (let y = top; y <= bottom; y++) {
      if (!isBorder((y * w + right) * 4)) break outerRight;
    }
  }

  if (right - left < 8 || bottom - top < 8) {
    const side = Math.min(w, h);
    return { sx: (w - side) / 2, sy: (h - side) / 2, sw: side, sh: side };
  }

  const bw = right - left + 1;
  const bh = bottom - top + 1;
  const side = Math.min(bw, bh);
  const sx = left + (bw - side) / 2;
  const sy = top + (bh - side) / 2;
  const inset = Math.max(1, side * 0.02);
  return {
    sx: sx + inset,
    sy: sy + inset,
    sw: side - inset * 2,
    sh: side - inset * 2,
  };
}

function drawPaperGrain(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  lr: number
) {
  const g = document.createElement("canvas");
  const side = Math.ceil(lr * 2);
  g.width = side;
  g.height = side;
  const gctx = g.getContext("2d")!;
  const img = gctx.createImageData(side, side);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 255) | 0;
    img.data[i] = n;
    img.data[i + 1] = n;
    img.data[i + 2] = n;
    img.data[i + 3] = 22;
  }
  gctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(g, cx - lr, cy - lr, side, side);
  ctx.restore();
}

/** No-cover fallback: coral → cream concentric target, matching vinyl.png. */
function drawFallbackLabel(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const lr = size / 2;
  const stops = [
    "#7a444e",
    "#9a4e58",
    "#c0565c",
    "#d46658",
    "#e27a5c",
    "#ee9168",
    "#f4aa80",
    "#f4c4a0",
    "#f3d8bc",
    "#f0e4d2",
  ];
  for (let i = 0; i < stops.length; i++) {
    ctx.fillStyle = stops[i];
    ctx.beginPath();
    ctx.arc(cx, cy, lr * (1 - i / stops.length), 0, Math.PI * 2);
    ctx.fill();
  }
}

/* --- no-cover typography: print the album (folder) name on the label ------ */

const LABEL_INK = "rgba(46, 30, 32, 0.85)";
const LABEL_FONT = `"SF Pro Text", "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`;

/** Characters that may wrap between any two instances (CJK, kana, Hangul,
 *  fullwidth punctuation). Latin runs stay unbreakable words. */
function isBreakableChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x2e80 && cp <= 0x9fff) || // CJK blocks
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xff00 && cp <= 0xffef) // fullwidth forms
  );
}

/** Split into wrap atoms: latin words whole, CJK per character. */
function tokenizeLabel(text: string): string[] {
  const tokens: string[] = [];
  let word = "";
  const flush = () => {
    if (word) tokens.push(word);
    word = "";
  };
  for (const ch of text) {
    if (/\s/.test(ch)) {
      flush();
    } else if (isBreakableChar(ch)) {
      flush();
      tokens.push(ch);
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

/** Join two atoms without a space when either side is CJK. */
function joinAtoms(a: string, b: string): string {
  const aBreak = isBreakableChar(a[a.length - 1] ?? "");
  const bBreak = isBreakableChar(b[0] ?? "");
  return aBreak || bBreak ? a + b : `${a} ${b}`;
}

/** Greedy wrap at the ctx's current font; one atom per overflow step. */
function wrapLabelLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const tokens = tokenizeLabel(text);
  if (tokens.length === 0) return [];
  const lines: string[] = [];
  let line = tokens[0];
  for (let i = 1; i < tokens.length; i++) {
    const joined = joinAtoms(line, tokens[i]);
    if (ctx.measureText(joined).width <= maxWidth) {
      line = joined;
    } else {
      lines.push(line);
      line = tokens[i];
    }
  }
  lines.push(line);
  return lines;
}

/** Shrink from maxSize until the text fits `maxLines`; hard-clamp as a last resort. */
function fitLabelLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  maxSize: number,
  minSize: number
): { size: number; lines: string[] } {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `600 ${size}px ${LABEL_FONT}`;
    const lines = wrapLabelLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  ctx.font = `600 ${minSize}px ${LABEL_FONT}`;
  return {
    size: minSize,
    lines: wrapLabelLines(ctx, text, maxWidth).slice(0, maxLines),
  };
}

/** Single line that never exceeds maxWidth: shrink, then ellipsize. */
function fitLabelLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  size: number,
  weight = "500"
): string {
  ctx.font = `${weight} ${size}px ${LABEL_FONT}`;
  let out = text;
  while (
    out.length > 1 &&
    ctx.measureText(`${out}…`).width > maxWidth &&
    size > 14
  ) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${LABEL_FONT}`;
  }
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out === text ? out : `${out}…`;
}

/**
 * Print the album (folder) name + artist over the fallback target so a
 * cover-less folder still reads as "its own record". Title block is
 * bottom-anchored above the spindle hole, artist + rpm mark below it.
 */
function drawFallbackTitle(
  ctx: CanvasRenderingContext2D,
  size: number,
  title?: string | null,
  artist?: string | null
) {
  const clean = (s?: string | null) => (s ?? "").trim().replace(/\s+/g, " ");
  const name = clean(title);
  const who = clean(artist);
  if (!name && !who) return;

  const cx = size / 2;
  const maxW = size * 0.6;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_INK;

  if (name) {
    const { size: fontPx, lines } = fitLabelLines(
      ctx,
      name,
      maxW,
      3,
      Math.round(size * 0.062),
      Math.round(size * 0.03)
    );
    const lineH = fontPx * 1.22;
    // Bottom edge stays clear of the spindle hole (r ≈ 0.038·size).
    let y = size * 0.445 - (lines.length - 0.5) * lineH;
    ctx.font = `600 ${fontPx}px ${LABEL_FONT}`;
    const ls = fontPx * 0.03;
    ctx.letterSpacing = `${ls}px`;
    for (const line of lines) {
      // Trailing letter-space is counted in the glyph run — nudge back half.
      ctx.fillText(line, cx + ls / 2, y);
      y += lineH;
    }
    ctx.letterSpacing = "0px";
  }

  if (who) {
    const fontPx = Math.round(size * 0.028);
    ctx.font = `500 ${fontPx}px ${LABEL_FONT}`;
    const ls = fontPx * 0.16;
    ctx.letterSpacing = `${ls}px`;
    ctx.fillStyle = "rgba(46, 30, 32, 0.62)";
    ctx.fillText(fitLabelLine(ctx, who.toUpperCase(), maxW, fontPx), cx + ls / 2, size * 0.63);
    ctx.letterSpacing = "0px";
  }

  ctx.font = `500 ${Math.round(size * 0.02)}px ${LABEL_FONT}`;
  ctx.letterSpacing = `${size * 0.004}px`;
  ctx.fillStyle = "rgba(46, 30, 32, 0.5)";
  ctx.fillText("33⅓ RPM · LONG PLAY", cx + size * 0.002, size * 0.78);
  ctx.letterSpacing = "0px";
  ctx.restore();
}

function drawCoverLabel(
  ctx: CanvasRenderingContext2D,
  size: number,
  cover: HTMLImageElement
) {
  const cx = size / 2;
  const cy = size / 2;
  const lr = size / 2;
  const crop = contentSquare(cover);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#1a1816";
  ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);

  ctx.drawImage(
    cover,
    crop.sx,
    crop.sy,
    crop.sw,
    crop.sh,
    cx - lr,
    cy - lr,
    lr * 2,
    lr * 2
  );

  const vig = ctx.createRadialGradient(cx, cy, lr * 0.35, cx, cy, lr);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(0.7, "rgba(0,0,0,0.06)");
  vig.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vig;
  ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);

  ctx.restore();
}

function drawLabelRim(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const lr = size / 2;

  drawPaperGrain(ctx, cx, cy, lr);

  ctx.beginPath();
  ctx.arc(cx, cy, lr - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = size * 0.007;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, lr - size * 0.012, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = size * 0.004;
  ctx.stroke();
}

function drawSpindleHole(ctx: CanvasRenderingContext2D, size: number) {
  const cx = size / 2;
  const cy = size / 2;
  const hole = size * 0.038;
  ctx.fillStyle = "#2a1c1e";
  ctx.beginPath();
  ctx.arc(cx, cy, hole, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 230, 220, 0.28)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, hole, 0, Math.PI * 2);
  ctx.stroke();
}

function toCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Paper label that fills CircleGeometry's 0–1 UV (square canvas, circular art).
 *  Without a cover, prints the album (folder) name on the fallback target. */
export function makeVinylLabelTexture(
  coverImage?: HTMLImageElement | null,
  fallbackTitle?: string | null,
  fallbackArtist?: string | null
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_SIZE;
  canvas.height = LABEL_SIZE;
  const ctx = canvas.getContext("2d")!;

  if (coverImage && coverImage.complete && coverImage.naturalWidth > 0) {
    drawCoverLabel(ctx, LABEL_SIZE, coverImage);
  } else {
    drawFallbackLabel(ctx, LABEL_SIZE);
    drawFallbackTitle(ctx, LABEL_SIZE, fallbackTitle, fallbackArtist);
  }
  drawLabelRim(ctx, LABEL_SIZE);
  drawSpindleHole(ctx, LABEL_SIZE);

  return toCanvasTexture(canvas);
}

/** Soft radial white glow for the backlit platter center — tinted at draw
 *  time by the mesh material's color (final = map × color). */
export function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.16, "rgba(255,255,255,0.8)");
  g.addColorStop(0.45, "rgba(255,255,255,0.34)");
  g.addColorStop(0.85, "rgba(255,255,255,0.18)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return toCanvasTexture(canvas);
}

/**
 * Frosted acrylic platter face: milky white center fading to pale pink with a
 * more translucent rim (alpha channel), so the white plinth shows through.
 */
export function makePlatterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "rgba(248,243,240,0.98)");
  g.addColorStop(0.45, "rgba(247,234,235,0.96)");
  g.addColorStop(0.8, "rgba(243,216,222,0.88)");
  g.addColorStop(0.95, "rgba(241,205,214,0.7)");
  g.addColorStop(1, "rgba(240,199,210,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  for (let r = 40; r < 250; r += 14) {
    ctx.strokeStyle = `rgba(214,170,182,${(0.1 - (r / 250) * 0.06).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return toCanvasTexture(canvas);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load cover: ${url}`));
    img.src = url;
  });
}
