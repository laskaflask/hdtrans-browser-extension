// Turning page text into engine lines and the engine's lines back into page text.

// Hiragana, katakana (full and half width) and CJK ideographs.
const JAPANESE = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

export function hasJapanese(text: string): boolean {
  return JAPANESE.test(text);
}

/** Joins the text nodes of one sentence. The engine keeps U+2225 as a word boundary without
 *  changing the particles around it. U+2016 was read as it until hdTrans 0.7.0; it is now an
 *  ordinary symbol, but page text holding either is still kept away from the marked plan. */
const MARK = '∥';
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
  /** New values, or undefined when the output cannot be mapped back. */
  apply(out: readonly string[]): string[] | undefined;
  /** After apply gave undefined: the plan to send next, from the same output. Without one,
   *  the values are retried with planLines. */
  retry?(out: readonly string[]): Plan | undefined;
}

/** A plan with nothing to send that gives these values. */
function settled(values: string[]): Plan {
  return { lines: [], apply: () => values };
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
    retry(out) {
      const next = (plan: Plan, part: readonly string[]) => {
        const values = plan.apply(part);
        return values ? settled(values) : plan.retry?.(part);
      };
      const a = next(first, out.slice(0, first.lines.length));
      const b = next(second, out.slice(first.lines.length));
      return a && b && planBoth(a, b);
    },
  };
}

/** The text nodes of one inline run (a sentence split by <b>, <a>, ...) translated together,
 *  so particles and word order follow the whole sentence. `bases` marks the values that are a
 *  ruby base: one may be half a word (<ruby>弄<rt>もてあそ</rt></ruby>ぶ), unlike text in <b>. */
export function planInline(values: readonly string[], bases: readonly boolean[] = []): Plan {
  if (values.some((v) => MARKS.test(v))) return planLines(values);
  const pieces = values.map((v) => {
    const p = piece(v);
    return { ...p, core: collapseBreaks(p.core) };
  });
  return inlinePlan(pieces, groupLetters(pieces), bases);
}

/** When the marked output disagrees with the plain one, the boundaries at ruby bases are looked
 *  into: one may split a word whose halves the engine then translated as words of their own. */
function inlinePlan(pieces: readonly Piece[], groups: number[][], bases: readonly boolean[]): Plan {
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
  // The page already separates the nodes at boundary k (between groups k and k + 1).
  const spaced = (k: number) => {
    const last = groups[k]![groups[k]!.length - 1]!;
    const next = groups[k + 1]![0]!;
    return pieces[last]!.trail !== '' || pieces.slice(last + 1, next + 1).some((q) => q.lead !== '');
  };
  const fillParts = (translated: readonly string[]) =>
    fill(translated.map((t, k) => (k < groups.length - 1 && spaced(k) ? t.trimEnd() : t)));
  // Boundaries at a ruby base inside running Japanese text, where a word may have been split.
  const suspects = groups.slice(1).flatMap((_, k) => {
    const left = cores[k]!.at(-1) ?? '';
    const right = cores[k + 1]![0] ?? '';
    const base = bases[groups[k]!.at(-1)!] || bases[groups[k + 1]![0]!];
    return base && !spaced(k) && hasJapanese(left) && hasJapanese(right) ? [k] : [];
  });
  return {
    // The marked line maps the output to the nodes; the plain one supplies the spacing.
    lines: [cores.join(MARK), cores.join('')],
    apply(out) {
      const parts = (out[0] ?? '').split(MARKS);
      if (parts.length !== cores.length) return undefined;
      const translated = projectSpacing(parts, out[1] ?? '');
      if (translated) return fillParts(translated);
      if (suspects.length) return undefined;
      return fillParts(parts.map((p) => p.trim()));
    },
    retry(out) {
      const parts = (out[0] ?? '').split(MARKS);
      if (parts.length !== cores.length || !suspects.length) return undefined;
      const plain = strip(out[1] ?? '');
      const fallback = fillParts(parts.map((p) => p.trim()));
      // Each suspect boundary marked on its own: one that changes the translation splits a word.
      const marked = cores.join(MARK);
      const probes = suspects.map((k) => cores.slice(0, k + 1).join('') + MARK + cores.slice(k + 1).join(''));
      const sent = probes.filter((line) => line !== marked);
      const split = (back: readonly string[]) => {
        let i = 0;
        return new Set(suspects.filter((_, n) => strip((probes[n] === marked ? out[0] : back[i++]) ?? '') !== plain));
      };
      const joined = (back: readonly string[]) => {
        const at = split(back);
        const groupsJoined: number[][] = [];
        groups.forEach((group, k) => (at.has(k - 1) ? groupsJoined.at(-1)!.push(...group) : groupsJoined.push([...group])));
        return inlinePlan(pieces, groupsJoined, []);
      };
      // Nothing to send when the only probe is the marked line itself.
      if (!sent.length) return joined([]);
      return {
        lines: sent,
        apply: (back) => (split(back).size ? undefined : fallback),
        retry: joined,
      };
    },
  };
}

/** Text without whitespace and boundary marks, for comparing translations. */
function strip(text: string): string {
  return text.replace(/[\s‖∥]+/g, '');
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
