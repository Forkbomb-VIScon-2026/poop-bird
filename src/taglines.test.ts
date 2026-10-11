import { describe, expect, it } from "vitest";
import { TAGLINES, pickTagline } from "./taglines";

describe("pickTagline", () => {
  it("never repeats the previous tagline and reaches every other one", () => {
    for (let previous = 0; previous < TAGLINES.length; previous++) {
      const seen = new Set<number>();
      for (let k = 0; k < TAGLINES.length - 1; k++) {
        seen.add(pickTagline(previous, () => (k + 0.5) / (TAGLINES.length - 1)));
      }
      expect(seen.has(previous)).toBe(false);
      expect(seen.size).toBe(TAGLINES.length - 1);
    }
  });

  it("picks any tagline the first time", () => {
    expect(pickTagline(-1, () => 0)).toBe(0);
    expect(pickTagline(-1, () => 0.999)).toBe(TAGLINES.length - 1);
  });
});
