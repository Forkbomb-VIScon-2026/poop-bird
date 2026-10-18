// The game-over screen: the run's stats, the run in pictures, and the
// leaderboard form (opt-in; only face-mode runs can be submitted).

import { APP } from "../env";
import type { Game } from "../game";
import { BOARD_KEEP, type RunStats } from "../leaderboard";
import { showBoards, submitRun } from "../leaderboard-view";
import { pick } from "../random";
import { drawFrontPage, drawTrophyPrint, drawWeddingPrint, newCanvas, type Photo } from "../render";
import { storageGet, storageSet } from "../storage";
import { $, show } from "./dom";

/** A run as it would go to the leaderboard. */
export interface Run {
  score: number;
  stats: RunStats;
  face: { url: string; strain: number } | null;
}

/** The run on the game-over screen's leaderboard form. null once submitted (or for a keyboard run). */
let lastRun: Run | null = null;

const NAME_KEY = "poopybird.name.v1";

/** The title and the stats of the run that just ended. */
export function showRunStats(game: Game, best: number, newBest: boolean): void {
  $("go-title").textContent = game.trophy !== null
    ? pick(["Hooked!", "Reeled in!", "Gone fishing.", "Fish and chips!"])
    : pick(["Splat!", "Plop.", "Flushed!", "Wiped out!", "Down the drain!"]);
  show($("go-newbest"), newBest);
  const stats: Record<string, string | number> = {
    "go-score": game.score,
    "go-best": best,
    "go-targets": game.targetsHit,
    "go-combo": game.bestCombo > 1 ? `x${game.bestCombo}` : game.bestCombo,
    "go-distance": `${Math.round(game.distance / 50)} m`,
    "go-accidents": game.accidents,
    "go-smashed": game.camerasSmashed,
    "go-scandals": game.frontPages.length,
    "go-kids": game.kidsDisarmed + game.pebblesShot,
    "go-weddings": game.weddingsRuined,
    "go-balloons": game.balloonsPopped,
    "go-lines": game.anglersSnapped,
    "go-sharks": game.sharksSpiked,
  };
  for (const [id, value] of Object.entries(stats)) $(id).textContent = String(value);
}

/** The game-over prints' canvases have this many pixels per logical unit, so they stay sharp. */
const PRINT_SCALE = 2;

/**
 * The run in pictures on the game-over screen, all on one level: the finest
 * strain (static in index.html, first), then every front page, wedding photo
 * and the trophy photo in the order they were taken (photo ids count up).
 */
export function showRunPhotos(game: Game, photos: ReadonlyMap<number, Photo>, hasSnapshot: boolean): void {
  const strip = $("go-photos");
  for (const el of strip.querySelectorAll(".go-print:not(#go-snapshot)")) el.remove();
  type Print = { photoId: number; title: string; kind: string; w: number; h: number; draw: (ctx: CanvasRenderingContext2D) => void };
  const prints: Print[] = [
    ...game.frontPages.map((t): Print => ({
      photoId: t.photoId, title: "Tomorrow's front page", kind: "frontpage", w: 200, h: 240,
      draw: (ctx) => drawFrontPage(ctx, 2, 2, 196, 236, t, photos),
    })),
    ...game.weddingPhotos.map((w): Print => ({
      photoId: w.photoId, title: "The official wedding photo", kind: "wedding", w: 250, h: 235,
      draw: (ctx) => drawWeddingPrint(ctx, 2, 2, 240, w, photos.get(w.photoId)),
    })),
  ];
  const trophy = game.trophy;
  if (trophy !== null) {
    prints.push({
      photoId: trophy, title: "Catch of the day", kind: "trophy", w: 250, h: 235,
      draw: (ctx) => drawTrophyPrint(ctx, 2, 2, 240, photos.get(trophy)),
    });
  }
  prints.sort((a, b) => a.photoId - b.photoId);
  for (const p of prints) {
    const figure = document.createElement("figure");
    figure.className = `go-print ${p.kind}`;
    figure.title = p.title;
    const print = newCanvas(p.w * PRINT_SCALE, p.h * PRINT_SCALE);
    if (!print) continue;
    print.canvas.setAttribute("role", "img");
    print.canvas.setAttribute("aria-label", p.title);
    print.ctx.scale(PRINT_SCALE, PRINT_SCALE);
    p.draw(print.ctx);
    figure.append(print.canvas);
    strip.append(figure);
  }
  show(strip, prints.length > 0 || hasSnapshot);
  strip.scrollLeft = 0;
}

/** Sets up the leaderboard form for `run` (null: a keyboard or touch run, which can't be submitted). */
export function offerRun(run: Run | null): void {
  // The app has no online leaderboard: its form and boards are .web-only.
  if (APP) return;
  lastRun = run;
  show($("go-lb-form"), run !== null && (run.score > 0 || run.face !== null));
  show($("go-lb-face-opt"), run?.face != null);
  // Sharing the face is a fresh choice every run (the next player at this machine may not want to).
  $<HTMLInputElement>("go-lb-face").checked = false;
  $<HTMLButtonElement>("btn-lb-submit").disabled = false;
  $<HTMLInputElement>("go-name").value = storageGet(NAME_KEY) ?? "";
  const status = $("go-lb-status");
  status.classList.remove("error");
  status.textContent = "Only runs played with your face count for the leaderboard. 😣";
  show(status, run === null);
  void showBoards($("go-lb"));
}

/** Sends the game-over screen's run to the online leaderboard (only when the player presses Submit). */
export async function submitToLeaderboard(): Promise<void> {
  const run = lastRun;
  if (!run) return;
  const name = ($<HTMLInputElement>("go-name").value.trim() || "Anonymous Pooper").slice(0, 16);
  storageSet(NAME_KEY, name);
  const withFace = run.face !== null && $<HTMLInputElement>("go-lb-face").checked;
  const button = $<HTMLButtonElement>("btn-lb-submit");
  const status = $("go-lb-status");
  button.disabled = true;
  status.textContent = "Submitting…";
  status.classList.remove("error");
  show(status, true);
  try {
    const result = await submitRun({
      name,
      score: run.score,
      mode: "face",
      stats: run.stats,
      ...(withFace && run.face
        ? { face: { jpeg: run.face.url.slice(run.face.url.indexOf(",") + 1), strain: run.face.strain } }
        : {}),
    });
    if (lastRun !== run) return;
    lastRun = null;
    show($("go-lb-form"), false);
    const places = [
      result.rank.score !== null ? `#${result.rank.score} on scores` : "",
      result.rank.face !== null ? `#${result.rank.face} on faces` : "",
    ].filter(Boolean);
    status.textContent = places.length
      ? `You're ${places.join(" and ")}! 🎉`
      : `Not in the top ${BOARD_KEEP} this time. Strain harder! 💩`;
    void showBoards($("go-lb"), { highlight: result.id });
  } catch (err) {
    if (lastRun !== run) return;
    button.disabled = false;
    status.textContent = `Couldn't submit: ${err instanceof Error ? err.message : "no connection"}.`;
    status.classList.add("error");
  }
}
