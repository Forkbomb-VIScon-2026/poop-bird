/**
 * Keyboard shortcuts for buttons, shown without cluttering the labels.
 *
 * - `data-default` marks a screen's main button: while it's the visible yellow
 *   (`.primary`) button, Enter and Space press it. `data-default="enter"` takes
 *   Enter only (the ocean tutorial, where Space is the "try it" key).
 * - `data-keys="R"`: more keys that press the button while it's visible.
 * - `data-shortcut="C"`: display only, for keys handled elsewhere.
 *
 * Each button gets a keycap badge on its corner (main button only, fades in)
 * and a tooltip with all its keys on hover or keyboard focus. Touch devices
 * hide both (CSS `.touch`).
 */

const LABELS: Record<string, string> = { Enter: "⏎ Enter", Space: "Space", Escape: "Esc" };
const BADGES: Record<string, string> = { Enter: "⏎", Escape: "Esc" };

/** A keydown as the name used in the data attributes: "Enter", "Space", "Escape", "R"… */
export function keyName(e: KeyboardEvent): string {
  if (e.code === "Space") return "Space";
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

function defaultKeys(btn: HTMLElement): string[] {
  const d = btn.dataset.default;
  if (d === undefined) return [];
  return d === "enter" ? ["Enter"] : ["Enter", "Space"];
}

function split(s: string | undefined): string[] {
  return s ? s.split(/\s+/).filter(Boolean) : [];
}

/** Adds the badge and tooltip to a button. Call again after replacing its text. */
export function decorate(btn: HTMLElement): void {
  btn.querySelectorAll(":scope > .key-badge, :scope > .key-tip").forEach((el) => el.remove());
  const defaults = defaultKeys(btn);
  const extra = [...split(btn.dataset.keys), ...split(btn.dataset.shortcut)];
  if (!defaults.length && !extra.length) return;
  btn.classList.add("has-keys");
  btn.setAttribute("aria-keyshortcuts", [...defaults, ...extra].join(" "));

  if (defaults.length) {
    const badge = document.createElement("span");
    badge.className = "key-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = BADGES[defaults[0]] ?? defaults[0];
    btn.append(badge);
  }
  const tip = document.createElement("span");
  tip.className = "key-tip";
  tip.setAttribute("aria-hidden", "true");
  for (const k of defaults) tip.append(kbd(k, "k-default"));
  for (const k of extra) tip.append(kbd(k));
  btn.append(tip);
}

function kbd(key: string, cls = ""): HTMLElement {
  const el = document.createElement("kbd");
  if (cls) el.className = cls;
  el.textContent = LABELS[key] ?? key;
  return el;
}

export function decorateAll(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-default], [data-keys], [data-shortcut]").forEach(decorate);
}

function usable(btn: HTMLButtonElement): boolean {
  return !btn.disabled && btn.getClientRects().length > 0;
}

/** The visible button that `key` presses right now, if any. */
export function buttonForKey(key: string): HTMLButtonElement | null {
  for (const btn of document.querySelectorAll<HTMLButtonElement>("button[data-default], button[data-keys]")) {
    if (!usable(btn)) continue;
    const isDefault = btn.classList.contains("primary") && defaultKeys(btn).includes(key);
    if (isDefault || split(btn.dataset.keys).includes(key)) return btn;
  }
  return null;
}

/** Presses a button from the keyboard, with the same pushed-in look as a click. */
export function pressFromKey(btn: HTMLButtonElement): void {
  btn.classList.add("key-pressed");
  window.setTimeout(() => btn.classList.remove("key-pressed"), 120);
  btn.click();
}
