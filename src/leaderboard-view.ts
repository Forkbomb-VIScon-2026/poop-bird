// The online leaderboard in the page: talks to /api/leaderboard (the
// collector, collector/leaderboard.ts) and draws both boards. Used by the
// game-over screen and the start screen's 🏆 button (main.ts).
//
// Debug builds submit with `debug: true` and show only debug runs, so testing
// never puts a run on the public boards.

import { DEBUG } from "./env";
import { BOARD_SHOW, strainPercent, type Boards, type LeaderboardEntry, type Submission, type SubmitResult } from "./leaderboard";
import { forgetLeaderboardKey, loadLeaderboardKeys, saveLeaderboardKey } from "./storage";

const API = "/api/leaderboard";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: probably no collector behind /api (say, `npm run dev` without the tunnel).
  }
  if (!res.ok) {
    const error = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof error === "string" ? error : `the server answered ${res.status}`);
  }
  return body as T;
}

export function fetchBoards(limit = BOARD_SHOW): Promise<Boards> {
  return request<Boards>(`${API}?limit=${limit}${DEBUG ? "&debug=1" : ""}`);
}

/** Submits a run and remembers its delete key, so this browser can remove it again. */
export async function submitRun(run: Omit<Submission, "debug">): Promise<SubmitResult> {
  const result = await request<SubmitResult>(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...run, ...(DEBUG ? { debug: true } : {}) } satisfies Submission),
  });
  if (result.id && result.deleteKey) saveLeaderboardKey(result.id, result.deleteKey);
  return result;
}

async function deleteRun(id: string, deleteKey: string): Promise<void> {
  try {
    await request(`${API}/${id}`, { method: "DELETE", headers: { "X-Delete-Key": deleteKey } });
  } catch (err) {
    // Already gone (pushed off the boards, or removed by the team): nothing left to delete.
    if (!(err instanceof Error && /No such run/.test(err.message))) throw err;
  }
  forgetLeaderboardKey(id);
}

/** Bumped per container on every load, so a slow answer can't replace a newer one. */
const loads = new WeakMap<HTMLElement, number>();

/**
 * Loads both boards into `container`. `highlight` marks a run (the one just
 * submitted). Runs submitted from this browser get a remove button.
 */
export async function showBoards(container: HTMLElement, opts: { limit?: number; highlight?: string | null } = {}): Promise<void> {
  const token = (loads.get(container) ?? 0) + 1;
  loads.set(container, token);
  container.classList.add("lb");
  if (!container.querySelector(".lb-board")) container.replaceChildren(note("Loading the leaderboard…"));
  let boards: Boards;
  try {
    boards = await fetchBoards(opts.limit);
  } catch (err) {
    if (loads.get(container) !== token) return;
    container.replaceChildren(note(`The leaderboard is offline right now (${err instanceof Error ? err.message : "no connection"}).`));
    return;
  }
  if (loads.get(container) !== token) return;
  const reload = () => void showBoards(container, opts);
  container.replaceChildren(
    board("🏆 Top scores", "scores", boards.scores, opts.highlight ?? null, reload),
    board("😣 Most strained faces", "faces", boards.faces, opts.highlight ?? null, reload),
  );
}

function board(
  title: string, kind: "scores" | "faces", entries: LeaderboardEntry[], highlight: string | null, reload: () => void,
): HTMLElement {
  const keys = loadLeaderboardKeys();
  const wrap = document.createElement("div");
  wrap.className = `lb-board lb-${kind}`;
  const h = document.createElement("h3");
  h.textContent = title;
  wrap.append(h);
  if (entries.length === 0) {
    wrap.append(note(kind === "faces" ? "No faces yet. Share yours!" : "No runs yet. Be the first!"));
    return wrap;
  }
  const ol = document.createElement("ol");
  entries.forEach((e, i) => {
    const li = document.createElement("li");
    if (e.id === highlight) li.className = "me";
    li.append(span("rank", `${i + 1}.`), thumb(e), span("name", e.name));
    const value = kind === "faces" ? span("value", `${strainPercent(e.strain ?? 0)}`) : span("value", String(e.score));
    value.title = kind === "faces" ? "Strainedness (0–100)" : `${e.stats.targets} targets · ${e.stats.distance} m`;
    li.append(value);
    const key = keys[e.id];
    if (key) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "lb-remove";
      remove.textContent = "✕";
      remove.title = "Remove my run from the leaderboard";
      remove.setAttribute("aria-label", "Remove my run from the leaderboard");
      remove.addEventListener("click", () => {
        if (!window.confirm(`Remove ${e.name}'s run${e.face ? " and face" : ""} from the leaderboard?`)) return;
        remove.disabled = true;
        deleteRun(e.id, key).then(reload, (err: unknown) => {
          remove.disabled = false;
          window.alert(`Couldn't remove it: ${err instanceof Error ? err.message : err}`);
        });
      });
      li.append(remove);
    }
    ol.append(li);
  });
  wrap.append(ol);
  return wrap;
}

function thumb(e: LeaderboardEntry): HTMLElement {
  if (e.face) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = e.face;
    img.alt = `${e.name}'s strain face`;
    img.loading = "lazy";
    return img;
  }
  const el = span("thumb", e.mode === "keyboard" ? "⌨️" : "💩");
  el.title = e.mode === "keyboard" ? "Played without the camera" : "Played with the face, kept it private";
  return el;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

function note(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "lb-note";
  p.textContent = text;
  return p;
}
