// Injected on demand. Replaces Japanese text in the page with the translation and keeps the
// originals so the page can be put back.
import type { ContentRequest, ContentStatus, PageState, TranslateBatchResponse } from '@/lib/messages';
import { getSettings, type Settings } from '@/lib/storage';
import { hasJapanese, planInline, planLines, type Plan } from '@/lib/text';

/** Not translated, nor looked into. */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'KBD', 'SAMP', 'VAR',
  'SVG', 'MATH', 'CANVAS', 'IFRAME', 'TEMPLATE', 'RT', 'RP',
]);
/** Elements that stay within a line of text; a sentence may run across them. Skipped ones
 *  among them (code, svg, ...) are a boundary inside the sentence, not a break. */
const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'IMG', 'INS', 'DEL', 'MARK', 'Q',
  'RUBY', 'RB', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'WBR', 'LABEL', 'CODE', 'KBD', 'SAMP',
  'VAR', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'RT', 'RP', 'SVG',
]);
const ATTRIBUTES = ['title', 'alt', 'placeholder', 'aria-label'];
const BATCH_LINES = 150;
const BATCH_CHARS = 5000;

interface Unit {
  /** Current value in the page. */
  read(): string | null;
  write(value: string): void;
  original: string;
  /** Element whose position orders the work (the text's parent, or the attribute's owner). */
  element: Element | null;
  /** What this script last wrote; a different current value means the page changed it. */
  written?: string;
}

/** Units translated together: the text nodes of one inline run, or one attribute. */
interface Job {
  units: Unit[];
  /** Line by line, for preformatted text and attributes. */
  lines: boolean;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const w = window as typeof window & { __hdtransLoaded?: boolean };
    if (w.__hdtransLoaded) return;
    w.__hdtransLoaded = true;
    const page = new PageTranslator();
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
  private queue: Promise<void> = Promise.resolve();
  private preCache = new WeakMap<Element, boolean>();

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
    const jobs = sortByViewport(this.collect(document.documentElement));
    await this.enqueue(jobs, generation);
    if (generation !== this.generation) return;
    this.setState('translated');
    if (this.settings.observeMutations) this.observe();
  }

  restore(): void {
    this.generation++;
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.flushTimer);
    this.dirty.clear();
    const units = [...this.texts.values(), ...[...this.attrs.values()].flatMap((m) => [...m.values()])];
    for (const unit of units) {
      if (unit.written !== undefined && unit.read() === unit.written) unit.write(unit.original);
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
    const close = () => {
      if (run.length) jobs.push(...this.runJobs(run));
      run = [];
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
      const inline = INLINE_TAGS.has(tag);
      if (tag === 'BR' || !inline) close();
      // Attributes are read even on skipped elements, so an <input>'s placeholder is translated.
      if (this.settings.translateAttributes && !optedOut(el)) {
        for (const unit of this.attrUnits(el)) jobs.push({ units: [unit], lines: true });
      }
      if (skipElement(el)) return;
      if (el.shadowRoot) visit(el.shadowRoot);
      for (let child = el.firstChild; child; child = child.nextSibling) visit(child);
      if (!inline) close();
    };
    visit(root);
    close();
    return jobs;
  }

  /** Jobs for one inline run of text nodes; only runs with Japanese still to translate count. */
  private runJobs(nodes: Text[]): Job[] {
    const fresh = nodes.filter((n) => {
      const known = this.texts.get(n);
      return !known || n.nodeValue !== known.written;
    });
    if (!fresh.some((n) => hasJapanese(n.nodeValue ?? ''))) return [];
    const units = fresh.map((n) => this.textUnit(n));
    return [{ units, lines: this.isPre(blockOf(fresh[0]!)) }];
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

  private textUnit(node: Text): Unit {
    const value = node.nodeValue ?? '';
    const unit: Unit = this.texts.get(node) ?? {
      original: value,
      element: node.parentElement,
      read: () => node.nodeValue,
      write: (v) => {
        node.nodeValue = v;
      },
    };
    unit.original = value;
    unit.written = undefined;
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

  /** Batches run one after another; a restore in between drops the rest. */
  private enqueue(jobs: Job[], generation: number): Promise<void> {
    this.total += jobs.length;
    const run = this.queue.then(() => this.run(jobs, generation));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(jobs: Job[], generation: number): Promise<void> {
    const planned = jobs.map((job) => {
      const values = job.units.map((u) => u.original);
      return { job, plan: job.lines ? planLines(values) : planInline(values) };
    });
    for (const batch of batches(planned)) {
      if (generation !== this.generation) return;
      const out = await this.request(batch.flatMap((p) => p.plan.lines));
      if (generation !== this.generation || !out) return;
      // A run whose output cannot be mapped back to its nodes is retried node by node.
      const retry: typeof planned = [];
      let i = 0;
      for (const item of batch) {
        const values = item.plan.apply(out.slice(i, (i += item.plan.lines.length)));
        if (values) this.write(item.job, values);
        else retry.push({ job: item.job, plan: planLines(item.job.units.map((u) => u.original)) });
      }
      if (retry.length) {
        const again = await this.request(retry.flatMap((p) => p.plan.lines));
        if (generation !== this.generation || !again) return;
        let j = 0;
        for (const item of retry) this.write(item.job, item.plan.apply(again.slice(j, (j += item.plan.lines.length)))!);
      }
      this.done += batch.length;
    }
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

  private write(job: Job, values: string[]): void {
    // Leave the run alone if the page changed any of it while the batch was out.
    if (job.units.some((u) => u.read() !== u.original)) return;
    job.units.forEach((unit, k) => {
      const value = values[k] ?? unit.original;
      unit.written = value;
      if (value !== unit.original) unit.write(value);
    });
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

/** The nearest ancestor that is not inline: it decides whether whitespace is preformatted. */
function blockOf(node: Node): Element | null {
  let el = node.parentElement;
  while (el && INLINE_TAGS.has(el.tagName.toUpperCase())) el = el.parentElement;
  return el;
}

function* batches<T extends { plan: Plan }>(items: T[]): Generator<T[]> {
  let batch: T[] = [];
  let lines = 0;
  let chars = 0;
  for (const item of items) {
    if (batch.length && (lines + item.plan.lines.length > BATCH_LINES || chars > BATCH_CHARS)) {
      yield batch;
      batch = [];
      lines = chars = 0;
    }
    batch.push(item);
    lines += item.plan.lines.length;
    chars += item.plan.lines.reduce((n, line) => n + line.length, 0);
  }
  if (batch.length) yield batch;
}

/** Visible jobs first, then the rest in document order. */
function sortByViewport(jobs: Job[]): Job[] {
  const height = window.innerHeight;
  const visible: Job[] = [];
  const rest: Job[] = [];
  const cache = new Map<Element, boolean>();
  for (const job of jobs) {
    const el = job.units[0]?.element;
    let inView = false;
    if (el) {
      if (!cache.has(el)) {
        const rect = el.getBoundingClientRect();
        cache.set(el, rect.bottom > 0 && rect.top < height && rect.width > 0);
      }
      inView = cache.get(el)!;
    }
    (inView ? visible : rest).push(job);
  }
  return [...visible, ...rest];
}
