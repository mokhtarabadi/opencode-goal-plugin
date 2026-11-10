/**
 * V2 host wiring tests.
 * Why these tests exist: prove the default export passes the host schema
 * and setup wires command plus idle plus hooks on a stub context.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index.js';
import { PLUGIN_NAME } from '../src/index.js';
import {
  initialState,
  loadGoalState,
  resolveStatePath,
  saveGoalState,
} from '../src/state.js';
import { _resetWatchdogsForTests, watchdogCount } from '../src/watchdog.js';

/**
 * Controllable host event stream.
 * Why a queue: the failure event must be pushed only after the startup rearm
 * scan has run with no goal on disk, so the test proves the event path rearmed
 * the watchdog rather than the scan.
 */
function makeEventStream() {
  const queue: unknown[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const kick = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const stream = {
    [Symbol.asyncIterator]() {
      return stream;
    },
    async next(): Promise<{ value: unknown; done: boolean }> {
      if (queue.length > 0) return { value: queue.shift(), done: false };
      if (closed) return { value: undefined, done: true };
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      if (queue.length > 0) return { value: queue.shift(), done: false };
      return { value: undefined, done: true };
    },
    async return(): Promise<{ value: unknown; done: boolean }> {
      closed = true;
      kick();
      return { value: undefined, done: true };
    },
  };
  return {
    stream,
    push: (event: unknown) => {
      queue.push(event);
      kick();
    },
    close: () => {
      closed = true;
      kick();
    },
  };
}

describe('v2 entry shape', () => {
  it('exports id plus setup for the host loader', () => {
    expect((plugin as unknown as { id: unknown }).id).toBe(PLUGIN_NAME);
    expect(typeof (plugin as unknown as { setup: unknown }).setup).toBe(
      'function',
    );
  });
});

describe('v2 setup wiring', () => {
  it('registers goal command and sets state through it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-v2-'));
    const added: { name: string; execute: (i: unknown) => Promise<void> }[] =
      [];
    const prompts: unknown[] = [];
    // Recording editor captures the command definition for direct execution.
    let captured: {
      name: string;
      execute: (i: unknown) => Promise<void>;
    } | null = null;
    const recording = {
      location: { directory: dir },
      command: {
        transform: async (
          fn: (e: {
            add: (d: {
              name: string;
              execute: (i: unknown) => Promise<void>;
            }) => void;
          }) => void,
        ) => {
          fn({
            add: (d: {
              name: string;
              execute: (i: unknown) => Promise<void>;
            }) => {
              captured = d;
              added.push(d);
            },
          });
        },
      },
      session: {
        prompt: async (a: unknown) => {
          prompts.push(a);
          return { messageId: 'm-cmd' };
        },
        synthetic: async () => {},
        hook: async () => {},
      },
      event: {
        subscribe: async function* () {
          // No events: subscription opens and closes cleanly.
        },
      },
    };
    const cleanup = await (
      plugin as unknown as { setup: (c: unknown) => Promise<() => void> }
    ).setup(recording);
    expect(added.map((d) => d.name)).toContain('goal');
    await captured!.execute({
      sessionID: 's1',
      prompt: { text: 'ship v2 entry' },
    });
    const state = await loadGoalState(resolveStatePath(dir, 's1'));
    expect(state?.objective).toBe('ship v2 entry');
    expect(state?.status).toBe('active');
    (cleanup as () => void)();
    expect(prompts.length).toBeGreaterThan(0);
  });

  it('a provider error rearms the watchdog from the failing session state', async () => {
    // Regression: the failure listener saved the retry to the session-scoped
    // state file but then read the legacy path to rearm. With per-session files
    // that read returned null (or, worse, another session's legacy goal), so the
    // watchdog ADR-007 added for "no session.idle ever arrives" was never armed.
    const dir = mkdtempSync(path.join(tmpdir(), 'goal-v2-rearm-'));
    _resetWatchdogsForTests();
    const clock = { nowMs: () => 1700000000000 };
    const events = makeEventStream();
    let prompts = 0;
    const host = {
      location: { directory: dir },
      session: {
        prompt: async () => {
          prompts += 1;
          return { messageID: 'm-rearm' };
        },
        synthetic: async () => {},
        hook: async () => {},
      },
      event: { subscribe: () => events.stream },
    };
    const cleanup = (await (
      plugin as unknown as { setup: (c: unknown) => Promise<() => void> }
    ).setup(host)) as () => void;
    // Let the startup rearm scan finish while no goal exists on disk.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(watchdogCount()).toBe(0);
    await saveGoalState(
      resolveStatePath(dir, 's-fail'),
      initialState('survive a provider error', clock, '2.0.29'),
    );
    events.push({
      type: 'session.error',
      properties: {
        sessionID: 's-fail',
        error: { name: 'ProviderError', message: 'fetch failed' },
      },
    });
    // Poll for the rearm: the listener writes the retry, then arms the timer.
    for (let i = 0; i < 100 && watchdogCount() === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(watchdogCount()).toBe(1);
    // A provider error records a retry, it never burns a continuation.
    expect(prompts).toBe(0);
    cleanup();
    events.close();
    _resetWatchdogsForTests();
  });
});
