# Audio assets

The browser loads audio from `/assets/audio/` (this directory is under Vite's `public/`).

The registry in `src/audio-assets.ts` lists all logical sound names. `src/audio.ts` looks for `<name>.mp3`, then `<name>.wav`; if neither exists, it logs a warning and loads `tmp_<name>.mp3`.

Every `tmp_*.mp3` is currently the same provided bell recording (shortened to 1.5 seconds with a fade). Replace a placeholder by adding the matching `<name>.mp3`; no TypeScript changes are required.

For example, add `release.mp3` to override `tmp_release.mp3`.

The old `sounds/` directory is intentionally untouched.

Release sounds are selected by `main.ts` using the configurable `poopSoundMiddle` (default 0.35) and `poopSoundLarge` (default 0.75) charge thresholds: `poop_weak`, `poop_middle`, and `poop_large`. The WAV recordings are used directly.

The `power_line.mp3` recording plays as a continuous loop only when a power line is on-screen during active city gameplay. Its volume scales with the bird’s distance to the nearest wire; `powerLineAudioRange` controls the fade-in distance. The existing `zap.mp3` plays on wire collision.
