import { afterEach, describe, expect, it, vi } from "vitest";

/** A Map-backed stand-in for the browser's localStorage. */
function fakeStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("carries the keys from before the rename over", async () => {
    const s = fakeStorage({
      "poopbird.best.v1": "42",
      "poopBird.graphics": "rtx",
      "poopbird.name.v1": "old",
      "poopybird.name.v1": "new",
      "other.key": "x",
    });
    vi.stubGlobal("localStorage", s);
    const storage = await import("./storage");
    expect(storage.loadBest()).toBe(42);
    expect(storage.loadGraphics()).toBe("rtx");
    expect(s.getItem("poopybird.name.v1")).toBe("new");
    expect(s.getItem("other.key")).toBe("x");
    expect(s.getItem("poopbird.best.v1")).toBeNull();
    expect(s.getItem("poopbird.name.v1")).toBeNull();
  });
});
