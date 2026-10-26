// Injected on demand. Replaces Japanese text in the page with the translation and keeps the
// originals so the page can be put back.
import type { ContentRequest, ContentStatus, PageState, TranslateBatchResponse } from '@/lib/messages';
import { getSettings, settingsItem, type Settings } from '@/lib/storage';
import { takeBatch } from '@/lib/schedule';
import { hasJapanese, planBoth, planInline, planLines, type Plan } from '@/lib/text';

/** Not translated, nor looked into. */
const SKIP_TAGS = new Set([
  'HDTRANS-TRANSLATION', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'KBD', 'SAMP', 'VAR',
  'SVG', 'MATH', 'CANVAS', 'IFRAME', 'TEMPLATE', 'RP',
]);
/** Elements that stay within a line of text; a sentence may run across them. Skipped ones
 *  among them (code, svg, ...) are a boundary inside the sentence, not a break. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'IMG', 'INS', 'DEL', 'MARK', 'Q',
  'RUBY', 'RB', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'WBR', 'LABEL', 'CODE', 'KBD', 'SAMP',
  'VAR', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'RT', 'RP', 'SVG',
]);
const ATTRIBUTES = ['title', 'alt', 'placeholder', 'aria-label'];
/** Holds the translation shown after the original text when both are shown. */
const TRANSLATION_TAG = 'hdtrans-translation';
/** Text up to this long that is not a sentence (a menu item, a button, a heading) gets its
 *  translation on the same line. */
const SHORT_TEXT = 12;
const SENTENCE_END = /[。．.！!？?」』）)]$/;
const BATCH_LIMITS = { lines: 150, chars: 5000 };
/** How far beyond the top and bottom of the screen text counts as on screen, in screen heights. */
const SCREEN_MARGIN = 0.25;
/** Marks the elements of text waiting to be translated; they pulse until it is written. */
const PENDING_ATTR = 'data-hdtrans-pending';
const PENDING_STYLE = `
@keyframes hdtrans-pending { 50% { opacity: 0.35; } }
[${PENDING_ATTR}] { animation: hdtrans-pending 1.2s ease-in-out infinite; }
[${PENDING_ATTR}] [${PENDING_ATTR}] { animation: none; }
@media (prefers-reduced-motion: reduce) {
  [${PENDING_ATTR}] { animation: none; opacity: 0.55; }
  [${PENDING_ATTR}] [${PENDING_ATTR}] { opacity: 1; }
}`;

interface Unit {
  /** Current value in the page. */
  read(): string | null;
  write(value: string): void;
  original: string;
  /** Element whose position orders the work (the text's parent, or the attribute's owner). */
  element: Element | null;
  /** What this script last wrote; a different current value means the page changed it. */
  written?: string;
  /** The text node, for text units. */
  node?: Text;
  /** The <rt> holding the text, for a ruby reading. Readings come after the run's other
   *  units and are translated on their own lines, not as part of the sentence. */
  reading?: Element;
  /** The translation shown after the original text, when both are shown. */
  translation?: Element;
}

/** Units translated together: the text nodes of one inline run, or one attribute. */
interface Job {
  units: Unit[];
  /** Line by line, for preformatted text and attributes. */
  lines: boolean;
  /** An attribute's value, not text shown in the page. */
  attribute?: boolean;
}

interface Planned {
  job: Job;
  plan: Plan;
  chars: number;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const w = window as typeof window & { __hdtransLoaded?: boolean };
    if (w.__hdtransLoaded) return;
    w.__hdtransLoaded = true;
    const page = new PageTranslator();
    settingsItem.watch((settings) => page.settingsChanged(settings));
    browser.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
      switch (msg?.type) {
        case 'translate-page':
          void page.translate();
          break;
        case 'restore-page':
          page.restore();
          break;
        case 'toggle-page':
          if (page.state === 'original') void page.translate();
          else page.restore();
          break;
        case 'get-state':
          break;
        default:
          return;
      }
      sendResponse(page.status());
    });
  },
});

