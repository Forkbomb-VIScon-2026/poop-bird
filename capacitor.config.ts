import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app (README "Android app"): the web build in dist/, shown by a
 * Capacitor WebView. `npm run app:dev` points it at the dev server instead.
 */
const config: CapacitorConfig = {
  appId: "ch.forkbomb.poopybird",
  appName: "Poopy Bird",
  webDir: "dist",
  // Behind the page until it paints: the sky (--sky in style.css), not a white flash.
  backgroundColor: "#5ec8f2",
};

export default config;
