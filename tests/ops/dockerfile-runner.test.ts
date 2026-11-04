import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// The production image runs `node server.js` from .next/standalone. That server does not serve
// the project's public/ folder, so the runner stage must copy it in explicitly (Next.js standalone docs).
const dockerfile = readFileSync(join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));

describe('Dockerfile runner stage', () => {
  test('copies public/ so /icons/* in the manifest resolve under node server.js', () => {
    expect(runner).toMatch(/COPY --from=build \/app\/public \.\/public/);
  });

  test('copies .next/static beside the standalone server', () => {
    expect(runner).toMatch(/COPY --from=build \/app\/\.next\/static \.\/\.next\/static/);
  });

  test('runs as a non-root user', () => {
    const user = runner.match(/^USER\s+(\S+)\s*$/m)?.[1];
    expect(user, 'runner stage must set a USER directive').toBeDefined();
    const uid = user!.split(':')[0];
    expect(uid).not.toBe('root');
    expect(uid).not.toBe('0');
  });

  test('starts the standalone server', () => {
    expect(runner).toMatch(/CMD \["node", "server\.js"\]/);
  });
});
