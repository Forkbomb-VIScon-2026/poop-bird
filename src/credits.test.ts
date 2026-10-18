import { describe, expect, it } from "vitest";
import { linked, musicCredits, photoCredits, tableRows } from "./credits";
import imageCreditsMd from "./assets/CREDITS.md?raw";
import audioCreditsMd from "../public/assets/audio/CREDITS.md?raw";

describe("credits", () => {
  it("reads table body rows, skipping headers and text between tables", () => {
    const md = "Intro | not a table\n\n| A | B |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |\n\ntext\n\n| C |\n| - |\n| 5 |\n";
    expect(tableRows(md)).toEqual([["1", "2"], ["3", "4"], ["5"]]);
  });

  it("reads links whose URLs hold parentheses", () => {
    expect(linked("[A (b).jpg](https://x/File:A_(b).jpg)")).toEqual({ text: "A (b).jpg", url: "https://x/File:A_(b).jpg" });
    expect(linked("Public domain")).toEqual({ text: "Public domain", url: null });
  });

  it("lists outside sources only, without file extensions or placeholder authors", () => {
    const md = [
      "| File | Source | Author | Licence |",
      "| --- | --- | --- | --- |",
      "| `a.png`, `b.png` | [Photo of a.JPG](https://c/a) | Someone | [CC BY 4.0](https://cc/by) |",
      "| `c.png` | [Photo c.jpg](https://c/c) | see source page | Public domain |",
      "| `own.png` | Supplied by the project owner | — | Check before publishing |",
    ].join("\n");
    expect(photoCredits(md)).toEqual([
      { files: ["a.png", "b.png"], source: { text: "Photo of a", url: "https://c/a" }, author: "Someone", licence: { text: "CC BY 4.0", url: "https://cc/by" } },
      { files: ["c.png"], source: { text: "Photo c", url: "https://c/c" }, author: null, licence: { text: "Public domain", url: null } },
    ]);
  });

  it("credits every photo the game ships with a source and a licence", () => {
    const photos = photoCredits(imageCreditsMd);
    expect(photos.length).toBeGreaterThan(40);
    expect(photos.map((p) => p.files).flat()).toContain("bird-glide.png");
    for (const p of photos) {
      expect(p.source.url).toMatch(/^https:\/\//);
      expect(p.licence.text).not.toBe("");
    }
  });

  it("credits the music", () => {
    const music = musicCredits(audioCreditsMd);
    expect(music.length).toBeGreaterThanOrEqual(2);
    for (const m of music) expect(m.title).not.toBe("");
  });
});
