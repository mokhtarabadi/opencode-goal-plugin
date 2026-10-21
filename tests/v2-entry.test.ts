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
import { loadGoalState, resolveStatePath } from '../src/state.js';

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
});
