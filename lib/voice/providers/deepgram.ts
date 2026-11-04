import 'server-only';
import type { AudioChunk, SttProvider, SttResult } from '../types';

// Deepgram live (streaming) transcription over WebSocket, per Plan 04 (Nova-3 streaming).
// Endpoint and auth verified 2026-11-03 in docs/superpowers/plans/2026-11-03-provider-verification.md.
export const DEEPGRAM_STREAM_URL = 'wss://api.deepgram.com/v1/listen';

// Query parameters. model, language and smart_format come from the plan. encoding and sample_rate
// are the minimum needed to describe raw PCM16 input (channels defaults to mono). The raw-audio
// Content-Type from the old REST path is NOT used: streaming takes the format in the query string.
export const DEEPGRAM_STREAM_QUERY = {
  model: 'nova-3',
  language: 'multi',
  smart_format: 'true',
  encoding: 'linear16',
  sample_rate: '16000',
} as const;

// 100 ms of PCM16 mono at 16 kHz.
export const DEEPGRAM_FRAME_BYTES = 3200;

const DEFAULT_TIMEOUT_MS = 20_000;

// Minimal WebSocket surface the adapter needs. The undici/browser WebSocket and the test fake both fit.
export interface DeepgramSocket {
  send(data: Uint8Array | string): void;
  close(): void;
  addEventListener(type: string, cb: (ev: { data?: unknown }) => void): void;
}

export type OpenDeepgramSocket = (url: string, headers: Record<string, string>) => DeepgramSocket;

export function defaultOpenDeepgramSocket(url: string, headers: Record<string, string>): DeepgramSocket {
  const Ctor = (globalThis as { WebSocket?: new (u: string, o?: unknown) => DeepgramSocket }).WebSocket;
  if (!Ctor) throw new Error('WebSocket is not available in this runtime');
  // Non-standard init object: undici's WebSocket accepts `headers`, which carries Authorization.
  return new Ctor(url, { headers });
}

interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
}

export function createDeepgramStt(opts: {
  apiKey: string;
  openSocket?: OpenDeepgramSocket;
  timeoutMs?: number;
}): SttProvider {
  const { apiKey } = opts;
  const open = opts.openSocket ?? defaultOpenDeepgramSocket;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${DEEPGRAM_STREAM_URL}?${new URLSearchParams(DEEPGRAM_STREAM_QUERY).toString()}`;

  return {
    name: 'deepgram',
    transcribe(audio: AudioChunk): Promise<SttResult> {
      return new Promise<SttResult>((resolve, reject) => {
        const finals: string[] = [];
        const confidences: number[] = [];
        let opened = false;
        let settled = false;

        const sock = open(url, { Authorization: `Token ${apiKey}` });

        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        // Error text is fixed: provider payloads are never echoed, so nothing sensitive is logged.
        const fail = (message: string): void =>
          finish(() => {
            try {
              sock.close();
            } catch {
              // Socket already closed; the rejection is the signal that matters.
            }
            reject(new Error(message));
          });

        const timer = setTimeout(() => fail('deepgram stream timed out'), timeoutMs);

        sock.addEventListener('open', () => {
          opened = true;
          for (let off = 0; off < audio.pcm16.byteLength; off += DEEPGRAM_FRAME_BYTES) {
            sock.send(audio.pcm16.subarray(off, off + DEEPGRAM_FRAME_BYTES));
          }
          // Tells Deepgram no more audio is coming; it flushes remaining results and closes.
          sock.send(JSON.stringify({ type: 'CloseStream' }));
        });

        sock.addEventListener('message', (ev) => {
          if (typeof ev.data !== 'string') return;
          let msg: DeepgramResultsMessage;
          try {
            msg = JSON.parse(ev.data) as DeepgramResultsMessage;
          } catch {
            return;
          }
          if (msg.type !== 'Results' || msg.is_final !== true) return;
          const alt = msg.channel?.alternatives?.[0];
          if (!alt?.transcript) return;
          finals.push(alt.transcript.trim());
          if (typeof alt.confidence === 'number') confidences.push(alt.confidence);
        });

        sock.addEventListener('error', () => fail('deepgram stream error'));

        sock.addEventListener('close', () => {
          if (!opened) {
            fail('deepgram stream closed before it opened');
            return;
          }
          finish(() =>
            resolve({
              text: finals.filter(Boolean).join(' ').trim(),
              language: 'en',
              confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
            }),
          );
        });
      });
    },
  };
}
