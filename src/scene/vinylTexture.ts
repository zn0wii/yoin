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
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
};

/** Opaque RGB pigment (t = 0 at label edge, 1 at rim). Disc translucency is
 *  applied via material.opacity so alpha blending stays reliable with
 *  MeshPhysicalMaterial + clearcoat. Tuned against assets/vinyl.png. */
const VINYL_STOPS: { t: number; r: number; g: number; b: number }[] = [
  { t: 0.0, r: 198, g: 148, b: 156 },
  { t: 0.06, r: 216, g: 150, b: 158 },
  { t: 0.22, r: 236, g: 176, b: 184 },
  { t: 0.48, r: 246, g: 202, b: 206 },
  { t: 0.75, r: 250, g: 224, b: 226 },
  { t: 0.92, r: 252, g: 238, b: 236 },
  { t: 0.98, r: 253, g: 244, b: 242 },
  { t: 1.0, r: 240, g: 210, b: 214 },
];

function lerpStops(t: number): { r: number; g: number; b: number } {
  const x = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < VINYL_STOPS.length - 2 && VINYL_STOPS[i + 1].t < x) i++;
  const a = VINYL_STOPS[i];
  const b = VINYL_STOPS[i + 1];
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
 * PBR pack for the grooved PVC: milky pink albedo (with alpha), concentric
 * groove normals, roughness, and a circular anisotropy direction field.
 * Generated once — independent of the center label.
 */
export function makeVinylGrooveMaps(): VinylGrooveMaps {
  const size = GROOVE_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const discPx = size * DISC_R;
  const labelPx = discPx * LABEL_OF_DISC;
  const deadWax = labelPx + size * 0.012;
  const period = 2.2;
  const amp = 0.2;

  const albedo = new Uint8Array(size * size * 4);
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
    const group = Math.sin(r * 0.42) * 0.16;
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
      // normals + anisotropy, not painted dark rings.
      const wave = grooveWave(r, period);
      const inGroove = r >= labelPx && r <= discPx ? 1 : 0;
      const lift = wave * 6 * inGroove;
      // Soft silvering on groove peaks — reads under soft studio light.
      const silver = Math.max(0, wave) * 14 * inGroove;
      const rC = Math.min(255, Math.max(0, col.r + lift + silver));
      const gC = Math.min(255, Math.max(0, col.g + lift * 0.75 + silver));
      const bC = Math.min(255, Math.max(0, col.b + lift * 0.8 + silver * 0.95));
      const aa = r > discPx ? Math.max(0, 1 - (r - discPx)) : 1;

      albedo[i] = rC;
      albedo[i + 1] = gC;
      albedo[i + 2] = bC;
      albedo[i + 3] = 255 * aa;

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
    normalMap: toDataTexture(normal, size, false),
    roughnessMap: toDataTexture(rough, size, false),
  };
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

/** Paper label that fills CircleGeometry's 0–1 UV (square canvas, circular art). */
export function makeVinylLabelTexture(
  coverImage?: HTMLImageElement | null
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LABEL_SIZE;
  canvas.height = LABEL_SIZE;
  const ctx = canvas.getContext("2d")!;

  if (coverImage && coverImage.complete && coverImage.naturalWidth > 0) {
    drawCoverLabel(ctx, LABEL_SIZE, coverImage);
  } else {
    drawFallbackLabel(ctx, LABEL_SIZE);
  }
  drawLabelRim(ctx, LABEL_SIZE);
  drawSpindleHole(ctx, LABEL_SIZE);

  return toCanvasTexture(canvas);
}

/** Soft radial pink glow for the backlit platter center. */
export function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "rgba(255,196,206,0.95)");
  g.addColorStop(0.16, "rgba(255,120,146,0.8)");
  g.addColorStop(0.45, "rgba(235,82,118,0.34)");
  g.addColorStop(0.85, "rgba(255,96,136,0.18)");
  g.addColorStop(1, "rgba(255,96,136,0)");
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
