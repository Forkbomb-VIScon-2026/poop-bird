// The coach (#coach): the tutorial banner. The perch, the city lesson and the
// swim lesson each claim it while they run; only the latest claim can change
// or hide it, so an older flow that's still winding down can't clobber it.

import { $, homeOf, show } from "./dom";

export type CoachFace = "relaxed" | "strained" | "puffed";

export interface CoachLine {
  title: string;
  hint?: string;
  /** The face to make (null: no pictogram). */
  face?: CoachFace | null;
  /** The puff calibration's step progress bar. */
  bar?: boolean;
  /** The ocean tips: no bar, bigger hint. */
  tips?: boolean;
  /** Just done: the title turns green. */
  done?: boolean;
  /** Where the player is in the flight lesson: [current step, steps]. */
  dots?: readonly [number, number] | null;
}

/** The coach belongs to whoever claimed it last (claimCoach). */
let coachOwner = 0;
/** Where the coach lives when it isn't docked on the perch. */
const coachHome = homeOf($("coach"));

/** Takes the coach over (hiding whatever an older owner showed) and returns the claim for coachSay. */
export function claimCoach(): number {
  coachHide();
  return ++coachOwner;
}

/** Hides the coach if `owner` still has it. */
export function releaseCoach(owner: number): void {
  if (owner === coachOwner) coachHide();
}

function coachHide(): void {
  show($("coach"), false);
}

/** Shows `line` on the coach, if `owner` still has it. Cheap to call every frame. */
export function coachSay(owner: number, line: CoachLine): void {
  if (owner !== coachOwner) return;
  const el = $("coach");
  const title = $("coach-title");
  if (title.textContent !== line.title) {
    title.textContent = line.title;
    // A new line wobbles in.
    title.classList.remove("wobble");
    void title.offsetWidth;
    title.classList.add("wobble");
  }
  const hint = $("coach-hint");
  if (hint.textContent !== (line.hint ?? "")) hint.textContent = line.hint ?? "";
  const face = line.face ?? null;
  const pictogram = $("coach-face");
  if (face) $("coach-face-use").setAttribute("href", `#face-${face}`);
  pictogram.classList.toggle("puffing", face === "puffed");
  show(pictogram, face !== null);
  show($("coach-bar"), !!line.bar);
  el.classList.toggle("tips", !!line.tips);
  el.classList.toggle("done", !!line.done);
  const dots = $("coach-dots");
  const key = line.dots ? line.dots.join("/") : "";
  if (dots.dataset.key !== key) {
    dots.dataset.key = key;
    const [now, total] = line.dots ?? [0, 0];
    dots.replaceChildren(
      ...Array.from({ length: total }, (_, i) => {
        const li = document.createElement("li");
        li.className = i < now ? "done" : i === now ? "now" : "";
        return li;
      }),
    );
  }
  show(dots, !!line.dots);
  show(el, true);
}

/**
 * Moves the coach beside the bird on the perch, or back over the game. Leaving
 * the perch hides the perch's line (`perchOwner`'s claim).
 */
export function dockCoach(perched: boolean, perchOwner: number): void {
  const el = $("coach");
  if (perched === el.classList.contains("docked")) return;
  el.classList.toggle("docked", perched);
  if (perched) $("perch-coach-slot").append(el);
  else {
    coachHome.before(el);
    releaseCoach(perchOwner);
  }
}
