/**
 * Debug tooling (panel, tuning overrides, console hooks) is only included when
 * the app is started or built with `--mode debug` (`npm run dev:debug`,
 * `npm run build:debug`). Plain `dev` and `build` leave it out, and the
 * production build is always the plain one.
 */
export const DEBUG: boolean = import.meta.env.MODE === "debug";

/**
 * Running in the Android app (README "Android app"): Capacitor's WebView puts
 * `window.Capacitor` on the page before any script runs, both for the bundled
 * build and for the dev server under `npm run app:dev`. The app is on-device
 * only: no online leaderboard (the API is behind the ETH login anyway).
 */
export const APP: boolean =
  (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
