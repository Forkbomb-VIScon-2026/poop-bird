// DOM helpers shared by the game page's UI modules.

/** The element with this id (it must exist: index.html and the code go together). */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

export function show(el: HTMLElement, visible: boolean): void {
  el.classList.toggle("hidden", !visible);
}

/**
 * A marker where `el` lives in the DOM, to put it back after docking it elsewhere.
 * Not its next sibling: that may be docked away too (#cam follows the coach).
 */
export function homeOf(el: HTMLElement): Comment {
  const marker = document.createComment(`${el.id} home`);
  el.after(marker);
  return marker;
}

/** A phone or tablet: no hover, coarse pointer. Swaps key hints for touch wording (CSS `.touch`). */
export const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A stopwatch (ms) that only runs while `running()` holds, checked each time it's read. */
export function stopwatch(running: () => boolean): () => number {
  let elapsed = 0;
  let last = performance.now();
  return () => {
    const now = performance.now();
    if (running()) elapsed += now - last;
    last = now;
    return elapsed;
  };
}

/** Restarts an element's CSS animation (a toast or the combo popping in again). */
export function replayAnimation(el: HTMLElement): void {
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}
