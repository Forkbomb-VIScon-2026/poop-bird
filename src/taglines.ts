// The start screen's tagline: a different one each time the menu shows.

/** Taglines; `code` ones are set in monospace. */
export const TAGLINES: readonly { text: string; code?: boolean }[] = [
  { text: "Bio-fuel jet propulsion. 💩" },
  { text: "What a shitshow!" },
  { text: "Turbo-charged by fibre." },
  { text: "Aim low, score high." },
  { text: "The only game that makes your bathroom stops shorter." },
  { text: "Turd-person shooter." },
  { text: "The shit hits the fan. And the car. And the bride." },
  { text: "Finally, a use for your toilet face." },
  { text: "A backside-scroller." },
  { text: "Pay-to-wipe." },
  { text: "shit push --force origin main", code: true },
];

/** A random tagline index other than `previous`. */
export function pickTagline(previous: number, random = Math.random): number {
  const n = TAGLINES.length;
  if (previous < 0 || previous >= n || n < 2) return Math.floor(random() * n);
  const i = Math.floor(random() * (n - 1));
  return i >= previous ? i + 1 : i;
}