class PageTranslator {
  state: PageState = 'original';
  private texts = new Map<Text, Unit>();
  private attrs = new Map<Element, Map<string, Unit>>();
  private generation = 0;
  private done = 0;
  private total = 0;
  private error = '';
  private userDictWarning = '';
  private settings!: Settings;
  private observer?: MutationObserver;
  private dirty = new Set<Node>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  /** Jobs waiting for the engine, in document order; later page changes come at the end. */
  private pending: Planned[] = [];
  private pump?: Promise<void>;
  /** Where the pending jobs are, so whatever is on screen is translated next. */
  private viewport?: IntersectionObserver;
  private onScreen = new Set<Element>();
  /** Pending jobs per watched element. */
  private watched = new Map<Element, number>();
  /** Pending jobs per element marked with PENDING_ATTR. */
  private marked = new Map<Element, number>();
  private pendingStyle?: HTMLStyleElement;
  private preCache = new WeakMap<Element, boolean>();
  private itemsCache = new WeakMap<Element, boolean>();
  private outOfFlowCache = new WeakMap<Element, boolean>();

  status(): ContentStatus {
    return {
      state: this.state,
      done: this.done,
      total: this.total,
      ...(this.error && { error: this.error }),
      ...(this.userDictWarning && { userDictWarning: this.userDictWarning }),
    };
  }

  async translate(): Promise<void> {
    if (this.state !== 'original') return;
    this.error = '';
    this.userDictWarning = '';
    this.done = this.total = 0;
    this.setState('translating');
    const generation = this.generation;
    this.settings = await getSettings();
    if (generation !== this.generation) return;
    await this.enqueue(this.collect(document.documentElement), generation);
    if (generation !== this.generation) return;
    this.setState('translated');
    if (this.settings.observeMutations) this.observe();
  }

  /** Switching between translation only and both redraws a translated page. */
  settingsChanged(next: Settings | null): void {
    if (this.state === 'original' || !this.settings || !next) return;
    if (!!next.bilingual === !!this.settings.bilingual) return;
    this.restore();
    void this.translate();
  }

