import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guard: no IPv4 address may be committed to the project except loopback, the unspecified
// address 0.0.0.0, and the RFC 5737 documentation ranges used by test fixtures. EC2 public and
// private addresses change on every stop/start (no Elastic IP), so they must never be hardcoded.
// Runtime values come from environment variables or DNS names set at deploy time.

const ROOT = path.resolve(__dirname, '..', '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'test-results', 'playwright-report', 'coverage']);
// Lockfiles hold integrity hashes and version pins, not hosts. Session state is not a project file.
const SKIP_FILES = new Set(['package-lock.json']);
const SKIP_PREFIXES = ['docs/superpowers/state/'];

const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d]|\.\d)/g;

export function isAllowedIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a > 255 || b > 255 || c > 255 || d > 255) return true; // not an address (e.g. 1.2.3.400)
  if (a === 127) return true; // loopback
  if (a === 0 && b === 0 && c === 0 && d === 0) return true; // unspecified bind address
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 documentation
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 documentation
  return false;
}

function trackedTextFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) trackedTextFiles(full, out);
      continue;
    }
    if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue; // binary
    out.push(rel);
  }
  return out;
}

export function findIpv4Hits(files: string[]): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(IPV4)) {
        const [a, b, c, d] = m.slice(1, 5).map(Number);
        if (!isAllowedIpv4(a, b, c, d)) hits.push(`${rel}:${i + 1}: ${m[0]}`);
      }
    });
  }
  return hits;
}

describe('no hardcoded EC2 IP addresses in project files', () => {
  it('allows only loopback, 0.0.0.0 and RFC 5737 documentation addresses', () => {
    expect(isAllowedIpv4(127, 0, 0, 1)).toBe(true);
    expect(isAllowedIpv4(0, 0, 0, 0)).toBe(true);
    expect(isAllowedIpv4(203, 0, 113, 9)).toBe(true);
    expect(isAllowedIpv4(13, 233, 104, 251)).toBe(false);
    expect(isAllowedIpv4(172, 31, 0, 10)).toBe(false);
    expect(isAllowedIpv4(10, 0, 0, 5)).toBe(false);
  });

  it('finds no public or private IPv4 address in tracked project files', () => {
    const hits = findIpv4Hits(trackedTextFiles(ROOT));
    expect(hits, `hardcoded IPv4 addresses found:\n${hits.join('\n')}`).toEqual([]);
  });
});
