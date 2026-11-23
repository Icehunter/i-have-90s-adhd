import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'adhd90-'));
process.on('exit', () => { try { rmSync(home, { recursive: true, force: true }); } catch {} });
const env = { ...process.env, USERPROFILE: home, HOME: home };
let fail = 0, n = 0;

// A hook that crashes or writes to stderr fails the test, so "empty output" can't pass vacuously.
const run = (script, input, arg, raw) => {
  const r = spawnSync('node', [join(root, 'hooks', script), ...(arg ? [arg] : [])], { input: raw ?? JSON.stringify(input), env, encoding: 'utf8' });
  if (r.status !== 0 || r.stderr) { fail++; console.log(`FAIL ${script} crashed: status=${r.status} stderr=${r.stderr.slice(0, 200)}`); }
  return r.stdout;
};
const U = c => JSON.stringify({ type: 'user', message: { content: c } });
const A = t => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const lint = (rows, extra = {}) => {
  const p = join(home, `t${n++}.jsonl`);
  writeFileSync(p, rows.join('\n') + '\n');
  return run('lint.mjs', { transcript_path: p, session_id: 's1', ...extra }).includes('"block"');
};
const inj = (prompt, sid = 's1') => run('inject.mjs', { prompt, ...(sid ? { session_id: sid } : {}) }, 'UserPromptSubmit');
const long = Array(100).fill('word').join(' ');
const t = (name, got, want) => { if (got !== want) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got).slice(0, 80)}, want ${JSON.stringify(want)}`); } else console.log(`ok   ${name}`); };

// opener / closer
t('clean reply passes', lint([U('fix it'), A('Fixed a.js:3. Dope.\nNext: run tests')]), false);
t('preamble blocks', lint([U('x'), A('Sure! Done.')]), true);
t('curly I’ll blocks', lint([U('x'), A('I’ll fix that.')]), true);
t('bold **Sure!** blocks', lint([U('x'), A('**Sure!** Here.')]), true);
t('list-marker opener blocks', lint([U('x'), A('- Let me check the file.')]), true);
t('Sure thing blocks', lint([U('x'), A('Sure thing! Done.')]), true);
t('Sure + newline blocks', lint([U('x'), A('Sure\nDone.')]), true);
t('Great Expectations ok', lint([U('x'), A('Great Expectations, ch 3.')]), false);
t('Sure-fire ok', lint([U('x'), A('Sure-fire fix: git stash.')]), false);
t("I've fixed ok", lint([U('x'), A("I've fixed a.js:3. Dope.")]), false);
t('closer blocks', lint([U('x'), A('Done.\nLet me know if you need more.')]), true);
t('same-line closer blocks', lint([U('x'), A('Done. Let me know if you need more.')]), true);
t('closer mid-text ok', lint([U('x'), A('Feel free to delete the cache dir. Then run npm i.\nNext: run it')]), false);
t('one-line "feel free to delete" ok', lint([U('x'), A('Feel free to delete the cache dir.')]), false);
t('Next line with let me know ok', lint([U('x'), A('Run it.\nNext: paste exit code, let me know if it is 1')]), false);
t('closer in fence ok', lint([U('x'), A('Done.\n```\nLet me know if it breaks.\n```')]), false);
t('anything else in folder ok', lint([U('x'), A('Anything else in the folder? No.')]), false);
// word cap + explain
t('100 words blocks', lint([U('x'), A(long)]), true);
t('explain exempts', lint([U('explain it'), A(long)]), false);
t("don't explain blocks", lint([U("don't explain, just fix"), A(long)]), true);
t('curly don’t explain blocks', lint([U('don’t explain, just fix'), A(long)]), true);
t('explain inside ide tag ignored', lint([U('<ide_selection>function explain() {}</ide_selection> fix the bug'), A(long)]), true);
t('continue inherits explain', lint([U('explain monads'), A(long), U('continue'), A(long)]), false);
t('double continue inherits', lint([U('explain monads'), A(long), U('continue'), A(long), U('continue'), A(long)]), false);
t('unclosed fence not counted', lint([U('x'), A('Done.\n```\n' + long)]), false);
t('table not counted', lint([U('x'), A('Done.\n' + Array(30).fill('| a | b | c |').join('\n'))]), false);
// transcript robustness
t('malformed line still lints', lint([U('x'), '{bad json', A('Let me check.')]), true);
t('null line no crash', lint([U('x'), 'null', A('Let me check.')]), true);
t('meta skill entry ignored', lint([U('fix it'), JSON.stringify({ type: 'user', isMeta: true, message: { content: 'explain everything' } }), A(long)]), true);
t('task-notification ignored for explain', lint([U('explain the build'), A('x'), U('<task-notification>done</task-notification>'), A(long)]), false);
t('pre-tool narration not linted', lint([U('x'), A("I'll read it."), A('Fixed. Dope.')]), false);
t('last_assistant_message preferred', lint([U('x'), A('Fixed. Dope.')], { last_assistant_message: 'Sure! Done.' }), true);
t('no transcript, field only', run('lint.mjs', { transcript_path: join(home, 'nope.jsonl'), session_id: 's1', last_assistant_message: 'Sure! Done.' }).includes('"block"'), true);
t('stop_hook_active skips lint', lint([U('x'), A('Sure! Done.')], { stop_hook_active: true }), false);
run('lint.mjs', null, null, 'garbage');
run('lint.mjs', null, null, 'null');
run('inject.mjs', null, 'UserPromptSubmit', 'null');
// round 3 regressions
t('"dont explain" (no apostrophe) blocks', lint([U('dont explain, just fix'), A(long)]), true);
t('mixed explain + negated explain exempts', lint([U("explain the build, don't explain the tests"), A(long)]), false);
t('"explanation" exempts', lint([U('give me a full explanation of auth'), A(long)]), false);
t('"explaining" exempts', lint([U('can you try explaining why this fails'), A(long)]), false);
t('explain() identifier in code span blocks', lint([U('fix the `explain` bug'), A(long)]), true);
t('system-reminder + plain prompt is a prompt', lint([U([{ type: 'text', text: '<system-reminder>foo</system-reminder>' }, { type: 'text', text: 'explain the build' }]), A(long)]), false);
t('user <p>explain</p> tag kept', lint([U('<p>please explain</p>'), A(long)]), false);
t('4-backtick fence wrapping 3', lint([U('x'), A('Done.\n````\n```\n' + long + '\n```\n' + long + '\n````\nNext: go')]), false);
t('stray ``` in prose does not swallow', lint([U('x'), A('Use ``` to open a fence. ' + long)]), true);
t('stray ~~~ in prose does not swallow', lint([U('x'), A('Done ~~~ ' + long)]), true);
t('non-Latin words counted', lint([U('x'), A(Array(100).fill('слово').join(' '))]), true);
t('closer before Next: line blocks', lint([U('x'), A('Done. Let me know if you need more.\nNext: run tests')]), true);
t('comma-joined closer blocks', lint([U('x'), A('Fixed a.js:3, let me know if you need more.')]), true);
t('closer then trailing --- blocks', lint([U('x'), A('Done.\nLet me know if it breaks.\n---')]), true);
t('bold **Next:** hides nothing (closer above blocks)', lint([U('x'), A('Done. Let me know if you need more.\n**Next:** run tests')]), true);
t('bullet - Next: hides nothing', lint([U('x'), A('Done.\nLet me know if it breaks.\n- Next: run tests')]), true);
t('bold **Next:** line with let me know ok', lint([U('x'), A('Run it.\n**Next:** paste exit code, let me know if it is 1')]), false);
t('"I hope this helps!" blocks', lint([U('x'), A('Fixed a.js:3.\nI hope this helps!')]), true);
t('"Please let me know" blocks', lint([U('x'), A('Fixed.\nPlease let me know if you need more.')]), true);
t('"Done: let me know" blocks', lint([U('x'), A('Done: let me know if you need more.')]), true);
t('"no explanation" blocks', lint([U('no explanation, just the command'), A(long)]), true);
t('"skip the explanation" blocks', lint([U('skip the explanation and fix the test'), A(long)]), true);
t("don't bother explaining blocks", lint([U("don't bother explaining"), A(long)]), true);
t('inline ```cmd``` does not swallow', lint([U('x'), A('```npm test``` passes. ' + long)]), true);
t('list-item fence stripped', lint([U('x'), A('Done.\n- ```bash\n  ' + long + '\n  ```\nNext: go')]), false);
t('"don\'t fix it just explain" exempts', lint([U("don't fix it just explain it"), A(long)]), false);
t('"stop and explain" exempts', lint([U('stop and explain what you did'), A(long)]), false);
t('"no code just explain" exempts', lint([U('no code just explain'), A(long)]), false);
t('"why don\'t you explain" exempts', lint([U("why don't you explain how the hook works?"), A(long)]), false);
t('"skip the tests and explain" exempts', lint([U('skip the tests and explain the failure'), A(long)]), false);
t("don't touch auth, explain the build exempts", lint([U("don't touch auth, explain the build"), A(long)]), false);
t('"I don\'t need an explanation" blocks', lint([U("I don't need an explanation, just the command"), A(long)]), true);
t('Next (1 min) line with let me know ok', lint([U('x'), A('3/5 done.\n**Next (1 min):** run `npm test`, let me know the result')]), false);
t('Next: line closer sentence blocks', lint([U('x'), A('Fixed `parse`.\nNext: push branch. Let me know if CI fails.')]), true);
t('"Thanks for the log" blocks', lint([U('x'), A('Thanks for the log. Fixed `parse`.')]), true);
t("\"Let's start\" blocks", lint([U('x'), A("Let's start: run the migration.")]), true);
t('"Is there anything else I should check?" blocks', lint([U('x'), A('Tests green. Is there anything else I should check?')]), true);
t('"To answer the prompt" ok', lint([U('x'), A('To answer the prompt, type `y`.')]), false);
t('"and let me know" mid-line blocks', lint([U('x'), A('Fixed a.js:3 and let me know if it breaks.')]), true);
t('**Next**: bold-before-colon ok', lint([U('x'), A('Run it.\n**Next**: paste code, let me know if 1')]), false);
t('numbered-list fence stripped', lint([U('x'), A('Done.\n1. ```bash\n   ' + long + '\n   ```\nNext: go')]), false);
for (const [name, reply] of [
  ["You're absolutely right", "You're absolutely right! Fixed a.js:3."],
  ['Perfect!', 'Perfect! Tests pass now.'],
  ['Got it.', 'Got it. Fixed a.js:3.'],
  ['Good catch!', 'Good catch! Fixed a.js:3.'],
  ['Now let me', 'Now let me run the tests.'],
]) t(`opener blocks: ${name}`, lint([U('x'), A(reply)]), true);
for (const [name, reply] of [
  ['but let me know', 'Fixed a.js:3, but let me know if it still fails.'],
  ['or let me know', 'Run npm test, or let me know if you want me to.'],
  ['if ... let me know', 'If it still fails let me know.'],
  ['Hope it helps!', 'Fixed.\nHope it helps!'],
  ["Don't hesitate to ask", "Fixed.\nDon't hesitate to ask if anything is unclear."],
]) t(`closer blocks: ${name}`, lint([U('x'), A(reply)]), true);
t('"Thanks to the cache" ok', lint([U('x'), A('Thanks to the cache, build is 3s now.')]), false);
t("\"Let's Encrypt\" ok", lint([U('x'), A("Let's Encrypt cert expired. Run certbot renew.\nNext: restart nginx")]), false);
t('explain retry reason drops 40-word cap', (() => {
  const p = join(home, 'ex.jsonl');
  writeFileSync(p, [U('explain hooks'), A('Sure! ' + long)].join('\n') + '\n');
  const out = run('lint.mjs', { transcript_path: p, session_id: 's1' });
  return out.includes('preamble opener') && !out.includes('40 words');
})(), true);
t('stripTags perf: 200KB of <br> under 3s and still strips', (() => {
  const s = Date.now();
  // The closed ide_selection pair must be stripped (so "explain" does not exempt the long reply).
  const blocked = lint([U('<ide_selection>explain</ide_selection> fix it ' + '<br> '.repeat(40000)), A(long)]);
  return blocked && Date.now() - s < 3000;
})(), true);
t('200KB whitespace padding under 3s', (() => {
  const s = Date.now();
  lint([U('x'), A('Done. ' + ' '.repeat(200000) + 'x')]);
  return Date.now() - s < 3000;
})(), true);
t('dash-run last line under 3s', (() => {
  const s = Date.now();
  lint([U('x'), A('x ' + '- '.repeat(100000) + 'y')]);
  return Date.now() - s < 3000;
})(), true);
t('2MB of unclosed <system-reminder> under 3s', (() => {
  const s = Date.now();
  lint([U(('<system-reminder>' + 'x'.repeat(100)).repeat(20000)), A('Done')]);
  return Date.now() - s < 3000;
})(), true);
t('mismatched <bash-stdout>..</bash-stderr> flood under 3s', (() => {
  const s = Date.now();
  lint([U('<bash-stdout>x</bash-stderr>'.repeat(50000)), A('Done')]);
  return Date.now() - s < 3000;
})(), true);
t('100k distinct unclosed <bash-N> tags under 3s', (() => {
  const s = Date.now();
  lint([U(Array.from({ length: 100000 }, (_, i) => `<bash-${i}>x`).join('')), A('Done')]);
  return Date.now() - s < 3000;
})(), true);
t('120k "<system-reminder " fragments under 3s', (() => {
  const s = Date.now();
  lint([U('<system-reminder '.repeat(120000)), A('Done')]);
  return Date.now() - s < 3000;
})(), true);
t('curly-quote closer blocks', lint([U('x'), A('Fixed.\nDon’t hesitate to ask.')]), true);
t('BOM transcript keeps first prompt', lint(['﻿' + U('explain the build'), A(long)]), false);
t('"Looking at file:line" finding-first ok', lint([U('x'), A('Looking at lint.mjs:97, the regex misses `ide_` tags.\nNext: patch it.')]), false);
t('"Sure.js:3 has the bug" ok', lint([U('x'), A('Sure.js:3 has the bug, rename it.')]), false);
t('"Sure." still blocks', lint([U('x'), A('Sure. Fixed a.js:3.')]), true);
for (const [name, reply] of [
  ['Good question!', 'Good question! The issue is the loop.'],
  ['Okay so', 'Okay so I looked into it and fixed a.js:3.'],
  ['OK,', 'OK, fixed a.js:3.'],
  ['Okay,', 'Okay, done.'],
]) t(`opener blocks: ${name}`, lint([U('x'), A(reply)]), true);
for (const [name, reply] of [
  ['bare Anything else?', 'Fixed a.js:3.\nAnything else?'],
  ['Happy coding!', 'Fixed a.js:3.\nHappy coding!'],
  ['Cheers!', 'Fixed a.js:3.\nCheers!'],
  ['Lmk', 'Fixed a.js:3.\nLmk if you need more.'],
  ['just ask', 'Fixed a.js:3.\nIf you have more questions, just ask.'],
]) t(`closer blocks: ${name}`, lint([U('x'), A(reply)]), true);
t('"Got it working" ok', lint([U('x'), A('Got it working. `npm test` green.\nNext: push')]), false);
t('"Got it running on :3000" ok', lint([U('x'), A('Got it running on :3000. Rad.')]), false);
t('"OK: 113/113 pass." ok', lint([U('x'), A('OK: 113/113 pass.')]), false);
t('<command-args> tag stripped', lint([U('<command-args>explain x</command-args> fix the bug'), A(long)]), true);
t('<bash-stdout> tag stripped', lint([U('<bash-stdout>explain</bash-stdout> fix it'), A(long)]), true);
t('<system-reminder> tag stripped', lint([U('<system-reminder>explain everything</system-reminder> fix it'), A(long)]), true);
t('numbered step "Just ask ops" ok', lint([U('x'), A('1. Open `settings.json`\n2. Add hook\n3. Just ask ops for the token')]), false);
t('"just ask Dana" ok', lint([U('x'), A('Missing creds. Token lives with ops; just ask Dana.')]), false);
t('"then just ask infra" ok', lint([U('x'), A('Rerun CI, then just ask infra for a bigger runner if OOM repeats.')]), false);
t('"or anything else?" question ok', lint([U('x'), A('Delete `dist/` only, or anything else?')]), false);
t('"Keep legacy too, or anything else?" ok', lint([U('x'), A('Keep `legacy/` too, or anything else?')]), false);
t('"OK I/O path" ok', lint([U('x'), A('OK I/O path fixed: `read()` retries on EAGAIN.\nNext: rerun bench.')]), false);
t('"just ask." closer still blocks', lint([U('x'), A('Fixed.\nIf you have more questions, just ask.')]), true);
t('empty last_assistant_message after narration is ignored', lint([U('fix the bug'), A('Let me check the file.'), JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } })], { last_assistant_message: '' }), false);
t('no field: last assistant entry without text is ignored', lint([U('fix the bug'), A('Let me check the file.'), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: {} }] } })]), false);
t('null block in assistant content no crash', lint([U('x'), JSON.stringify({ type: 'assistant', message: { content: [null, { type: 'text', text: 'Fixed.' }] } })]), false);
t('null block in user content no crash', lint([U('x'), JSON.stringify({ type: 'user', message: { content: [null] } }), A('Fixed.')]), false);
t('"Of course the cache is stale" ok', lint([U('x'), A('Of course the cache is stale. Clear `dist/`.')]), false);
t('"Of course," blocks', lint([U('x'), A('Of course, fixing it now.')]), true);
t('"Feel free to let the build finish" ok', lint([U('x'), A('Feel free to let the build finish. Fixed a.js:3.')]), false);
t('path-first status reply ok', lint([U('x'), A('`tests/run.mjs` OK, 127/127 pass.')]), false);
t('command-first reply ok', lint([U('x'), A('`npm test` OK.')]), false);
t('real question "anything else running" ok', lint([U('x'), A('Port 3000 busy. Is there anything else running on it?')]), false);
t('real question "anything else in .env" ok', lint([U('x'), A('Is there anything else in `.env` besides API_KEY?')]), false);
t('"anything else I can help with?" blocks', lint([U('x'), A('Fixed.\nIs there anything else I can help with?')]), true);
t('"OK so far" progress ok', lint([U('x'), A('OK so far: 3/5 done. Next: step 4.')]), false);
t('"No problem in file" error report ok', lint([U('x'), A('No problem in lint.mjs:97. Bug lives in common.mjs:14: regex misses `ide_` tags.')]), false);
t('"No problem." blocks', lint([U('x'), A('No problem. Fixed a.js:3.')]), true);
t('Sure — dash opener blocks', lint([U('x'), A('Sure — done.')]), true);

