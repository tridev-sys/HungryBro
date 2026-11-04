import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Guard: no IPv4 address may be committed to the project except loopback, the unspecified
// address 0.0.0.0, and the RFC 5737 documentation ranges used by test fixtures. EC2 public and
// private addresses change on every stop/start (no Elastic IP), so they must never be hardcoded.
// Runtime values come from environment variables or DNS names set at deploy time.
//
// Only git-tracked files are scanned (git ls-files). The guard never walks the directory tree, so
// untracked or unreadable paths (for example the root-owned data disk mounted at data/) are never
// touched.

const ROOT = path.resolve(__dirname, '..', '..');

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

// Paths git tracks under root, as repo-relative POSIX paths. Nothing else is listed.
export function gitTrackedFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.toString('utf8').split('\0').filter((rel) => rel.length > 0);
}

// Tracked regular text files to scan. Binary files, symlinks, submodules and tracked paths that are
// missing from the working tree are skipped.
function textFilesToScan(root: string): string[] {
  const files: string[] = [];
  for (const rel of gitTrackedFiles(root)) {
    if (SKIP_FILES.has(path.posix.basename(rel))) continue;
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const st = fs.lstatSync(full);
    if (!st.isFile()) continue;
    if (fs.readFileSync(full).includes(0)) continue; // binary
    files.push(rel);
  }
  return files;
}

export function findIpv4Hits(root: string = ROOT): string[] {
  const hits: string[] = [];
  for (const rel of textFilesToScan(root)) {
    const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n');
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

  it('finds no public or private IPv4 address in git-tracked project files', () => {
    const hits = findIpv4Hits(ROOT);
    expect(hits, `hardcoded IPv4 addresses found:\n${hits.join('\n')}`).toEqual([]);
  });

  it('scans only git-tracked files and never visits untracked or unreadable paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipguard-'));
    const locked = path.join(tmp, 'locked');
    try {
      // Private-range address built at run time so this file itself holds no such literal.
      const privateIp = ['10', '0', '0', '5'].join('.');
      execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'pipe' });
      fs.writeFileSync(path.join(tmp, 'clean.txt'), 'no addresses here\n');
      fs.writeFileSync(path.join(tmp, 'tracked-bad.txt'), `host=${privateIp}\n`);
      execFileSync('git', ['add', 'clean.txt', 'tracked-bad.txt'], { cwd: tmp, stdio: 'pipe' });

      // Untracked content, including an unreadable directory, must not be visited.
      fs.writeFileSync(path.join(tmp, 'untracked-bad.txt'), `host=${privateIp}\n`);
      fs.mkdirSync(locked);
      fs.writeFileSync(path.join(locked, 'secret.txt'), `host=${privateIp}\n`);
      fs.chmodSync(locked, 0o000);

      const hits = findIpv4Hits(tmp);
      expect(hits).toEqual([`tracked-bad.txt:1: ${privateIp}`]);
    } finally {
      if (fs.existsSync(locked)) fs.chmodSync(locked, 0o755);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
