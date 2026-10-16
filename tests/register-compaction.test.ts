/**
 * Compaction registration fail-closed tests Phase 3.
 * Why these tests exist: prove bad hosts get reasons, never throws.
 */
import { describe, it, expect } from 'vitest';
import { registerCompactionHandler } from '../src/index.js';

describe('registerCompactionHandler fail-closed', () => {
  it('null host returns unavailable without throw', () => {
    let out: unknown;
    expect(() => {
      out = registerCompactionHandler(null, { projectDir: '/tmp' });
    }).not.toThrow();
    expect((out as { registered: boolean }).registered).toBe(false);
  });
  it('invalid opts returns invalid-opts', () => {
    const got = registerCompactionHandler(
      {},
      null as unknown as { projectDir: string },
    );
    expect(got.reason).toBe('invalid-opts');
  });
  it('empty host returns unavailable', () => {
    const got = registerCompactionHandler({}, { projectDir: '/tmp' });
    expect(got.registered).toBe(false);
  });
  it('undefined host returns unavailable without throw', () => {
    let out: unknown;
    expect(() => {
      out = registerCompactionHandler(undefined, { projectDir: '/tmp' });
    }).not.toThrow();
    expect((out as { registered: boolean }).registered).toBe(false);
  });
});
