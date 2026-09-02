import * as THREE from "three";

const SIZE = 1024;
/** Outer disc radius in texture space (fraction of canvas). */
const DISC_R = 0.48;
/** Center label radius as a fraction of disc radius (larger = bigger cover). */
const LABEL_OF_DISC = 0.48;
/** Pixels near this luminance count as "border / letterbox". */
const BORDER_LUMA = 245;

function labelRadius(size: number) {
  return size * DISC_R * LABEL_OF_DISC;
}

function drawGrooves(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.fillStyle = "#121214";
  ctx.beginPath();
  ctx.arc(cx, cy, size * DISC_R, 0, Math.PI * 2);
  ctx.fill();

  const inner = size * DISC_R * LABEL_OF_DISC + size * 0.01;
  for (let r = inner; r < size * DISC_R - 1; r += 1.55) {
    const shade = 14 + (Math.sin(r * 0.35) + 1) * 6;
    ctx.strokeStyle = `rgb(${shade},${shade},${shade + 2})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFallbackLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const lr = labelRadius(size);
  ctx.fillStyle = "#e8e2d6";
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c45c3e";
  ctx.beginPath();
  ctx.arc(cx, cy, lr * 0.95, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f4efe6";
  ctx.beginPath();
  ctx.arc(cx, cy, lr * 0.62, 0, Math.PI * 2);
  ctx.fill();
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
    // Near-white / light beige letterbox
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

  // Fallback if trim failed (flat / all-light image)
  if (right - left < 8 || bottom - top < 8) {
    const side = Math.min(w, h);
    return { sx: (w - side) / 2, sy: (h - side) / 2, sw: side, sh: side };
  }

  const bw = right - left + 1;
  const bh = bottom - top + 1;
  const side = Math.min(bw, bh);
  const sx = left + (bw - side) / 2;
  const sy = top + (bh - side) / 2;
  // Inset a hair so residual edge pixels don't show in the circle
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
    img.data[i + 3] = 28;
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

function drawCoverLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  cover: HTMLImageElement
) {
  const lr = labelRadius(size);
  const crop = contentSquare(cover);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, Math.PI * 2);
  ctx.clip();

  // Soft print look: slight contrast via darker underlay
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

  // Radial vignette — label paper darkens toward the rim
  const vig = ctx.createRadialGradient(cx, cy, lr * 0.35, cx, cy, lr);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(0.7, "rgba(0,0,0,0.06)");
  vig.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vig;
  ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);

  // Glossy paper sheen (soft specular streak)
  const sheen = ctx.createLinearGradient(cx - lr, cy - lr, cx + lr, cy + lr * 0.2);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.05)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);
  ctx.globalCompositeOperation = "source-over";

  ctx.restore();

  // Paper grain over the label
  drawPaperGrain(ctx, cx, cy, lr);

  // Raised paper rim where label meets the vinyl
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = size * 0.0035;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, lr - size * 0.002, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = size * 0.002;
  ctx.stroke();

  // Tiny concentric wear rings just outside the label
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, lr + size * (0.004 + i * 0.003), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.04 - i * 0.01})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Procedural vinyl face with optional album cover in the center label. */
export function makeVinylTexture(coverImage?: HTMLImageElement | null): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  drawGrooves(ctx, cx, cy, SIZE);

  if (coverImage && coverImage.complete && coverImage.naturalWidth > 0) {
    drawCoverLabel(ctx, cx, cy, SIZE, coverImage);
  } else {
    drawFallbackLabel(ctx, cx, cy, SIZE);
  }

  // Spindle hole
  ctx.fillStyle = "#0a0a0c";
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.018, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(180,180,185,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, SIZE * 0.018, 0, Math.PI * 2);
  ctx.stroke();

  return toTexture(canvas);
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
