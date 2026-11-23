# i-have-90s-adhd

Claude Code plugin. Terse, ADHD-shaped replies with light 90s slang, enforced by hooks, not hoped for.

## Why it sticks

- `UserPromptSubmit` hook re-injects `hooks/rules.md` on every prompt, so the rules never decay.
- `Stop` hook (`hooks/lint.mjs`) blocks a reply once if it has a preamble opener, a closer, or more than 80 prose words. Claude rewrites it.

## Install

```
claude --plugin-dir /path/to/i-have-90s-adhd
```

Or `/plugin marketplace add <this repo>` then `/plugin install i-have-90s-adhd`.

## Off switch

- Send a message that is only `stop adhd mode` or `normal mode`: off for that session.
- Send only `adhd mode on`: back on.
- Create `~/.claude/.i-have-90s-adhd-off`: off everywhere. Delete it to turn back on.
- Per-session off flags are empty files in `~/.claude/.i-have-90s-adhd-off.d/`. Safe to delete.

Say "explain" or "walk me through" in a prompt to lift the 80-word cap for that turn.

## Tests

```
node tests/run.mjs
```

Uses a temp home directory; never touches your real `~/.claude`.
