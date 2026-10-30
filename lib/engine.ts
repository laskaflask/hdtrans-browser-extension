// The hdTrans engine and the requests it serves. Hosted by the offscreen document in Chrome
// and by the background page in Firefox; tests load it from disk.
import type { HdTrans, WasmModule } from 'hdtrans-runtime';
import type { EngineRequest, EngineResponse } from './messages';

interface EngineModule extends WasmModule {
  FS: { writeFile(path: string, data: Uint8Array): void };
}

type CreateEngine = (options: { wasmBinary: Uint8Array }) => Promise<EngineModule>;

/** Where the engine files come from: the extension's hdtrans/ folder, or disk in tests. */
export interface EngineFiles {
  runtime(): Promise<typeof import('hdtrans-runtime')>;
  engine(): Promise<{ default: CreateEngine }>;
  bytes(name: 'hdtrans_engine.wasm' | 'dicts.hdsnap'): Promise<ArrayBuffer | Uint8Array>;
  text(name: 'dicts.txt'): Promise<string>;
}

/** The files copied into the extension by wxt.config.ts. */
export function extensionFiles(): EngineFiles {
  // Not in WXT's typed public paths, and the same on chrome-extension:// and moz-extension://.
  const base = new URL('/hdtrans/', location.origin).href;
  return {
    runtime: () => import(/* @vite-ignore */ `${base}runtime.js`),
    engine: () => import(/* @vite-ignore */ `${base}hdtrans_engine.js`),
    bytes: (name) => fetch(base + name).then((r) => r.arrayBuffer()),
    text: (name) => fetch(base + name).then((r) => r.text()),
  };
}

export class Engine {
  private loadedUserDict = '';

  private constructor(private readonly t: HdTrans) {}

  static async load(files: EngineFiles): Promise<Engine> {
    const [{ HdTrans }, { default: create }, wasm, snapshot, version] = await Promise.all([
      files.runtime(),
      files.engine(),
      files.bytes('hdtrans_engine.wasm'),
      files.bytes('dicts.hdsnap'),
      files.text('dicts.txt'),
    ]);
    const module = await create({ wasmBinary: new Uint8Array(wasm) });
    module.FS.writeFile('/dicts.hdsnap', new Uint8Array(snapshot));
    // The dictionary version line, read from next to the snapshot.
    module.FS.writeFile('/dicts.txt', new TextEncoder().encode(version));
    // Bad user dictionary rows are skipped and reported (userDictError), not fatal: the library
    // default rejects the whole dictionary since hdTrans 0.7.0.
    return new Engine(await HdTrans.init({ module, directories: ['/dicts.hdsnap'], strictDict: false }));
  }

  private applyUserDict(userDict: string): string {
    if (userDict !== this.loadedUserDict) {
      this.t.setUserDictRaw(userDict);
      this.loadedUserDict = userDict;
    }
    return this.t.userDictError.replace(/^userdict\.tsv:/gm, '');
  }

  handle(msg: EngineRequest): EngineResponse {
    const t = this.t;
    switch (msg.type) {
      case 'info':
        return { info: { version: t.version, dictionaryVersion: t.dictionaryVersion } };
      case 'check-userdict': {
        // Validate against the same engine, then put back the dictionary in use.
        const previous = this.loadedUserDict;
        const warning = this.applyUserDict(msg.userDict);
        this.applyUserDict(previous);
        return { userDictWarning: warning };
      }
      case 'translate': {
        const userDictWarning = this.applyUserDict(msg.userDict);
        t.setSpeech(msg.speech);
        // One batch is one session: names and context carry between its lines.
        t.reset();
        const out = t.translate(msg.lines.join('\n')).split('\n');
        if (out.length === msg.lines.length) return { lines: out, userDictWarning };
        // The engine keeps the line count in practice; fall back to line by line if not.
        return {
          lines: msg.lines.map((line) => {
            t.reset();
            return t.translate(line);
          }),
          userDictWarning,
        };
      }
    }
  }
}

/** Loads the engine on first use and retries after a failed load. */
export function lazyEngine(files: () => EngineFiles): (msg: EngineRequest) => Promise<EngineResponse> {
  let engine: Promise<Engine> | undefined;
  return async (msg) => {
    engine ??= Engine.load(files()).catch((error) => {
      engine = undefined;
      throw error;
    });
    try {
      return (await engine).handle(msg);
    } catch (error) {
      return { error: String(error) };
    }
  };
}
