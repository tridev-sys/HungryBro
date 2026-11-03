import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'app/theme.css'), 'utf8');

test('theme defines the core colour tokens', () => {
  for (const token of ['--color-bg', '--color-surface', '--color-accent', '--color-sla-red', '--color-orb-a']) {
    expect(css).toContain(token);
  }
});