  restore(): void {
    this.generation++;
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.flushTimer);
    this.dirty.clear();
    this.dropPending();
    this.pump = undefined;
    const units = [...this.texts.values(), ...[...this.attrs.values()].flatMap((m) => [...m.values()])];
    for (const unit of units) {
      if (unit.written !== undefined && unit.read() === unit.written) unit.write(unit.original);
      unit.translation?.remove();
    }
    this.texts.clear();
    this.attrs.clear();
    this.done = this.total = 0;
    this.setState('original');
  }

  private setState(state: PageState): void {
    this.state = state;
    if (window === window.top) browser.runtime.sendMessage({ type: 'page-state', state }).catch(() => {});
  }

  /** Jobs under root for text that still needs translating (new, or changed by the page since). */
  private collect(root: Node): Job[] {
    if (insideSkipped(root.parentElement)) return [];
    const jobs: Job[] = [];
    let run: Text[] = [];
    let readings: Text[] = [];
    const close = () => {
      if (run.length || readings.length) jobs.push(...this.runJobs(run, readings));
      run = [];
      readings = [];
    };
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        run.push(node as Text);
        return;
      }
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        close();
        for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
        close();
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toUpperCase();
      const inline = INLINE_TAGS.has(tag) && !this.laysOutItems(el.parentElement);
      if (tag === 'BR' || !inline) close();
      // Attributes are read even on skipped elements, so an <input>'s placeholder is translated.
      if (this.settings.translateAttributes && !optedOut(el)) {
        for (const unit of this.attrUnits(el)) jobs.push({ units: [unit], lines: true, attribute: true });
      }
      if (skipElement(el)) return;
      if (tag === 'RT') return void readings.push(...textsOf(el));
      if (el.shadowRoot) visit(el.shadowRoot);
      for (let child = el.firstChild; child; child = child.nextSibling) visit(child);
      if (!inline) close();
    };
    visit(root);
    close();
    return jobs;
  }

  /** Jobs for one inline run of text nodes; only runs with Japanese still to translate count. */
  private runJobs(nodes: Text[], readings: Text[]): Job[] {
    const all = [...nodes, ...readings];
    let fresh = all.filter((n) => {
      const known = this.texts.get(n);
      return !known || n.nodeValue !== known.written;
    });
    // Shown with its translation, the whole run is still original, so it is translated again whole.
    if (this.settings.bilingual && fresh.length) fresh = all;
    if (!fresh.some((n) => hasJapanese(n.nodeValue ?? ''))) return [];
    const units = fresh.map((n) => this.textUnit(n, readings.includes(n) ? n.parentElement?.closest('rt') : undefined));
    return [{ units, lines: this.isPre(blockOf(fresh[0]!)) }];
  }

  /** Children of a flex or grid container are laid out as separate blocks (a menu of links),
   *  so a sentence does not run across them. */
  private laysOutItems(el: Element | null): boolean {
    if (!el) return false;
    let items = this.itemsCache.get(el);
    if (items === undefined) {
      const display = getComputedStyle(el).display;
      items = /flex|grid/.test(display);
      this.itemsCache.set(el, items);
    }
    return items;
  }

  /** An absolutely or fixed positioned element is a box of its own, often one clipped to hide
   *  text for screen readers, so a translation placed outside it shows up elsewhere. */
  private outOfFlow(el: Element): boolean {
    let out = this.outOfFlowCache.get(el);
    if (out === undefined) {
      const position = getComputedStyle(el).position;
      out = position === 'absolute' || position === 'fixed';
      this.outOfFlowCache.set(el, out);
    }
    return out;
  }

  private isPre(el: Element | null): boolean {
    if (!el) return false;
    let pre = this.preCache.get(el);
    if (pre === undefined) {
      const ws = getComputedStyle(el).whiteSpace;
      pre = ws.startsWith('pre') || ws === 'break-spaces';
      this.preCache.set(el, pre);
    }
    return pre;
  }

  private textUnit(node: Text, reading?: Element | null): Unit {
    const value = node.nodeValue ?? '';
    const unit: Unit = this.texts.get(node) ?? {
      original: value,
      element: node.parentElement,
      node,
      read: () => node.nodeValue,
      write: (v) => {
        node.nodeValue = v;
      },
    };
    unit.original = value;
    unit.written = undefined;
    unit.reading = reading ?? undefined;
    this.texts.set(node, unit);
    return unit;
  }

  private attrUnits(el: Element): Unit[] {
    const out: Unit[] = [];
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (!value || !hasJapanese(value)) continue;
      let byName = this.attrs.get(el);
      const known = byName?.get(name);
      if (known && value === known.written) continue;
      const unit: Unit = known ?? {
        original: value,
        element: el,
        read: () => el.getAttribute(name),
        write: (v) => el.setAttribute(name, v),
      };
      unit.original = value;
      unit.written = undefined;
      if (!byName) this.attrs.set(el, (byName = new Map()));
      byName.set(name, unit);
      out.push(unit);
    }
    return out;
  }

  /** Adds jobs to the pending work; the promise settles once none is left. */
  private enqueue(jobs: Job[], generation: number): Promise<void> {
    this.total += jobs.length;
    for (const job of jobs) {
      const shown = job.units.filter((u) => !u.reading);
      const values = shown.map((u) => u.original);
      const readings = job.units.filter((u) => u.reading).map((u) => u.original);
      const bases = shown.map((u) => !!u.node && !!readingOf(u.node));
      const text = job.lines ? planLines(values) : planInline(values, bases);
      const plan = readings.length ? planBoth(text, planLines(readings)) : text;
      this.pending.push({ job, plan, chars: plan.lines.reduce((n, line) => n + line.length, 0) });
      this.watch(job);
      this.mark(job);
    }
    if (!this.pump) {
      const pump = this.run(generation).finally(() => {
        if (this.pump === pump) this.pump = undefined;
      });
      this.pump = pump;
    }
    return this.pump;
  }

  /** Batches run one after another, each picked when the previous one is done; a restore
   *  in between drops the rest. */
  private async run(generation: number): Promise<void> {
    while (this.pending.length && generation === this.generation) {
      const { batch, rest } = takeBatch(
        this.pending,
        (p) => ({ lines: p.plan.lines.length, chars: p.chars }),
        (p) => this.isOnScreen(p.job),
        BATCH_LIMITS,
      );
      this.pending = rest;
      for (const item of batch) this.unwatch(item.job);
      const out = await this.request(batch.flatMap((p) => p.plan.lines));
      if (generation !== this.generation) return;
      if (!out) return this.dropPending();
      // A run whose output cannot be mapped back to its nodes goes again as its plan says, and
      // node by node in the end.
      let sent = batch;
      let lines = out;
      while (sent.length) {
        const retry: Planned[] = [];
        let i = 0;
        for (const item of sent) {
          const part = lines.slice(i, (i += item.plan.lines.length));
          const values = item.plan.apply(part);
          if (values) this.write(item.job, values);
          else {
            const plan = item.plan.retry?.(part) ?? planLines(item.job.units.map((u) => u.original));
            retry.push({ job: item.job, plan, chars: item.chars });
          }
        }
        if (!retry.length) break;
        const again = await this.request(retry.flatMap((p) => p.plan.lines));
        if (generation !== this.generation) return;
        if (!again) return this.dropPending();
        sent = retry;
        lines = again;
      }
      for (const item of batch) this.unmark(item.job);
      this.done += batch.length;
    }
  }

  private dropPending(): void {
    this.pending = [];
    for (const el of this.marked.keys()) el.removeAttribute(PENDING_ATTR);
    this.marked.clear();
    this.pendingStyle?.remove();
    this.pendingStyle = undefined;
    this.viewport?.disconnect();
    this.viewport = undefined;
    this.onScreen.clear();
    this.watched.clear();
  }

  /** The elements holding a job's text; attributes are not shown, so they are not marked. */
  private markTargets(job: Job): Set<Element> {
    if (job.attribute || !this.settings.showProgress) return new Set();
    return new Set(job.units.flatMap((u) => (u.element ? [u.element] : [])));
  }

  private mark(job: Job): void {
    for (const el of this.markTargets(job)) {
      const count = this.marked.get(el) ?? 0;
      this.marked.set(el, count + 1);
      if (count) continue;
      el.setAttribute(PENDING_ATTR, '');
      if (!this.pendingStyle?.isConnected) {
        this.pendingStyle = document.createElement('style');
        this.pendingStyle.textContent = PENDING_STYLE;
        (document.head ?? document.documentElement).append(this.pendingStyle);
      }
    }
  }

  private unmark(job: Job): void {
    for (const el of this.markTargets(job)) {
      const count = this.marked.get(el);
      if (!count) continue;
      if (count > 1) {
        this.marked.set(el, count - 1);
        continue;
      }
      this.marked.delete(el);
      el.removeAttribute(PENDING_ATTR);
    }
    if (!this.marked.size) {
      this.pendingStyle?.remove();
      this.pendingStyle = undefined;
    }
  }

  private isOnScreen(job: Job): boolean {
    const el = job.units[0]?.element;
    return !!el && this.onScreen.has(el);
  }

  private watch(job: Job): void {
    const el = job.units[0]?.element;
    if (!el) return;
    const count = this.watched.get(el) ?? 0;
    this.watched.set(el, count + 1);
    if (count) return;
    // The observer first reports on the next frame; until then the box is measured here.
    if (inView(el)) this.onScreen.add(el);
    this.viewport ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && this.watched.has(entry.target)) this.onScreen.add(entry.target);
          else this.onScreen.delete(entry.target);
        }
      },
      { rootMargin: `${SCREEN_MARGIN * 100}% 0px` },
    );
    this.viewport.observe(el);
  }

  private unwatch(job: Job): void {
    const el = job.units[0]?.element;
    const count = el && this.watched.get(el);
    if (!el || !count) return;
    if (count > 1) return void this.watched.set(el, count - 1);
    this.watched.delete(el);
    this.onScreen.delete(el);
    this.viewport?.unobserve(el);
  }

  private async request(lines: string[]): Promise<string[] | undefined> {
    if (!lines.length) return [];
    let response: TranslateBatchResponse;
    try {
      response = await browser.runtime.sendMessage({ type: 'translate-batch', lines });
    } catch (error) {
      response = { error: String(error) };
    }
    if (response?.userDictWarning) this.userDictWarning = response.userDictWarning;
    if (response?.lines) return response.lines;
    this.error = response?.error ?? '번역 실패';
    console.warn('[hdTrans]', this.error);
    return undefined;
  }

  private write(job: Job, translated: string[]): void {
    // Leave the run alone if the page changed any of it while the batch was out.
    if (job.units.some((u) => u.read() !== u.original)) return;
    const values = withoutJoinedReadings(job.units, translated);
    if (this.settings.bilingual && !job.attribute) return this.writeAfter(job, values);
    job.units.forEach((unit, k) => {
      const value = values[k] ?? unit.original;
      unit.written = value;
      if (value !== unit.original) unit.write(value);
    });
  }

  /** Leaves the original as it is and shows the translation after it. */
  private writeAfter(job: Job, values: string[]): void {
    const shown = job.units.flatMap((unit, k) => (unit.reading ? [] : [{ unit, value: values[k] ?? unit.original }]));
    const readings = new Map<Element, string>();
    job.units.forEach((unit, k) => {
      if (unit.reading) readings.set(unit.reading, (readings.get(unit.reading) ?? '') + (values[k] ?? unit.original));
    });
    const original = shown.map((s) => s.unit.original).join('');
    const joined = shown.map((s) => s.value).join('');
    const text = job.lines ? joined.replace(/^\s*\n|\n\s*$/g, '') : joined.replace(/\s+/g, ' ').trim();
    for (const unit of job.units) {
      unit.written = unit.original;
      unit.translation?.remove();
      unit.translation = undefined;
    }
    // After the last text with content, not trailing whitespace that may sit outside its element.
    const last = (shown.findLast((s) => s.unit.original.trim()) ?? shown.at(-1))?.unit.node;
    if (!text.trim() || text === original.trim() || !last?.parentNode) return;
    const el = document.createElement(TRANSLATION_TAG);
    el.lang = 'ko';
    const label = original.trim();
    const short = !job.lines && label.length <= SHORT_TEXT && !SENTENCE_END.test(label);
    el.append(short ? ' ' : document.createElement('br'), ...withReadings(shown, readings, job.lines));
    const anchor = this.runEnd(last);
    anchor.parentNode!.insertBefore(el, anchor.nextSibling);
    for (const unit of job.units) unit.translation = el;
  }

  /** Where a run's translation goes: after its last text node, or after the inline elements
   *  that node ends (so a sentence ending in a link gets its translation after the link).
   *  It stays inside an element laid out as a flex or grid item, which would otherwise put
   *  the translation beside it as an item of its own, and inside a positioned element (text
   *  hidden for screen readers keeps its translation hidden too). */
  private runEnd(node: Text): Node {
    let end: Node = node;
    for (let parent = end.parentElement; parent && INLINE_TAGS.has(parent.tagName.toUpperCase()); parent = parent.parentElement) {
      if (!isLastContent(end) || this.laysOutItems(parent.parentElement) || this.outOfFlow(parent)) break;
      end = parent;
    }
    return end;
  }

  private observe(): void {
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach((n) => this.dirty.add(n));
        // A changed text node is collected with its siblings so the sentence stays whole.
        else if (record.type === 'characterData') this.dirty.add(record.target.parentNode ?? record.target);
        else this.dirty.add(record.target);
      }
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 300);
    });
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: this.settings.translateAttributes,
      attributeFilter: this.settings.translateAttributes ? ATTRIBUTES : undefined,
    });
  }

  private flush(): void {
    const roots = [...this.dirty].filter((n) => n.isConnected);
    this.dirty.clear();
    // Drop roots inside other roots so no text is collected twice.
    const top = roots.filter((n) => !roots.some((o) => o !== n && o.contains(n)));
    const jobs = top.flatMap((root) => this.collect(root));
    if (jobs.length) void this.enqueue(jobs, this.generation);
  }
}

