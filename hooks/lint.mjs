import { readFileSync } from 'node:fs';
import { isOff, stripTags } from './common.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')) ?? {}; } catch { process.exit(0); }
if (typeof input !== 'object') process.exit(0);
if (input.stop_hook_active) process.exit(0); // one retry max, no loops
if (isOff(input.session_id)) process.exit(0);

// Parse per line: one bad (or null) line must not disable the lint.
const lines = [];
try {
  for (const l of readFileSync(input.transcript_path, 'utf8').replace(/^﻿/, '').split('\n')) {
    if (!l.trim()) continue;
    try { const v = JSON.parse(l); if (v && typeof v === 'object') lines.push(v); } catch {}
  }
} catch { /* no transcript: fall back to last_assistant_message only */ }

const textOf = m => {
  const c = m?.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
};
// A real prompt has typed text left after harness tags (system-reminder, task-notification, ...) are removed.
const isUserPrompt = e =>
  e.type === 'user' && !e.isMeta && !e.isCompactSummary &&
  !(Array.isArray(e.message?.content) && e.message.content.some(b => b?.type === 'tool_result')) &&
  stripTags(textOf(e)) !== '' && !/^\s*\[Request interrupted/.test(textOf(e));
const norm = s => s.replace(/[‘’]/g, "'");
const promptText = i => norm(stripTags(textOf(lines[i]))).replace(/`[^`]*`/g, ' ').toLowerCase();

const prompts = [];
lines.forEach((e, i) => { if (isUserPrompt(e)) prompts.push(i); });
const lastPrompt = prompts.length ? prompts[prompts.length - 1] : -1;

// "explain" exemption: each match counts unless negated right before it; short follow-ups inherit.
// A negator cancels the match only when just filler words sit between them
// ("no explanation", "don't bother explaining"), so "don't fix it, just explain" still counts.
const NEG = /\b(no|not|don'?t|dont|never|stop|skip|without)\s+((need|want|bother|have|going|gonna|try|to|the|an?|any|more|long|further|me|with|for)\s+)*$/;
const wantsExplain = t => {
  for (const m of t.matchAll(/\b(explain(ing)?|explanation|walk me through)\b/g)) {
    const pre = t.slice(Math.max(0, m.index - 30), m.index);
    if (!NEG.test(pre) || /\bwhy\s+(not|don'?t)\b/.test(pre)) return true;
  }
  return false;
};
const FOLLOWUP = /^\s*(continue|go on|more|keep going)\W*$/;
let explain = false;
for (let k = prompts.length - 1; k >= 0; k--) {
  const t = promptText(prompts[k]);
  if (wantsExplain(t)) { explain = true; break; }
  if (!FOLLOWUP.test(t)) break;
}

// Final reply: prefer the hook's own field, fall back to the transcript.
// If the field is present, trust it even when empty (the turn ended on tool calls: nothing to lint).
// Otherwise use only the last assistant entry, never earlier mid-turn narration.
let last = '';
if (typeof input.last_assistant_message === 'string') last = input.last_assistant_message.trim();
else {
  const lastA = lines.slice(lastPrompt + 1).filter(e => e.type === 'assistant').pop();
  last = lastA ? textOf(lastA).trim() : '';
}
if (!last) process.exit(0);
// Collapse whitespace runs so the regexes below cannot go quadratic on huge padding.
last = last.replace(/[^\S\n]+/g, ' ').replace(/\n{2,}/g, '\n');

// Drop fenced code line by line: a fence opens/closes only at line start, closes on the same
// char with at least the opener's length, and an unterminated fence runs to the end.
function stripFences(text) {
  const out = [];
  let open = null;
  for (const line of text.split('\n')) {
    if (open) {
      const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === open[0] && m[1].length >= open.length) open = null;
      continue;
    }
    // Opener may sit in a list item; a backtick in the info string means inline code, not a fence.
    const m = line.match(/^\s*(?:[-*+]|\d+[.)])?\s*(`{3,}(?![^`\n]*`)|~{3,})/);
    if (m) { open = m[1]; continue; }
    out.push(line);
  }
  return out.join('\n');
}
const prose = norm(stripFences(last))
  .replace(/`[^`\n]*`/g, ' ')
  .split('\n').filter(l => !/^\s*\|/.test(l)).join('\n').trim();

const NEXT = /^([\s*_>#-]|\d+[.)])*next\b[^:\n]{0,20}:/i;
// For the opener check, inline code becomes a placeholder token, so a reply that starts with
// a path or command (`tests/run.mjs` OK, 3/3 pass) is not mistaken for one starting with "OK".
const proseX = stripFences(last).replace(/`[^`\n]*`/g, 'x')
  .split('\n').filter(l => !/^\s*\|/.test(l)).join('\n').trim();
const lead = norm(proseX).replace(/^([\s*_>#+-]|\d+[.)]\s)+/, '');
// Closer check runs on the last line with letters that is not the "Next:" line.
const lastLine = prose.split('\n').map(s => s.trim()).filter(s => /\p{L}/u.test(s) && !NEXT.test(s)).pop() || '';
// A sentence after the first on the Next: line can still be a closer ("Next: push. Let me know if CI fails.").
const nextLine = prose.split('\n').map(s => s.trim()).filter(s => NEXT.test(s)).pop() || '';
const nextTail = nextLine.split(/(?<=[.!?])\s+/).slice(1);

const problems = [];
if (/^((great|sure|certainly|absolutely|okay|ok|alright|perfect|excellent|got it)(?=\s*([!,—–]|\.(\s|$))|\s+-\s|\s*\n|\s*$)|sure thing|great (question|idea|point)|of course(?=\s*[!,.—–]|\s*$)|let me|i'll|i will|to answer (your|the) question|happy to|thanks(?!\s+to\b)|thank you|i'm going to|let's(?!\s+encrypt\b)|you're (absolutely |totally )?right|(okay|ok|alright),?\s+(so(?!\s+far\b)|i(?![/-])|i've|here)\b|good (catch|call|question|idea|point)|no problem(?=\s*[!,.—–]|\s*$)|(now|first),? (let me|i'll))\b/i.test(lead)) problems.push('preamble opener');
// Phrase must start the line or follow a sentence/clause break, so mid-sentence mentions pass.
const CLOSER = /(^|[.!?,;:—–-]\s+|\band\s+)[\s*_>-]{0,8}((if [^.!?\n]{0,60}?[\s,]+)|((i|we|please|just|and|so|then|but|or|otherwise)\s+)){0,2}(let me know|hope (this|that|it) help(s|ed)|don'?t hesitate to|feel free to (ask|reach|ping|contact)|happy to (help|clarify)|lmk\b|just ask(?=\s*([.!?]|$)|\s+(me|away|if)\b))/i;
// "anything else?" only counts as a sentence of its own, so "..., or anything else?" (a real question) passes.
const ASKELSE = /(^|[.!?]\s+)(is there\s+anything else(\s+(i|we)\s+(can|could|should|might)\b[^?\n]*)?\s*\?|anything else\s*\?\s*$)/i;
// Sign-offs only count when they are the whole last line.
if ([lastLine, ...nextTail].some(s => CLOSER.test(s) || ASKELSE.test(s)) || /^\W*(happy (coding|hacking)|cheers|good luck)\W*$/i.test(lastLine)) problems.push('closer');
const words = prose.split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
if (!explain && words > 80) problems.push(`${words} words, cap is 80`);

if (problems.length) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: `ADHD+90s style check: ${problems.join(', ')}. Please redo the reply: answer first, no opener, no closer${explain ? '' : ', short fragments, about 40 words'}.`,
  }));
}
