// What the drawing functions share: the View they draw into, and the house style.

import type { RtxPlayer } from "../rtx";
import type { TargetSplatter } from "./target-splats";

/**
 * What a drawing function draws into: the Renderer. `ctx` is swapped for the
 * photo captures (see drawOn), `width` is the logical width (the height is
 * always VIEW_H), and `bgOffset` the background's scroll.
 */
export interface View {
  ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly bgOffset: number;
  /** The run's photos, by Game photo id (main.ts fills it). */
  readonly photos: Map<number, Photo>;
  /** How far the player's mouth is open, 0..1: the (classic) bird's beak opens as far. */
  mouthOpen: number;
  readonly rtxPlayer: RtxPlayer;
  /** Sticks the poop on targets to their actual shape. */
  readonly splatter: TargetSplatter;
}

/** A captured photo: a face crop from the webcam, or a crop of the game canvas around the bird. */
export type Photo = HTMLCanvasElement;

export const OUTLINE = "#2b2d42";

export const POOP = "#7a4a1e";

export const POOP_DARK = "#5c3310";

/** A new canvas `w` × `h` px and its 2D context (null where there's none). */
export function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

/** Runs `draw` with the view drawing into `ctx` (a photo being composed), then back into its own canvas. */
export function drawOn(view: View, ctx: CanvasRenderingContext2D, draw: () => void): void {
  const main = view.ctx;
  view.ctx = ctx;
  try {
    draw();
  } finally {
    view.ctx = main;
  }
}
