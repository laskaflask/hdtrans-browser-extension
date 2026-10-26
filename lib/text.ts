// Turning page text into engine lines and the engine's lines back into page text.

// Hiragana, katakana (full and half width) and CJK ideographs.
const JAPANESE = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/** Joins the text nodes of one sentence. The engine keeps it as a word boundary without
 *  changing the particles around it, and writes it back as U+2225. */
const MARK = '‖';
const MARKS = /[‖∥]/;

export interface Piece {
  lead: string;
  core: string;
  trail: string;
  /** Only pieces with Japanese go to the engine; the rest are kept as they are. */
  translate: boolean;
}

function piece(text: string): Piece {
  const [, lead = '', core = '', trail = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return { lead, core, trail, translate: hasJapanese(core) };
}

/** One piece per line, with the surrounding whitespace set aside (the engine trims it). */
export function splitPieces(text: string): Piece[] {
  return text.split('\n').map(piece);
}

export function joinPieces(pieces: readonly Piece[]): string {
  return pieces.map((p) => p.lead + p.core + p.trail).join('\n');
}

/** A line break in normal-flow HTML renders as a space at most; between Japanese characters
 *  it joins the words of one sentence. */
function collapseBreaks(text: string): string {
  return text.replace(/\s*\n\s*/g, (run, offset: number) => {
    const before = text[offset - 1] ?? '';
    const after = text[offset + run.length] ?? '';
    return hasJapanese(before) && hasJapanese(after) ? '' : ' ';
  });
}

/** Engine lines for a set of text values, and how to read the values back from the output. */
export interface Plan {
  lines: string[];
  /** New values, or undefined when the output cannot be mapped back (retry with planLines). */
  apply(out: readonly string[]): string[] | undefined;
}

/** Each value on its own, line by line. Used for preformatted text, attributes and retries. */
export function planLines(values: readonly string[]): Plan {
  const pieces = values.map(splitPieces);
  return {
    lines: pieces.flatMap((ps) => ps.filter((p) => p.translate).map((p) => p.core)),
    apply(out) {
      let i = 0;
      return pieces.map((ps) => joinPieces(ps.map((p) => (p.translate ? { ...p, core: out[i++] ?? p.core } : p))));
    },
  };
}

/** Two plans sent as one: the values of `first`, then those of `second`. */
export function planBoth(first: Plan, second: Plan): Plan {
  return {
    lines: [...first.lines, ...second.lines],
    apply(out) {
      const a = first.apply(out.slice(0, first.lines.length));
      const b = second.apply(out.slice(first.lines.length));
      return a && b && [...a, ...b];
    },
  };
}

/** The text nodes of one inline run (a sentence split by <b>, <a>, ...) translated together,
 *  so particles and word order follow the whole sentence. */
export function planInline(values: readonly string[]): Plan {
  if (values.some((v) => MARKS.test(v))) return planLines(values);
  const pieces = values.map((v) => {
    const p = piece(v);
    return { ...p, core: collapseBreaks(p.core) };
  });
  const groups = groupLetters(pieces);
  const cores = groups.map((g) => g.map((i) => pieces[i]!.core).join(''));
  // A group's text goes to its first node; the other nodes of the group are emptied.
  const fill = (translated: readonly string[]) => {
    const values = pieces.map((p) => p.lead + p.core + p.trail);
    groups.forEach((group, k) => {
      for (const index of group) values[index] = pieces[index]!.lead + pieces[index]!.trail;
      const first = pieces[group[0]!]!;
      values[group[0]!] = first.lead + translated[k]! + first.trail;
    });
    return values;
  };
  if (groups.length <= 1) {
    const translate = groups.length === 1 && hasJapanese(cores[0]!);
    return {
      lines: translate ? [cores[0]!] : [],
      apply: (out) => (translate ? fill([out[0] ?? cores[0]!]) : pieces.map((p) => p.lead + p.core + p.trail)),
    };
  }
  return {
    // The marked line maps the output to the nodes; the plain one supplies the spacing.
    lines: [cores.join(MARK), cores.join('')],
    apply(out) {
      const parts = (out[0] ?? '').split(MARKS);
      if (parts.length !== cores.length) return undefined;
      const translated = projectSpacing(parts, out[1] ?? '') ?? parts.map((p) => p.trim());
      return fill(
        groups.map((group, k) => {
          const last = group[group.length - 1]!;
          const next = groups[k + 1]?.[0];
          // The page already separates these two nodes; do not add a second space.
          const spaced =
            next !== undefined && (pieces[last]!.trail !== '' || pieces.slice(last + 1, next + 1).some((q) => q.lead !== ''));
          return spaced ? translated[k]!.trimEnd() : translated[k]!;
        }),
      );
    },
  };
}

/** The non-empty pieces in order, as groups of indices. Runs of two or more one-letter pieces
 *  with nothing between them (a word with one <span> per letter, as for emphasis dots) form one
 *  group, so the engine does not take each letter as a word of its own. */
function groupLetters(pieces: readonly Piece[]): number[][] {
  const letter = (p: Piece) => [...p.core].length === 1;
  const groups: number[][] = [];
  let prev: number | undefined;
  pieces.forEach((p, i) => {
    if (!p.core) return;
    const last = groups[groups.length - 1];
    const joined =
      last !== undefined &&
      prev === i - 1 &&
      letter(pieces[prev]!) &&
      letter(p) &&
      pieces[prev]!.trail === '' &&
      p.lead === '';
    if (joined) last.push(i);
    else groups.push([i]);
    prev = i;
  });
  return groups;
}

/** Splits `plain` at the same places as `parts` when both hold the same characters apart from
 *  whitespace. The space the marked output lost at a boundary is kept on the left part. */
export function projectSpacing(parts: readonly string[], plain: string): string[] | undefined {
  const strip = (s: string) => s.replace(/\s+/g, '');
  if (strip(parts.join('')) !== strip(plain)) return undefined;
  const out: string[] = [];
  let pos = 0;
  for (const [k, part] of parts.entries()) {
    let need = strip(part).length;
    const start = pos;
    if (k === parts.length - 1) {
      out.push(plain.slice(start));
      break;
    }
    while (need > 0 && pos < plain.length) {
      if (!/\s/.test(plain[pos]!)) need--;
      pos++;
    }
    while (pos < plain.length && /\s/.test(plain[pos]!)) pos++;
    out.push(plain.slice(start, pos));
  }
  // Leading whitespace of a part comes from the plain text's own leading whitespace only.
  return out.map((s, k) => (k === 0 ? s.trimStart() : s));
}
