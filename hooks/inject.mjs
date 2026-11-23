import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTags, OFF_RE, ON_RE, isOff, setOff, clearOff } from './common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const event = process.argv[2] || 'UserPromptSubmit';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')) ?? {}; } catch {}
if (typeof input !== 'object') input = {};
const sid = input.session_id;
const prompt = stripTags(input.prompt);

if (ON_RE.test(prompt)) clearOff(sid);
else if (OFF_RE.test(prompt)) { setOff(sid); process.exit(0); }
if (isOff(sid)) process.exit(0);

const rules = readFileSync(join(here, 'rules.md'), 'utf8').trim();
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: event, additionalContext: rules },
}));
