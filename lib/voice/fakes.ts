import type {
  Clock,
  AudioChunk,
  SttProvider,
  SttResult,
  TtsProvider,
  TranslationProvider,
  VadProvider,
  VadFrameResult,
  LangCode,
  ReplyLanguage,
  LlmProvider,
  LlmRequest,
  LlmOutput,
} from './types';

export class ManualClock implements Clock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

export class FakeStt implements SttProvider {
  readonly name = 'fake';
  private readonly text: string;
  private readonly language: LangCode;
  private readonly clock?: ManualClock;
  private readonly delayMs: number;

  constructor(opts: { text: string; language?: LangCode; clock?: ManualClock; delayMs?: number }) {
    this.text = opts.text;
    this.language = opts.language ?? 'en';
    this.clock = opts.clock;
    this.delayMs = opts.delayMs ?? 0;
  }

  async transcribe(_audio: AudioChunk): Promise<SttResult> {
    this.clock?.advance(this.delayMs);
    return { text: this.text, language: this.language, confidence: 1 };
  }
}

export class FakeTts implements TtsProvider {
  readonly name = 'fake';
  private readonly clock?: ManualClock;
  private readonly firstChunkDelayMs: number;
  private readonly chunks: number;

  constructor(opts: { clock?: ManualClock; firstChunkDelayMs?: number; chunks?: number } = {}) {
    this.clock = opts.clock;
    this.firstChunkDelayMs = opts.firstChunkDelayMs ?? 0;
    this.chunks = opts.chunks ?? 2;
  }

  async *synthesize(_text: string, _language: ReplyLanguage): AsyncIterable<Uint8Array> {
    this.clock?.advance(this.firstChunkDelayMs);
    for (let i = 0; i < this.chunks; i++) {
      yield new Uint8Array(4);
    }
  }
}

export class FakeTranslation implements TranslationProvider {
  readonly name = 'fake';
  readonly calls: Array<{ text: string; from: LangCode; to: LangCode }> = [];
  private readonly table: Record<string, string>;
  private readonly clock?: ManualClock;
  private readonly delayMs: number;

  constructor(opts: { table?: Record<string, string>; clock?: ManualClock; delayMs?: number } = {}) {
    this.table = opts.table ?? {};
    this.clock = opts.clock;
    this.delayMs = opts.delayMs ?? 0;
  }

  async translate(text: string, from: LangCode, to: LangCode): Promise<string> {
    this.calls.push({ text, from, to });
    this.clock?.advance(this.delayMs);
    return this.table[text] ?? text;
  }
}

export class FakeVad implements VadProvider {
  readonly name = 'fake';
  private readonly script: VadFrameResult[];
  private index = 0;

  constructor(script: VadFrameResult[]) {
    this.script = script;
  }

  process(_frame: Float32Array): VadFrameResult {
    if (this.index < this.script.length) {
      return this.script[this.index++];
    }
    return { speech: false, level: 0 };
  }

  reset(): void {
    this.index = 0;
  }
}

export class FakeLlm implements LlmProvider {
  readonly name = 'fake' as const;
  readonly model = 'fake';
  readonly requests: LlmRequest[] = [];
  private readonly queue: Array<LlmOutput | Error>;
  private readonly clock?: ManualClock;
  private readonly delayMs: number;

  constructor(outputs: Array<LlmOutput | Error>, opts: { clock?: ManualClock; delayMs?: number } = {}) {
    this.queue = [...outputs];
    this.clock = opts.clock;
    this.delayMs = opts.delayMs ?? 0;
  }

  async complete(req: LlmRequest): Promise<LlmOutput> {
    this.requests.push(req);
    this.clock?.advance(this.delayMs);
    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('FakeLlm: no scripted output left');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}
