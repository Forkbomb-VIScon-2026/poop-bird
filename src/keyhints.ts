/**
 * Keyboard shortcuts for buttons: one key per button, the one on its keycap badge.
 *
 * - `data-default` marks a screen's main button: while it's the visible yellow
 *   (`.primary`) button, Enter presses it and its badge says ⏎. Its other keys
 *   (data-keys, data-shortcut) are off meanwhile.
 * - `data-keys="R"`: the key that presses the button while it's visible.
 * - `data-shortcut="C"`: display only, for keys handled elsewhere (main.ts's
 *   global shortcuts). `keyBlocked` turns those off while a visible button
 *   that carries the key shows another one instead.
 *
 * Touch devices hide the badges (CSS `.touch`).
 */

const BADGES: Record<string, string> = { Enter: "⏎", Escape: "Esc" };

/** A keydown as the name used in the data attributes: "Enter", "Space", "Escape", "R"… */
export function keyName(e: KeyboardEvent): string {
  if (e.code === "Space") return "Space";
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function split(s: string | undefined): string[] {
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

/** The key the button carries: its own (data-keys) or a global one (data-shortcut). */
function ownKey(btn: HTMLElement): string | undefined {
  return [...split(btn.dataset.keys), ...split(btn.dataset.shortcut)][0];
}

/** The one key that presses the button right now, if any. */
function activeKey(btn: HTMLElement): string | undefined {
  if (btn.dataset.default !== undefined && btn.classList.contains("primary")) return "Enter";
  return ownKey(btn);
}

/** Adds the keycap badges to a button. Call again after replacing its text. */
export function decorate(btn: HTMLElement): void {
  btn.querySelectorAll(":scope > .key-badge").forEach((el) => el.remove());
  const own = ownKey(btn);
  const isDefault = btn.dataset.default !== undefined;
  if (!isDefault && !own) return;
  btn.classList.add("has-keys");
  // CSS picks the badge: ⏎ while the button is the yellow one, else its own key.
  if (isDefault) btn.append(badge("Enter", "k-default"));
  if (own) btn.append(badge(own, "k-own"));
}

function badge(key: string, cls: string): HTMLElement {
  const el = document.createElement("span");
  el.className = `key-badge ${cls}`;
  el.setAttribute("aria-hidden", "true");
  el.textContent = BADGES[key] ?? key;
  return el;
}

export function decorateAll(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-default], [data-keys], [data-shortcut]").forEach(decorate);
}

function usable(btn: HTMLButtonElement): boolean {
  return !btn.disabled && btn.getClientRects().length > 0;
}

function keyedButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button[data-default], button[data-keys], button[data-shortcut]")]
    .filter(usable);
}

/** The visible button that `key` presses right now, if any. */
export function buttonForKey(key: string): HTMLButtonElement | null {
  return keyedButtons().find((btn) => {
    const active = activeKey(btn);
    return active === key && (active === "Enter" || split(btn.dataset.keys).includes(key));
  }) ?? null;
}

/** True if a visible button carries `key` but shows another one, so the key must do nothing. */
export function keyBlocked(key: string): boolean {
  return keyedButtons().some((btn) => ownKey(btn) === key && activeKey(btn) !== key);
}

/** Presses a button from the keyboard, with the same pushed-in look as a click. */
export function pressFromKey(btn: HTMLButtonElement): void {
  btn.classList.add("key-pressed");
  window.setTimeout(() => btn.classList.remove("key-pressed"), 120);
  btn.click();
}
