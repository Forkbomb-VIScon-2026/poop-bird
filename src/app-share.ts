// The Android app's stand-in for downloads (README "Android app"): its WebView
// can't save files, so a picture goes to the app's cache and from there to
// Android's share sheet (save it to the gallery or files, send it, post it).
// main.ts imports this only in the app, so the web build never loads it.

import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/** Offers the `data:` URL image `dataUrl` to the share sheet as `name`. */
export async function shareImage(dataUrl: string, name: string, title: string): Promise<void> {
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: dataUrl.slice(dataUrl.indexOf(",") + 1),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title, files: [uri] });
  } catch (err) {
    // Closing the share sheet without picking anything rejects too.
    if (!/cancel/i.test(String(err))) throw err;
  }
}
