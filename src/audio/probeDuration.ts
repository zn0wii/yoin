import { toAssetUrl } from "./assetUrl";

/** Read duration via metadata only (does not play). */
export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const cleanup = () => {
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
