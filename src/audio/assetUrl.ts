import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Resolve a library file path to a URL the webview can fetch.
 * Disk paths from Tauri go through the asset protocol; Vite demo paths stay as-is.
 */
export function toAssetUrl(filePath: string): string {
  if (
    filePath.startsWith("http://") ||
    filePath.startsWith("https://") ||
    filePath.startsWith("blob:") ||
    filePath.startsWith("/@fs/")
  ) {
    return filePath;
  }
  return convertFileSrc(filePath);
}
