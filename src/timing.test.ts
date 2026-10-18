import { describe, expect, it } from "vitest";
import { RollingTiming, formatTiming, perfCsv } from "./timing";

describe("RollingTiming", () => {
  it("averages, maxes and sums the last second", () => {
    const t = new RollingTiming();
    t.add(0, 2);
    t.add(500, 6);
    t.add(900, 4);
    const s = t.stats(900);
    expect(s.count).toBe(3);
    expect(s.avg).toBeCloseTo(4);
    expect(s.max).toBe(6);
    expect(s.perSecond).toBeCloseTo(12);
  });

  it("drops samples older than a second", () => {
    const t = new RollingTiming();
    t.add(0, 50);
    t.add(800, 3);
    const s = t.stats(1200);
    expect(s.count).toBe(1);
    expect(s.max).toBe(3);
  });

  it("is empty without samples", () => {
    const t = new RollingTiming();
    expect(t.stats(0)).toEqual({ avg: 0, max: 0, perSecond: 0, count: 0 });
    expect(formatTiming(t.stats(0))).toBe("–");
  });
});

describe("perfCsv", () => {
  it("writes a header and a line per row, without commas inside values", () => {
    expect(perfCsv([{ t: 1, stage: "city" }, { t: 2, stage: "city, ocean" }])).toBe("t,stage\n1,city\n2,city  ocean\n");
  });

  it("is empty without rows", () => {
    expect(perfCsv([])).toBe("");
  });
});
