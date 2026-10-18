// Reads the credits files (src/assets/CREDITS.md, public/assets/audio/CREDITS.md)
// for the credits screen (ui/credits.ts), so the screen lists exactly what the
// files do. Pure: no DOM.

/** A Markdown link, or plain text (url null). */
export interface Linked {
  text: string;
  url: string | null;
}

/** A picture taken from somewhere else: one row of the image credits table. */
export interface PhotoCredit {
  /** The game's files made from it. */
  files: string[];
  /** The source's title, without its file extension, linking to its page. */
  source: Linked & { url: string };
  /** null when the table doesn't name one ("see source page"). */
  author: string | null;
  licence: Linked;
}

/** A music track: one row of the audio credits' music table. */
export interface MusicCredit {
  title: string;
  madeWith: Linked;
}

/** The cells of the body rows of every table in `md` (not the header or the --- row). */
export function tableRows(md: string): string[][] {
  const rows: string[][] = [];
  let header = true;
  for (const line of md.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("|")) {
      header = true;
      continue;
    }
    const cells = l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (header) {
      header = cells.every((c) => /^:?-+:?$/.test(c)) ? false : header;
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

/** A cell that is `[text](url)`, or plain text. URLs may hold parentheses. */
export function linked(cell: string): Linked {
  const m = /^\[(.*)\]\((.*)\)$/.exec(cell);
  return m ? { text: m[1], url: m[2] } : { text: cell, url: null };
}

/** The image credits table's rows that credit an outside source (rows without a source link are the team's own). */
export function photoCredits(md: string): PhotoCredit[] {
  const out: PhotoCredit[] = [];
  for (const [files, source, author, licence] of tableRows(md)) {
    const s = linked(source ?? "");
    if (!s.url) continue;
    out.push({
      files: [...(files ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]),
      source: { text: s.text.replace(/\.(jpe?g|png|tiff?)$/i, ""), url: s.url },
      author: !author || /^see source page$/i.test(author) || author === "—" ? null : author,
      licence: linked(licence ?? ""),
    });
  }
  return out;
}

/** The audio credits' music table: | File | Title | Made with |. */
export function musicCredits(md: string): MusicCredit[] {
  return tableRows(md)
    .filter((cells) => cells.length >= 3)
    .map(([, title, madeWith]) => ({ title, madeWith: linked(madeWith) }));
}
