import { toAssetUrl } from "./assetUrl";

/** Read duration via metadata only (does not play). Resolves 0 when the
 *  metadata isn't available within `timeoutMs` (e.g. huge files on slow
 *  disks) — callers treat 0 as "unknown". */
export function probeDuration(
  filePath: string,
  timeoutMs = 8000
): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const timer = setTimeout(() => {
      cleanup();
      resolve(0);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onReady);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
    const onReady = () => {
      const d = audio.duration;
      cleanup();
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    const onError = () => {
      cleanup();
      reject(new Error(`probeDuration failed: ${filePath}`));
    };
    audio.addEventListener("loadedmetadata", onReady);
    audio.addEventListener("error", onError);
    audio.src = toAssetUrl(filePath);
  });
}