function optedOut(el: Element): boolean {
  return el.getAttribute('translate') === 'no' || el.classList.contains('notranslate');
}

function skipElement(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName.toUpperCase()) || optedOut(el)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

function insideSkipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) if (skipElement(e)) return true;
  return false;
}


/** Whether nothing but whitespace, comments and ruby readings follows the node. */
function isLastContent(node: Node): boolean {
  for (let next = node.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType === Node.TEXT_NODE && !next.nodeValue?.trim()) continue;
    if (next.nodeType === Node.COMMENT_NODE) continue;
    if (next.nodeType === Node.ELEMENT_NODE && /^(RT|RP)$/i.test((next as Element).tagName)) continue;
    return false;
  }
  return true;
}

/** The text under el, as the run visits it. */
function textsOf(el: Element): Text[] {
  const out: Text[] = [];
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.TEXT_NODE) out.push(child as Text);
    else if (child.nodeType === Node.ELEMENT_NODE && !skipElement(child as Element)) out.push(...textsOf(child as Element));
  }
  return out;
}

/** The <rt> giving the reading of a ruby base: the next one after the base in its <ruby>. */
function readingOf(node: Node): Element | undefined {
  let base = node;
  for (let parent = base.parentElement; parent; base = parent, parent = parent.parentElement) {
    const tag = parent.tagName.toUpperCase();
    if (tag === 'RUBY') break;
    if (!INLINE_TAGS.has(tag)) return undefined;
  }
  if (base.parentElement?.tagName.toUpperCase() !== 'RUBY') return undefined;
  for (let next = base.nextSibling; next; next = next.nextSibling) {
    if (next.nodeType !== Node.ELEMENT_NODE) {
      if (next.nodeValue?.trim()) return undefined;
      continue;
    }
    const tag = (next as Element).tagName.toUpperCase();
    if (tag === 'RT') return next as Element;
    if (tag !== 'RP') return undefined;
  }
  return undefined;
}

