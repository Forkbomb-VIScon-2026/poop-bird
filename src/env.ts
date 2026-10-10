/**
 * Debug tooling (panel, tuning overrides, console hooks) is only included when
 * the app is started or built with `--mode debug` (`npm run dev:debug`,
 * `npm run build:debug`). Plain `dev` and `build` leave it out, and the
 * production build is always the plain one.
 */
export const DEBUG: boolean = import.meta.env.MODE === "debug";