// off switch
t('inject on', inj('hi').includes('ADHD+90s'), true);
t('inject scopes style to final reply only', inj('hi', 's-scope').includes('final chat reply'), true);
t('off phrase silences', inj('normal mode.'), '');
t('stays off next prompt', inj('fix the bug'), '');
t('lint off too', lint([U('x'), A('Sure!')]), false);
t('other session unaffected', inj('hi', 's2').includes('ADHD+90s'), true);
t('s2 on does not re-enable s1', (inj('adhd mode on', 's2'), inj('hi', 's1')), '');
t('s1 on restores s1', inj('adhd mode on', 's1').includes('ADHD+90s'), true);
// s1 is on, s2 is on. Turn s2 off and check s1 is untouched; then check phrases inside a sentence cannot turn s2 on.
t('s2 off does not disable s1', (inj('stop adhd mode', 's2'), inj('hi', 's1').includes('ADHD+90s')), true);
t('s2 stays off', inj('hi', 's2'), '');
t('"is adhd mode on" does not turn s2 on', inj('is adhd mode on', 's2'), '');
t('"adhd mode on" turns s2 on', inj('adhd mode on', 's2').includes('ADHD+90s'), true);
t('vim sentence ok', inj('why does vim stay in normal mode').includes('ADHD+90s'), true);
t('"never go back to normal mode" ok', inj('never go back to normal mode').includes('ADHD+90s'), true);
t('tag-wrapped prompt off', inj('<ide_opened_file>x</ide_opened_file> stop adhd mode'), '');
inj('adhd mode on');
t('no session id: off does nothing', (inj('normal mode', null), inj('hi', 's9').includes('ADHD+90s')), true);

console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