/** The values with the readings left out whose ruby base was translated together with the
 *  text next to it (弄 with ぶ, as one word): a node emptied because its text went to the node
 *  before it, when the two do not share a reading. */
function withoutJoinedReadings(units: readonly Unit[], values: readonly string[]): string[] {
  const joined = new Set<Element | undefined>();
  let prev: Element | undefined | null = null;
  units.forEach((unit, k) => {
    if (unit.reading || !unit.original.trim()) return;
    const rt = unit.node && readingOf(unit.node);
    if (prev !== null && rt !== prev && !(values[k] ?? unit.original).trim()) joined.add(rt).add(prev);
    prev = rt;
  });
  return values.map((v, k) => (units[k]!.reading && joined.has(units[k]!.reading) ? '' : v));
}

/** A run's translated text for the translation element, with each ruby base given its
 *  translated reading again. */
function withReadings(
  shown: readonly { unit: Unit; value: string }[],
  readings: ReadonlyMap<Element, string>,
  lines: boolean,
): Node[] {
  const groups: { text: string; reading?: string; rt?: Element }[] = [];
  for (const { unit, value } of shown) {
    const rt = unit.node && readingOf(unit.node);
    const reading = rt && readings.get(rt);
    const prev = groups.at(-1);
    // Text nodes of one base (<rb>漢<b>字</b></rb>) share its reading.
    if (prev && prev.rt === rt) prev.text += value;
    else groups.push({ text: value, ...(reading && { reading, rt }) });
  }
  const tidy = (s: string) => (lines ? s : s.replace(/\s+/g, ' '));
  const first = groups[0];
  const last = groups.at(-1);
  if (first) first.text = lines ? first.text.replace(/^\s*\n/, '') : first.text.trimStart();
  if (last) last.text = lines ? last.text.replace(/\n\s*$/, '') : last.text.trimEnd();
  return groups.map((g) => {
    if (!g.reading) return document.createTextNode(tidy(g.text));
    const ruby = document.createElement('ruby');
    const rt = document.createElement('rt');
    rt.textContent = g.reading.trim();
    ruby.append(tidy(g.text), rt);
    return ruby;
  });
}

/** The nearest ancestor that is not inline: it decides whether whitespace is preformatted. */
function blockOf(node: Node): Element | null {
  let el = node.parentElement;
  while (el && INLINE_TAGS.has(el.tagName.toUpperCase())) el = el.parentElement;
  return el;
}

/** Whether the element's box is on screen, give or take SCREEN_MARGIN. */
function inView(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const margin = window.innerHeight * SCREEN_MARGIN;
  return rect.width > 0 && rect.bottom > -margin && rect.top < window.innerHeight + margin;
}
