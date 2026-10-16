// The toast: a short message over the game that hides itself.

import { $, replayAnimation, show } from "./dom";

let toastTimer = 0;

export function showToast(text: string, ms = 2600): void {
  const el = $("hud-toast");
  el.textContent = text;
  show(el, true);
  replayAnimation(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => show(el, false), ms);
}

export function hideToast(): void {
  clearTimeout(toastTimer);
  show($("hud-toast"), false);
}
