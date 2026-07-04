import { describe, it, expect } from 'vitest';
import { validateContent } from '../tools/validate-content.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('content validator', () => {
  it('runs and returns an array of problems', () => {
    const problems = validateContent(root);
    expect(Array.isArray(problems)).toBe(true);
  });

  it('reports no dangling cross-references in shipped content', () => {
    const problems = validateContent(root);
    if (problems.length) {
      // Surface them so the test output is actionable.
      console.error(problems.join('\n'));
    }
    expect(problems).toEqual([]);
  });
});
