# Audio assets

The browser loads audio from `/assets/audio/` (this directory is under Vite's `public/`).

The registry in `src/audio-assets.ts` lists all logical sound names. `src/audio.ts` looks for `<name>.mp3`, then `<name>.wav`; if neither exists, it logs a warning and loads `tmp_<name>.mp3`.

Every `tmp_*.mp3` is currently the same provided bell recording (shortened to 1.5 seconds with a fade). Replace a placeholder by adding the matching `<name>.mp3`; no TypeScript changes are required.

For example, add `release.mp3` to override `tmp_release.mp3`.

The old `sounds/` directory is intentionally untouched.

Release sounds are selected by `main.ts` using the configurable `poopSoundMiddle` (default 0.35) and `poopSoundLarge` (default 0.75) charge thresholds: `poop_weak`, `poop_middle`, and `poop_large`. The WAV recordings are used directly.

`shark_theme.mp3` is the shark's approach music: a 26 s excerpt of John Williams' main title from *Jaws* (1975), from the second "do-doop" (4.4 s into the track) on, normalized and faded out. It starts `sharkThemeOffset` s into the file, `sharkThemeAttack` s before the shark lunges, follows the game's clock (it re-syncs after a pause) and fades out once the shark is gone, or at once when the fish spikes it. Without it, `shark_note_low` / `shark_note_high` play a synthesized ostinato instead.

`shark_bite.mp3` is a recorded chomp (trimmed tight, since the room noise under it is voices). The yelp when it bites the spines (`shark_yelp`) and the lunge whoosh (`shark_lunge`) are still synthesized placeholders (`tmp_shark_*.mp3`); add the real `<name>.mp3` to replace them.

The `power_line.mp3` recording plays as a continuous loop only when a power line is on-screen during active city gameplay. Its volume scales with the bird’s distance to the nearest wire; `powerLineAudioRange` controls the fade-in distance. The existing `zap.mp3` plays on wire collision.

`button_click.wav` is the click every button makes when pressed (with the mouse, a tap or its key): a toggle-switch click, two tiny bursts of filtered noise. It's synthesized offline by `scripts/make-button-click.mjs`, so edit and re-run that to change it. It plays at a slightly random pitch each time.
