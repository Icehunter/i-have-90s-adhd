import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Per-session off flags live in OFF_DIR/<session_id>. A file at GLOBAL_OFF (any content)
// turns the plugin off everywhere; create or delete it by hand.
export const GLOBAL_OFF = join(homedir(), '.claude', '.i-have-90s-adhd-off');
export const OFF_DIR = join(homedir(), '.claude', '.i-have-90s-adhd-off.d');

// Drop <tag>...</tag> blocks (IDE context, etc) so phrase checks see only the typed text.
// Only harness tags are removed; a user's own <p>...</p> stays.
// Linear scan: only harness tags start a match. Closers are indexed in one pass, so an opener with
// no closer ahead is skipped in O(1), however many distinct tag names appear.
// Known, accepted differences from a naive regex: a "<" inside an opener's attributes ends the
// opener (real harness tags have none), and the opener name must equal the closer name exactly.
export function stripTags(s) {
  s = String(s || '');
  const open = /<(ide_\w+|system-reminder|task-notification|command-[\w-]+|local-command-[\w-]+|bash-[\w-]+)\b[^<>]*>/g;
  const lastClose = new Map();
  for (const c of s.matchAll(/<\/(ide_\w+|system-reminder|task-notification|command-[\w-]+|local-command-[\w-]+|bash-[\w-]+)>/g)) lastClose.set(c[1], c.index);
  let out = '', last = 0, m;
  while ((m = open.exec(s))) {
    const name = m[1];
    if (!(lastClose.get(name) >= open.lastIndex)) continue;
    const close = '</' + name + '>';
    const end = s.indexOf(close, open.lastIndex);
    if (end === -1) continue;
    out += s.slice(last, m.index) + ' ';
    last = end + close.length;
    open.lastIndex = last;
  }
  return (out + s.slice(last)).trim();
}

// The whole message must be the phrase, so ordinary sentences never trigger it.
export const OFF_RE = /^\W*(stop\s+adhd\s+mode|normal\s+mode)\W*$/i;
export const ON_RE = /^\W*adhd\s+mode\s+on\W*$/i;

const key = sid => String(sid || '').replace(/[^\w-]/g, '');

export function isOff(sid) {
  try {
    if (existsSync(GLOBAL_OFF)) return true;
    const k = key(sid);
    return !!k && existsSync(join(OFF_DIR, k));
  } catch { return false; }
}
export function setOff(sid) {
  const k = key(sid);
  if (!k) return; // no session id: do nothing rather than switch off everywhere
  try { mkdirSync(OFF_DIR, { recursive: true }); writeFileSync(join(OFF_DIR, k), ''); } catch {}
}
export function clearOff(sid) {
  const k = key(sid);
  if (!k) return;
  try { unlinkSync(join(OFF_DIR, k)); } catch {}
}
