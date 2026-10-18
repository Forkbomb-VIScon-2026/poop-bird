// The credits screen's lists (Settings → Credits), filled from the credits files
// the first time it opens. main.ts imports this only then, so the files stay out
// of the game's start-up bundle.

import { musicCredits, photoCredits, type Linked } from "../credits";
import imageCreditsMd from "../assets/CREDITS.md?raw";
import audioCreditsMd from "../../public/assets/audio/CREDITS.md?raw";
import { $ } from "./dom";

let filled = false;

/** Fills #credits-photos and #credits-music (once). */
export function fillCredits(): void {
  if (filled) return;
  filled = true;
  const photos = $("credits-photos");
  for (const p of photoCredits(imageCreditsMd)) {
    const li = document.createElement("li");
    li.append(link(p.source));
    if (p.author) li.append(` by ${p.author}`);
    li.append(" · ", link(p.licence));
    photos.append(li);
  }
  const music = musicCredits(audioCreditsMd);
  const p = $("credits-music");
  music.forEach((m, i) => {
    if (i > 0) p.append(i === music.length - 1 ? " and " : ", ");
    const b = document.createElement("b");
    b.textContent = m.title;
    p.append(b);
  });
  // Each tool once ("made with Suno", not "Suno and Suno").
  const tools = new Map(music.map((m) => [m.madeWith.text, m.madeWith]));
  [...tools.values()].forEach((t, i) => p.append(i > 0 ? " and " : ", made with ", link(t)));
  p.append(".");
}

/** A link opening in a new tab (in the app, the browser), or plain text. */
function link(l: Linked): Node {
  if (!l.url) return document.createTextNode(l.text);
  const a = document.createElement("a");
  a.href = l.url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = l.text;
  return a;
}
