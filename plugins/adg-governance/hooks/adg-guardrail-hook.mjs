#!/usr/bin/env node
// ADG deterministic PreToolUse hook for Claude Code.
//
// Claude Code's reasoning is stochastic; its tool *gate* is not. This hook runs
// before Bash/Edit/Write/Read and enforces ADG's deny-by-default policy at that
// gate -- the one deterministic control surface the harness offers. The Fable/Mythos
// lesson: a guardrail trained into a model can be talked around; a guardrail enforced
// outside the model cannot. So the always-on floor below is pinned IN CODE and is not
// reachable by any config toggle.
//
//   exit 2                      -> HARD BLOCK (stderr shown to the user)
//   exit 0 + permissionDecision -> allow / ask / deny with a reason
//   exit 0 (no output)          -> defer to normal permission flow (allow)
//
// Hooks fail OPEN in Claude Code (timeout/crash/exit-1 = allowed), so for mutating
// tools this hook fails CLOSED on its own errors and on a missing/malformed policy:
// if it cannot classify a Bash/Edit/Write action, it blocks rather than letting it
// through, and it treats every control as enabled.
//
// Single policy source: config/agentic/guardrails.json (controls block). Toggleable
// controls (secrets/production/migration/billing confirmation, control-file guard)
// are honored from that file; the always-on controls (destructive deny, audit
// append-only, forbidden-bulk read) ignore the toggle entirely.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// -- read the PreToolUse event from stdin -----------------------------------
let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  raw = "";
}
let event = {};
try {
  event = JSON.parse(raw || "{}");
} catch {
  event = {};
}
const tool = String(event.tool_name || "");
const input = event.tool_input || {};

const MUTATING = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"];

// -- single policy source: load the toggleable-controls block ----------------
// Always-on controls are pinned here regardless of the file, so a relaxed or
// missing policy can never disable them. Toggleable controls default to enabled
// (fail-closed) when the file is missing or malformed.
const ALWAYS_ON = new Set(["destructiveDeny", "auditAppendOnly", "forbiddenBulkRead"]);

function loadControls() {
  const candidates = [];
  if (process.env.ADG_GUARDRAILS_PATH) candidates.push(process.env.ADG_GUARDRAILS_PATH);
  candidates.push(path.join(process.cwd(), "config/agentic/guardrails.json"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const up of ["..", "../..", "../../..", "../../../.."]) {
      candidates.push(path.join(here, up, "config/agentic/guardrails.json"));
    }
  } catch {
    /* ignore */
  }
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) {
        const policy = JSON.parse(fs.readFileSync(file, "utf8"));
        if (policy && policy.controls && policy.controls.definitions) return policy.controls.definitions;
      }
    } catch {
      /* try next candidate; missing/malformed -> fail-closed (all enabled) */
    }
  }
  return null;
}

const controls = loadControls();

// A control is active unless the single policy source explicitly disables a
// non-always-on control. Always-on controls and unknown/missing entries -> active.
function controlActive(name) {
  if (ALWAYS_ON.has(name)) return true;
  const def = controls && controls[name];
  if (!def) return true;
  return def.enabled !== false;
}

// -- ADG policy patterns -----------------------------------------------------
// Generated bulk artifacts are context hazards: query them through the ADG context
// broker, never read the raw mirror/DB.
const FORBIDDEN_BULK = [
  /\.sqlite(-(wal|shm))?\b/i,
  /\bdata\/backlog\.sql\b/i,
  /\bdevelopment-tracker\.(json|sql|sqlite)\b/i,
  /-mirror\.(json|sql)\b/i,
];
// The append-only audit log: never truncate, overwrite, redirect over, or edit it.
const AUDIT_LOG = /audit-log\.jsonl$/i;
const AUDIT_TAMPER = [
  />\s*\S*audit-log\.jsonl/i, // redirect over the log (> truncates, >> bypasses the recorder)
  /\btruncate\b[^\n]*audit-log\.jsonl/i,
  /\bsed\b[^\n]*-i[^\n]*audit-log\.jsonl/i,
  /\b(rm|mv|cp|dd|tee)\b[^\n]*audit-log\.jsonl/i,
];
// Deny-by-default "destructive" risk class (pinned, always-on).
const DESTRUCTIVE = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
  /\bTRUNCATE\b/i,
  /\b(mkfs|shred)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\bfind\b[^\n]*\s-delete\b/i, // mass delete via find
  /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/i, // pipe-to-shell (RCE)
];
// "secrets" / "production" / "migration" / "billing" risk classes -> confirmation.
const SECRETS = [/\.env\b/i, /\bsecrets?\//i, /\.pem\b/i, /\bid_rsa\b/i, /\bcredentials?\b/i];
const PRODUCTION = [
  /\b(vercel|fly|flyctl|railway)\s+(deploy|apply|scale|secrets)\b/i,
  /\bterraform\s+(apply|destroy)\b/i,
  /\bnpm\s+publish\b/i,
];
const MIGRATION = [/(^|\/)migrations?\//i, /(^|\/)drizzle\//i, /\bschema\.sql$/i, /\bdb\s*:\s*migrate\b/i];
const BILLING = [/\b(stripe|braintree|chargebee|paddle)\b/i, /\b(refund|invoice|charge|payout|subscription)s?\b[^\n]*\b(create|update|delete|cancel|issue|capture|void)\b/i];
// Governance control files: confirm before editing (toggleable: controlFileGuard).
const CONTROL_FILES = [
  /config\/agentic\/guardrails\.json$/i,
  /adg-guardrail-hook\.mjs$/i,
  /\.claude\/settings\.json$/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)CLAUDE\.md$/i,
  /config\/agentic\/adg-install-state\.json$/i,
];
// Shell-side writes to a governance control file (redirect, sed -i, tee, truncate, dd)
// that would bypass the Edit/Write control-file guard. The policy and the hook are the
// trust root; a `> guardrails.json` must be surfaced, not silent.
const CONTROL_FILE_WRITE = [
  />\s*\S*(guardrails\.json|adg-guardrail-hook\.mjs|settings\.json|adg-install-state\.json)/i,
  /\b(sed\b[^\n]*(?:-i|--in-place)|tee|truncate|dd\s+of=)\b[^\n]*(guardrails\.json|adg-guardrail-hook\.mjs|settings\.json|adg-install-state\.json)/i,
];

function anyMatch(value, list) {
  return Boolean(value) && list.some((re) => re.test(value));
}

// Detect a `git ... push` invocation even when global options are inserted between
// `git` and `push` (e.g. `git -c protocol.x=y push`), which previously slipped past
// a `git\s+push` pattern. Returns "force" | "push" | null.
function gitPushKind(cmd) {
  if (!cmd) return null;
  const pushRe = /\bgit\s+(?:-c\s+\S+\s+|-C\s+\S+\s+|--\S+\s+|-[A-Za-z]\s+)*push\b/i;
  if (!pushRe.test(cmd)) return null;
  if (/--force\b|--force-with-lease\b|(?:^|\s)-f(?=\s|$)/i.test(cmd)) return "force";
  return "push";
}

// Detect `rm` invoked with both a recursive and a force flag, even when the flags
// are separated (e.g. `rm -r -f build`), which a single-token pattern misses.
function rmIsForceRecursive(cmd) {
  const m = /\brm\s+([^\n;|&]*)/i.exec(cmd);
  if (!m) return false;
  const flags = m[1];
  const hasR = /(^|\s)-(?:-recursive\b|[A-Za-z]*r[A-Za-z]*)/i.test(flags);
  const hasF = /(^|\s)-(?:-force\b|[A-Za-z]*f[A-Za-z]*)/i.test(flags);
  return hasR && hasF;
}

// Detect a recursive chmod that strips ALL permissions (chmod -R 000 / -R a-rwx),
// which locks a tree out irreversibly. Narrow on purpose: it requires BOTH a recursive
// flag AND a zero-permission target, so routine `chmod -R 755 dist` is not blocked.
function chmodIsRecursiveLockout(cmd) {
  if (!/\bchmod\b/i.test(cmd)) return false;
  const hasRecursive = /\bchmod\b[^\n;|&]*(^|\s)-(?:-recursive\b|[A-Za-z]*R[A-Za-z]*)/i.test(cmd);
  const hasZeroPerm = /\bchmod\b[^\n;|&]*\b(000|a-rwx|ugo-rwx)\b/i.test(cmd);
  return hasRecursive && hasZeroPerm;
}

function block(reason) {
  process.stderr.write(`[ADG] BLOCKED -- ${reason}\n`);
  process.exit(2);
}

function ask(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `[ADG] ${reason}`,
      },
    }),
  );
  process.exit(0);
}

function allow() {
  process.exit(0);
}

// -- write-scope enforcement (context-bound workers) -------------------------
// When ADG_WRITE_SCOPE is set (an orchestrator spawning a worker on ONE backlog item
// sets it from the item's write scope), every WRITE must fall inside the scope. This is
// a deterministic, external backstop: a worker cannot edit outside its lane even when it
// is told to "find a way", because the hook runs outside the model and reads the worker
// process's own env. Activation is env-driven and UNCONDITIONAL (not a toggleable
// control), so the worker cannot relax it from inside its run. Reads are unrestricted;
// only writes are scoped.
const WRITE_SCOPE = (() => {
  const raw = process.env.ADG_WRITE_SCOPE;
  if (!raw) return null;
  const items = String(raw).split(/[\n,]+/u).map((s) => s.trim()).filter(Boolean);
  return items.length ? items : null;
})();

function unquote(s) {
  // strip surrounding quotes, including ANSI-C ($'...') and locale ($"...") forms.
  return String(s || "").replace(/^\$?(['"])([\s\S]*)\1$/u, "$2");
}
// Collapse . and .. segments without touching the filesystem (closes ../ traversal).
function collapse(s) {
  const out = [];
  for (const seg of String(s).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else out.push(".."); }
    else out.push(seg);
  }
  return out.join("/");
}
function normRel(p) {
  let s = unquote(String(p || "").trim()).replace(/\\/gu, "/");
  const cwd = process.cwd().replace(/\\/gu, "/");
  if (s.startsWith(`${cwd}/`)) s = s.slice(cwd.length + 1);
  return collapse(s.replace(/^\.\//u, ""));
}
function matchScope(rel, pat) {
  const p = collapse(unquote(pat).replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/$/u, ""));
  if (!p) return false;
  if (rel === p) return true;
  if (rel.startsWith(`${p}/`)) return true; // directory prefix
  if (p.includes("*")) {
    const re = new RegExp(
      `^${p.split("/").map((seg) => seg
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*\*/gu, " ")
        .replace(/\*/gu, "[^/]*")
        .replace(/ /gu, ".*")).join("/")}$`,
      "u",
    );
    if (re.test(rel)) return true;
  }
  return false;
}
function inScope(target) {
  if (!WRITE_SCOPE) return true;
  // A target carrying a shell expansion ($VAR, $(...), `...`, ${...}) cannot be bounded:
  // `allowed/$DIR/o` scope-checks as a literal in-scope string while `$DIR` could expand to
  // `../forbidden`. Fail closed on any expansion anywhere in the path, for every writer
  // (redirect, tee, cp/mv destination). A real in-scope path under a worker is a literal.
  if (/[$`]/u.test(String(target || ""))) return false;
  const rel = normRel(target);
  if (!rel) return false;
  return WRITE_SCOPE.some((pat) => matchScope(rel, pat));
}

// Commands a context-bound worker may not run under an active write-scope, because their
// write target cannot be statically bounded (interpreter programs, patch/git materialise,
// sourcing, eval, line editors, xargs into a mutator). Returns a reason or null. This turns
// the interpreter/arbitrary-code boundary into a fail-closed block for the only case where
// it matters (a scoped worker); outside a scope the always-on floor still applies. Workers
// edit via Edit/Write so the path is governed, so blocking these is not a real loss.
// Command position may be preceded by these wrappers (env/nice/timeout/command/exec/
// stdbuf/xargs/sudo...), so the interpreter and editor detectors must look through them.
const WRAP = "(?:env(?:\\s+[A-Za-z_]\\w*=\\S*)*|nice(?:\\s+-n\\s*-?\\d+)?|timeout\\s+\\S+|stdbuf(?:\\s+-\\S+)*|nohup|setsid|time|command|exec|builtin|sudo(?:\\s+-\\S+)*|doas|ionice(?:\\s+-\\S+)*|chrt\\s+\\S+|taskset\\s+\\S+|xargs(?:\\s+(?:-I\\s*\\S+|-\\S+))*)\\s+";
const INTERP = "(?:python[23]?|node|ts-node|tsx|deno|bun|perl6?|raku|ruby|swift|php|hhvm|Rscript|R|osascript|lua|luajit|groovy|kotlin|kotlinc|scala|julia|pwsh|powershell|tclsh|wish|guile|gjs|jjs|clojure|clj|bb|babashka|elixir|iex|erl|escript|dart|crystal|nim|racket|sbcl|runghc|runhaskell|rhino|d8|qjs|io)";
// Shells take inline code only via -c (their -e is errexit, not eval), so a dedicated
// detector keyed on -c keeps `bash script.sh`/`bash -e script.sh` (running a script) allowed
// while blocking `bash -c "..."` inline code, symmetric with node -e / python -c above.
const SHELL_C_RE = new RegExp(`(?:^|[;&|]\\s*)(?:${WRAP})*(?:sh|bash|zsh|dash|ksh|mksh|ash)\\b[^\\n]*?\\s-c\\b`, "u");
// The trailing -[ipn]*[pn][ipn]*e arm matches perl/ruby loop one-liners -pe/-pie/-ne/-nie/-ine
// (a cluster of i/p/n containing at least one p or n and ending in e); with -i these rewrite a
// file in place. Both the print loop (-p) and the no-auto-print loop (-n) must be covered.
const INTERP_RE = new RegExp(`(?:^|[;&|]\\s*)(?:${WRAP})*${INTERP}\\b[^\\n]*?\\s(?:-e|-c|-E|--eval|--exec|--command|-Command|-EncodedCommand|-[ipn]*[pn][ipn]*e)\\b`, "iu");
const EDITOR_RE = new RegExp(`(?:^|[;&|]\\s*)(?:${WRAP})*(?:ed|ex|vi|vim|nvim|view|nano|emacs|pico|joe|sponge)\\b`, "iu");

function opaqueWriteRiskUnderScope(cmd) {
  // A redirect whose target carries a shell expansion -- a command substitution `$(...)`, a
  // backtick, a variable `$VAR`/`${VAR}`, or a process substitution `<(...)` -- cannot be
  // scope-checked statically, so it fails closed. The expansion may be the whole target
  // (`> $(echo forbidden/o)`, `` > `...` ``, `> $OUT`) OR embedded in an otherwise
  // in-scope-looking path (`> allowed/$DIR/o`, `> allowed/$(echo ../forbidden/o)`); the
  // `[^\s;|&<>]*` prefix reaches the embedded form, which the literal-target capture in
  // bashWriteTargets would otherwise wrongly treat as in-scope. fd dups (`2>&1`, `>&1`) and
  // pseudo-devices carry no expansion, so they never match.
  if (/>>?[|&]?\s*[^\s;|&<>]*(?:\$[({A-Za-z_0-9]|`|<\()/u.test(cmd)) return "a redirect to a dynamic target (command substitution, backtick, or variable) cannot be scope-checked";
  // Inline interpreter programs write files through the language, not argv, so the scope
  // cannot bound them. A broad interpreter list (tolerating wrapper prefixes like
  // `env`/`timeout`/`xargs`) with a code flag, plus a generic catch on the long eval flags
  // (which only interpreters use). Command-anchored so a read-only `grep -e`, `echo -e`, or
  // `sed -e` is not a false positive.
  if (INTERP_RE.test(cmd)) return "an inline interpreter program (-e/-c); its file writes cannot be scope-checked";
  if (SHELL_C_RE.test(cmd)) return "an inline shell program (sh -c/bash -c); its file writes cannot be scope-checked";
  // A pipe into a bare shell (`curl url | sh`, `... | bash`) executes the piped text as a
  // program whose writes the scope cannot bound. Only the bare form (nothing after the shell,
  // so stdin IS the program) matches; `| bash script.sh` feeds data to a script and is left
  // to that script's own governed writes.
  if (/\|\s*(?:sh|bash|zsh|dash|ksh|mksh|ash)\s*(?:$|[;|&])/u.test(cmd)) return "a pipe into a bare shell executes piped text whose writes the scope cannot bound";
  if (/\s(?:--eval|--exec|--command|-Command|-EncodedCommand)\s+\S/iu.test(cmd)) return "an inline eval flag (--eval/--exec/-Command); its file writes cannot be scope-checked";
  // git subcommands that materialise working-tree files from history/patches/stash; the
  // written paths come from git objects, not argv, so the scope cannot bound them. Tolerate
  // inserted global options (`git -c x=y apply`, `git -C dir restore`) the way gitPushKind does.
  // Only the materialising SHAPE blocks: the read-only / abort siblings write nothing and stay
  // allowed like `git log/status` -- `git stash list`/`stash show`, and `git merge|rebase
  // --abort/--continue/--skip/--quit`. apply/am/pull/cherry-pick/restore/checkout always
  // touch the tree. The negative lookaheads stop at a command separator so a sibling abort on
  // a later command does not suppress a real materialise on an earlier one.
  const GIT_OPT = "(?:-c\\s+\\S+\\s+|-C\\s+\\S+\\s+|--\\S+\\s+|-[A-Za-z]\\s+)*";
  if (
    new RegExp(`\\bgit\\s+${GIT_OPT}(?:apply|am|pull|cherry-pick|restore|checkout)\\b`, "iu").test(cmd) ||
    new RegExp(`\\bgit\\s+${GIT_OPT}(?:merge|rebase)\\b(?![^\\n;&|]*\\s(?:--(?:abort|continue|skip|quit|help)|-h)\\b)`, "iu").test(cmd) ||
    new RegExp(`\\bgit\\s+${GIT_OPT}stash\\b(?!\\s+(?:list|show)\\b)`, "iu").test(cmd)
  ) return "git apply/am/pull/merge/rebase/cherry-pick/restore/checkout/stash materialises working-tree files from history/patches/stash that the scope cannot bound";
  // patch / eval / source are blocked at COMMAND POSITION only (start of line or after a
  // ;/&/| separator, looking through wrappers for patch), so a read-only `grep -rn patch .`
  // or `grep -c eval src/x.ts` -- where the word is an argument, not the utility -- is not a
  // false positive. Anchoring with [\s;|&] (any space) was the bug.
  if (new RegExp(`(?:^|[;&|]\\s*)(?:${WRAP})*patch\\b`, "iu").test(cmd)) return "patch writes files determined by a diff, not by argv";
  if (/(?:^|[;&|]\s*)(?:\.|source)\s+\S/u.test(cmd)) return "sourcing a script runs unscoped writes in this shell";
  if (/(?:^|[;&|]\s*)eval\b/iu.test(cmd)) return "eval runs dynamically constructed commands";
  // `deno eval <code>` runs inline code via a SUBCOMMAND (not a -e/--eval flag), so the
  // interpreter and generic-eval-flag detectors miss it; command-anchoring `eval` above (to
  // allow `grep -c eval`) means this needs its own check.
  if (/\bdeno\s+eval\b/iu.test(cmd)) return "deno eval runs inline code whose file writes cannot be scope-checked";
  // awk/gawk/mawk with an in-program redirect (print/printf > file, incl. a parenthesised
  // target like `print > ("f")`) writes a file the redirect parser cannot bound.
  if (/\b(?:awk|gawk|mawk|nawk)\b/iu.test(cmd) && /(?:print|printf)\b[^;}\n]*>>?/iu.test(cmd)) return "awk with an in-program redirect writes a file the scope cannot bound";
  // editors and sponge can write an arbitrary path (ed/ex/vi/vim/nvim/nano/emacs in batch
  // or ex mode; moreutils sponge). Anchored at command position so an arg named e.g.
  // `vim.md` or `ed.txt` is not a false positive.
  if (EDITOR_RE.test(cmd)) return "an editor or sponge (ed/ex/vi/vim/nano/emacs/sponge) can write any file";
  // archive and file-splitting tools write files at paths the archive or prefix decides,
  // not argv, so the scope cannot bound them. A context-bound worker editing one item has
  // no need for these, so block the family at command position.
  if (/(?:^|[;&|]\s*)(?:tar|cpio|pax|ar|unzip|zip|7z|7za|split|csplit|dd)\b/iu.test(cmd)) return "an archive/split/dd tool can write files the scope cannot bound";
  // download / network transfer tools write a URL-named or remote-controlled file: curl -O,
  // wget (writes by default unless an explicit -O is parsed below), aria2c, scp/sftp. The
  // short-flag match is case-SENSITIVE (split from the case-insensitive keyword): -O/-J are
  // the unbounded remote-name forms, while a lowercase -o/--output is an explicit path the
  // scope CAN bound and is parsed in bashWriteTargets, so it must not be blocked here.
  if (/\bcurl\b/iu.test(cmd) && (/\s(?:-O|-J)\b/u.test(cmd) || /\s--remote-name(?:-all)?\b/iu.test(cmd))) return "curl -O/--remote-name writes a remote-named file the scope cannot bound";
  // wget writes the downloaded file to a default remote name unless an explicit OUTPUT is
  // given. Only the capital -O / --output-document is the output path (lowercase -o is wget's
  // LOGFILE flag, not output), so the bounded check is case-sensitive; the -O target is then
  // scope-checked in bashWriteTargets.
  const wgetBounded = /(?:^|\s)-O(?:\s|\S)/u.test(cmd) || /\s--output-document[=\s]/iu.test(cmd);
  if (/(?:^|[;&|]\s*)wget\b/iu.test(cmd) && !wgetBounded) return "wget writes a file the scope cannot bound";
  if (/(?:^|[;&|]\s*)(?:aria2c|scp|sftp|ncftpget|lftp)\b/iu.test(cmd)) return "a network transfer tool writes files the scope cannot bound";
  // compression tools write derived-named files and delete the original at paths argv does
  // not name, so the scope cannot bound them.
  if (/(?:^|[;&|]\s*)(?:gzip|gunzip|xz|unxz|bzip2|bunzip2|zstd|unzstd|lz4|unlz4|brotli|compress|uncompress|zcat)\b/iu.test(cmd)) return "a compression tool writes derived-named files the scope cannot bound";
  if (/\bxargs\b[^\n;|&]*\b(?:cp|mv|tee|touch|install|dd|truncate|ln|sed|rm|rsync)\b/iu.test(cmd)) return "xargs into a write command moves the target across a pipe, unbounded";
  return null;
}

// A captured write target carrying a shell expansion -- command substitution `$(...)`, a
// backtick, or a variable `$VAR`/`${VAR}`/`$1` -- cannot be resolved statically, so under an
// active write-scope it is an unbounded write and must fail closed rather than be scope-checked
// as a literal string (a literal check would treat `allowed/$DIR/o` as in-scope while `$DIR`
// could expand to `../forbidden`). The redirect form is caught by opaqueWriteRiskUnderScope;
// this guards the non-redirect writers (tee/cp/mv/install/ln/rsync/sed -i/dd/truncate/...).
function isDynamicTarget(t) {
  return /`|\$[({A-Za-z_0-9]/u.test(String(t || ""));
}

// In-place rewriters REWRITE their input positionals (input == output), so each positional
// path must be scope-checked like a cp destination -- a distinct class from "explicit output
// flag", because there is no output flag at all. A context-bound worker reaches for these
// constantly (format/lint-fix). Two families, plus a read-only-mode exemption so the report
// forms (`prettier file`, `eslint .`, `black --check`) stay allowed:
//   - toggle-required: write ONLY with a write toggle (--write/-w/--fix/--in-place/-i/--apply).
//   - write-by-default: write UNLESS a read-only flag (--check/--diff/--dry-run/...) is present.
//   - ruff: `ruff format` writes (unless --check/--diff); `ruff check` writes only with --fix.
// Command-anchored (through WRAP and an npx/pnpm/yarn/bunx/uvx runner prefix) so the tool NAME
// used as a mere argument (`grep prettier ...`) is not a false positive. `.`/whole-tree targets
// resolve out of scope, so `eslint --fix .` correctly blocks under a narrow scope.
const RUNNER = `(?:${WRAP})*(?:npx\\s+|pnpm\\s+(?:dlx\\s+|exec\\s+)?|yarn\\s+(?:dlx\\s+)?|bunx\\s+|uvx\\s+|uv\\s+run\\s+|poetry\\s+run\\s+|pdm\\s+run\\s+)?`;
const WRITE_TOGGLE = /(?:^|\s)(?:--write|-w|--fix(?![\w-])|--in-place|-i|--apply)\b/u;
// Read-only modes of the WRITE-BY-DEFAULT family (black/isort/rustfmt/ruff). Only flags that
// mean "do not write" for THAT family belong here: --check/--check-only/--diff/--dry-run and
// the isort short forms -c/-d. The prettier-only -l/--list-different/-n are deliberately NOT
// here -- prettier is toggle-gated (never consults this), and for black -l means --line-length
// (a value flag that still REWRITES), so listing it would make `black -l 100 src/evil.py` read
// as a no-write and slip an out-of-scope rewrite (a fail-open). -l is a VALUE_OPT instead.
const READONLY_MODE = /(?:^|\s)(?:--check(?:-only)?|--diff|--dry-run|-c|-d)\b/u;
function inPlaceRewriteTargets(cmd) {
  const out = [];
  // a value-taking option consumes the next token as its VALUE (a parser name, config path,
  // edition, ...), which is not a write target. Skip the token after a KNOWN value option only,
  // so `prettier --write --parser babel allowed/x` does not mis-read `babel` as a write -- but a
  // BOOLEAN flag the hook does not happen to enumerate (rustfmt --backup/-q/-v, black/isort -q,
  // prettier --no-semi) must NOT swallow the positional file that follows it, which would let an
  // out-of-scope rewrite slip through. Allowlisting *value* options (and failing the unknown case
  // as non-consuming) is fail-closed; an unrecognised value option only over-collects one token,
  // which is then scope-checked and, if in-scope, harmless. (A real --output-file is still caught
  // by the dedicated --out* extractor in bashWriteTargets, independent of this.)
  // Long value-options are unambiguous across these tools (their value is a parser name,
  // rule code, count, width, edition, or a config/ignore PATH the tool READS), so skip the
  // token after them. SHORT value-options are PER-FAMILY because the same letter means a
  // boolean in one tool and a value in another: -l is --line-length for black/isort (value)
  // but --list-different for prettier (boolean), -c is --config for eslint (value); -r is
  // --recursive (boolean) for autopep8/yapf and must NEVER consume, or `autopep8 -i -r
  // src/evil.py` would swallow the file. A flag NOT listed is treated as non-consuming
  // (fail-closed: at worst over-collect a value token, which is then scope-checked).
  const LONG_VALUE = "--parser|--plugin|--plugin-search-dir|--config|--config-path|--config-file|--cache-location|--cache-strategy|--ignore-path|--ignore-pattern|--log-level|--loglevel|--rulesdir|--resolve-plugins-relative-to|--parser-options|--rule|--ext|--style|-style|--fallback-style|-assume-filename|--assume-filename|--emit|--edition|--style-edition|--color|--profile|--line-length|--target-version|--extend-exclude|--exclude|--extend|--include|--src|--settings-path|--sp|--known-first-party|--known-third-party|--max-warnings|--format|--select|--ignore|--extend-select|--extend-ignore|--per-file-ignores|--tab-width|--print-width|--max-line-length|--indent-size|--lines|--end-of-line|--quote-props|--trailing-comma|--arrow-parens|--prose-wrap|--embedded-language-formatting|--html-whitespace-sensitivity|--multi-line|--force-grid-wrap|--workers|--print-config|--output-format";
  const grab = (argstr, shortValue) => {
    const valueOpt = new RegExp(`^(?:${LONG_VALUE}${shortValue ? `|${shortValue}` : ""})$`, "u");
    const toks = argstr.trim().split(/\s+/u).filter(Boolean);
    for (let i = 0; i < toks.length; i += 1) {
      const a = toks[i];
      if (a.startsWith("-")) {
        if (valueOpt.test(a) && !a.includes("=") && toks[i + 1] && !toks[i + 1].startsWith("-")) i += 1;
        continue;
      }
      if (/^(?:format|check|fmt|lint)$/u.test(a)) continue; // a subcommand word, not a path
      out.push(unquote(a));
    }
  };
  const scan = (toolRe, writes, shortValue) => {
    for (const m of cmd.matchAll(new RegExp(`(?:^|[;&|]\\s*)${RUNNER}(?:${toolRe})\\b([^\\n;|&<>]*)`, "giu"))) {
      if (writes(m[1])) grab(m[1], shortValue);
    }
  };
  // toggle family: eslint -c/--config, eslint -f/--format, autopep8 -j/--jobs are valued; -l
  // (prettier --list-different) and -r (autopep8/yapf --recursive) are booleans here, so excluded.
  scan("prettier|eslint|stylelint|gofmt|clang-format|autopep8|yapf|biome", (a) => WRITE_TOGGLE.test(a), "-c|-f|-j");
  // write-by-default family: black/isort -l/--line-length, black -t/--target-version, isort
  // -m/--multi-line, -j/--jobs are valued; -r is not used here.
  scan("black|isort|rustfmt", (a) => !READONLY_MODE.test(a), "-l|-t|-m|-j");
  scan("ruff", (a) => (/(?:^|\s)format\b/u.test(a) && !READONLY_MODE.test(a)) || WRITE_TOGGLE.test(a), "");
  return out;
}

// Extraction of the literal paths a shell command WRITES to: redirects (all forms incl.
// >|, >&, &>, no-space, quoted), tee (all files), sed -i, dd of=, truncate, mktemp,
// patch -o, and cp/mv/install/ln/rsync destinations (incl. -t target-directory and a
// symlink's points-at target). The under-scope blocker above covers what this cannot bound;
// dynamic destinations (isDynamicTarget) are surfaced and blocked by the caller.
function bashWriteTargets(cmd) {
  const targets = [];
  const TOK = '(\\$?"[^"]*"|\\$?\'[^\']*\'|[^\\s"\'`<>&|;()]+)';
  for (const m of cmd.matchAll(new RegExp(`(?:\\{[A-Za-z_]\\w*\\}|\\d+|&)?>>?[|&]?\\s*${TOK}`, "gu"))) {
    const t = unquote(m[1]);
    // skip fd dups (2>&1), dynamic targets (handled by the under-scope blocker), and the
    // pseudo-devices that are not real file writes (/dev/null, /dev/std*, /dev/fd/N, ...).
    if (t && !/^\d+$/u.test(t) && !t.startsWith("$") && !/^\/dev\/(null|zero|stdin|stdout|stderr|tty|fd\/\d+)$/u.test(t)) targets.push(t);
  }
  for (const m of cmd.matchAll(/\btee\b([^\n;|&<>]+)/gu)) {
    for (const a of m[1].trim().split(/\s+/u)) if (a && !a.startsWith("-")) targets.push(unquote(a));
  }
  // sed -i / --in-place rewrites EVERY file argument in place (not just the last), so walk
  // each sed segment and scope-check every file. The script is the first bare token UNLESS it
  // is supplied via -e/-f/--expression/--file; -i may carry a backup suffix (-i.bak) and is a
  // flag. A non-`-i` sed (no in-place) only reads, so it is skipped.
  for (const m of cmd.matchAll(/\bsed\b([^\n;|&]*)/gu)) {
    const toks = m[1].trim().split(/\s+/u).filter(Boolean);
    if (!toks.some((t) => /^(?:-i|--in-place)/u.test(t))) continue;
    let scriptDone = false; // becomes true once the script (inline or via flag) is accounted for
    for (let i = 0; i < toks.length; i += 1) {
      const t = toks[i];
      if (/^(?:-e|-f|--expression|--file)$/u.test(t)) { scriptDone = true; i += 1; continue; } // flag + its script arg
      if (/^(?:--expression|--file)=/u.test(t)) { scriptDone = true; continue; } // attached script
      if (t.startsWith("-")) continue; // -i / -n / -E / -i.bak / ...
      if (!scriptDone) { scriptDone = true; continue; } // the inline s/// script, not a file
      targets.push(unquote(t)); // a file edited in place
    }
  }
  for (const m of cmd.matchAll(/\bdd\b[^\n;|&]*\bof=("?)([^\s"'`>&|;]+)\1/gu)) targets.push(m[2]);
  for (const m of cmd.matchAll(/\b(cp|mv|install|ln|rsync)\b([^\n;|&<>]+)/gu)) {
    const tool = m[1];
    const raw = m[2].trim();
    const linkish = /(?:^|\s)-[a-z]*s/u.test(m[2]);
    const args = raw.split(/\s+/u).filter((a) => a && !a.startsWith("-"));
    // -t/--target-directory (GNU cp/mv/install/ln): the named dir is the write target and
    // EVERY positional is a SOURCE -- so the last positional is NOT a destination and must not
    // be pushed (doing so wrongly blocks `cp -t in-scope/ out-of-scope-src`). Excluded for
    // rsync, which has no --target-directory and whose -t means --times: rsync's real dest is
    // the last positional, parsed in the else branch (skipping it there would under-block).
    const td = tool !== "rsync"
      ? raw.match(/(?:^|\s)(?:-t\s+|--target-directory[=\s])("[^"]*"|'[^']*'|\S+)/u)
      : null;
    if (td) {
      targets.push(unquote(td[1])); // the only real write destination
      // a symlink still records where the link points; under -t every positional is a points-at
      // source, so keep them (over-block) to preserve the "link points outside scope" block.
      if (linkish) for (const a of args) targets.push(unquote(a));
    } else if (args.length) {
      targets.push(unquote(args[args.length - 1])); // destination
      if (linkish) targets.push(unquote(args[0])); // a symlink's points-at target
    }
  }
  for (const m of cmd.matchAll(/\btouch\b([^\n;|&<>]+)/gu)) {
    for (const a of m[1].trim().split(/\s+/u)) if (a && !a.startsWith("-")) targets.push(unquote(a));
  }
  for (const m of cmd.matchAll(/\btruncate\b([^\n;|&<>]+)/gu)) {
    const toks = m[1].trim().split(/\s+/u);
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i] === "-s" || toks[i] === "--size") { i += 1; continue; }
      if (toks[i] && !toks[i].startsWith("-")) targets.push(unquote(toks[i]));
    }
  }
  for (const m of cmd.matchAll(/\bmktemp\b([^\n;|&<>]+)/gu)) {
    const toks = m[1].trim().split(/\s+/u);
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i] === "-p" || toks[i] === "--tmpdir") { if (toks[i + 1]) targets.push(unquote(toks[i + 1])); i += 1; continue; }
      if (!toks[i].startsWith("-") && toks[i].includes("/")) targets.push(unquote(toks[i]));
    }
  }
  for (const m of cmd.matchAll(/\bpatch\b[^\n;|&]*\s(?:-o|--output[=\s])\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  // explicit output-file flags whose target IS a path the scope can bound (the unbounded
  // forms -- curl -O remote-name, bare wget, the compression family -- are blocked in
  // opaqueWriteRiskUnderScope). curl -o/--output, wget -O/--output-document, sort -o/--output.
  for (const m of cmd.matchAll(/\bcurl\b[^\n;|&]*\s-o\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\bcurl\b[^\n;|&]*\s--output[=\s]\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\bwget\b[^\n;|&]*\s-O\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\bwget\b[^\n;|&]*\s--output-document[=\s]\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  // sort and shuf (coreutils) both write an explicit literal path via -o / --output.
  for (const m of cmd.matchAll(/\b(?:sort|shuf)\b[^\n;|&]*\s(?:-o\s*|--output[=\s]\s*)("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/gu)) targets.push(unquote(m[1]));
  // compile / link / asset-build / crypto / doc tools that write an explicit literal output
  // path via a SHORT -o flag (gcc/cc/clang/g++/ld/objcopy/go build/rollup/babel/pandoc/rustc/
  // swiftc/nasm/as). -o is parsed ONLY for these enumerated tools because it is overloaded
  // elsewhere (find -o, ssh -o, mount -o). openssl uses -out. The target is a statically
  // visible path the scope can bound; read-only invocations (tsc --noEmit, go vet) carry no
  // output flag and stay allowed.
  const OUT_TOOL = "(?:cc|gcc|g\\+\\+|c\\+\\+|clang\\+?\\+?|ld|ld\\.gold|lld|objcopy|go|rollup|babel|pandoc|rustc|swiftc|nasm|emcc)";
  // case-SENSITIVE short -o (the lowercase output flag): a case-insensitive match would also
  // fire on -O (gcc/clang OPTIMIZATION level, e.g. -O2) and capture the level as a bogus path.
  // Anchored at COMMAND POSITION (start of segment, through wrappers) so a build-tool NAME used
  // as an ordinary argument -- e.g. a search term in `grep go -o src/main.go` (grep --only-matching,
  // read-only) -- is not mistaken for the build tool, capturing the searched file as a bogus write.
  for (const m of cmd.matchAll(new RegExp(`(?:^|[;&|]\\s*)(?:${WRAP})*${OUT_TOOL}\\b[^\\n;|&]*?\\s-o\\s*("[^"]*"|'[^']*'|[^\\s"'\`>&|;]+)`, "gu"))) targets.push(unquote(m[1]));
  for (const m of cmd.matchAll(/\bopenssl\b[^\n;|&]*?\s-out[=\s]\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/giu)) targets.push(unquote(m[1]));
  // unambiguous output-FILE/DIR long flags (--outfile/--out-file/--outFile, --outdir/--out-dir/
  // --outDir, --output-file/--output-document) name a path on any tool (tsc/esbuild/babel/wget).
  // Bare --output is intentionally excluded: many CLIs use it for a FORMAT (`aws --output json`),
  // not a file, so it is parsed only per-tool (curl/patch/sort) where the meaning is known.
  for (const m of cmd.matchAll(/\s--out(?:put-(?:document|file|dir)|-?(?:file|dir)|File|Dir)\b[=\s]\s*("[^"]*"|'[^']*'|[^\s"'`>&|;]+)/giu)) targets.push(unquote(m[1]));
  // uniq [OPTION]... [INPUT [OUTPUT]] -- the SECOND positional is an output file. Skip flags;
  // -f/-s/-w take a numeric arg that may be a separate token.
  for (const m of cmd.matchAll(/(?:^|[;&|]\s*)uniq\b([^\n;|&]*)/gu)) {
    const toks = m[1].trim().split(/\s+/u).filter(Boolean);
    const pos = [];
    for (let i = 0; i < toks.length; i += 1) {
      if (toks[i].startsWith("-")) { if (/^-(?:f|s|w)$/u.test(toks[i])) i += 1; continue; }
      pos.push(toks[i]);
    }
    if (pos.length >= 2) targets.push(unquote(pos[1]));
  }
  for (const t of inPlaceRewriteTargets(cmd)) targets.push(t);
  return targets.filter(Boolean);
}

// -- decide ------------------------------------------------------------------
try {
  if (["Read", "Grep", "Glob"].includes(tool)) {
    const target = String(input.file_path || input.path || input.pattern || "");
    if (anyMatch(target, FORBIDDEN_BULK)) {
      block(
        `'${target}' is a generated context hazard. Use the ADG context broker ` +
          `(npm run context:feature / context:item) instead of reading the raw mirror.`,
      );
    }
    allow();
  }

  if (tool === "Bash") {
    const cmd = String(input.command || "");
    // Always-on floor (not toggleable):
    if (anyMatch(cmd, AUDIT_TAMPER)) {
      block(`the append-only audit log may not be truncated/overwritten/redirected. Use npm run audit:record.`);
    }
    if (anyMatch(cmd, DESTRUCTIVE) || rmIsForceRecursive(cmd) || chmodIsRecursiveLockout(cmd)) {
      block(
        `destructive command (deny-by-default). If this is genuinely intended, ` +
          `re-issue it as an explicit, narrowed request: ${cmd}`,
      );
    }
    if (gitPushKind(cmd) === "force") {
      block(`force-push is destructive (deny-by-default). Re-issue explicitly if intended: ${cmd}`);
    }
    // Write-scope backstop (context-bound worker): block a shell write outside the scope
    // and any attempt to clear/override the scope env from inside the run.
    if (WRITE_SCOPE) {
      if (/\bADG_WRITE_SCOPE\b/u.test(cmd)) {
        block(`ADG_WRITE_SCOPE is the active worker write-scope and may not be unset or overridden from inside the run: ${cmd}`);
      }
      const opaque = opaqueWriteRiskUnderScope(cmd);
      if (opaque) {
        block(`a context-bound worker may not run this under an active write-scope: ${opaque}. Edit within scope with the Edit/Write tools, or report to the orchestrator: ${cmd}`);
      }
      for (const t of bashWriteTargets(cmd)) {
        if (isDynamicTarget(t)) {
          block(`shell write target '${t}' is dynamic (command substitution, backtick, or variable) and cannot be scope-checked against the active item write-scope (${WRITE_SCOPE.join(", ")}). Write to a literal in-scope path with the Edit/Write tools, or report to the orchestrator instead of widening scope.`);
        }
        if (!inScope(t)) {
          block(`shell write to '${t}' is outside the active item write-scope (${WRITE_SCOPE.join(", ")}). Stop and report to the orchestrator instead of widening scope.`);
        }
      }
    }
    if (/\b(cat|head|tail|less|more|bat)\b/.test(cmd) && anyMatch(cmd, FORBIDDEN_BULK)) {
      block(`reading a generated context hazard via the shell -- use the ADG context broker.`);
    }
    // Toggleable confirmation controls:
    if (gitPushKind(cmd) === "push" && controlActive("productionConfirm")) ask(`git push -- confirm before pushing: ${cmd}`);
    if (anyMatch(cmd, PRODUCTION) && controlActive("productionConfirm")) ask(`production / deploy command -- confirm before running: ${cmd}`);
    if (anyMatch(cmd, SECRETS) && controlActive("secretsConfirm")) ask(`secret material referenced -- confirm: ${cmd}`);
    if (anyMatch(cmd, MIGRATION) && controlActive("migrationConfirm")) ask(`migration / schema command -- confirm: ${cmd}`);
    if (anyMatch(cmd, BILLING) && controlActive("billingConfirm")) ask(`billing / payment command -- confirm: ${cmd}`);
    // Shell write to a governance control file (policy/hook/settings) bypasses the
    // Edit/Write guard; surface it (toggleable controlFileGuard). The audit log is
    // already handled above by the always-on AUDIT_TAMPER block.
    if (anyMatch(cmd, CONTROL_FILE_WRITE) && controlActive("controlFileGuard")) ask(`shell write to a governance control file -- confirm this policy/enforcement change: ${cmd}`);
    allow();
  }

  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const target = String(input.file_path || input.path || input.notebook_path || "");
    // Always-on floor: the audit log is append-only; editing it in place is blocked.
    if (AUDIT_LOG.test(target)) {
      block(`the append-only audit log may not be edited in place. Append via npm run audit:record.`);
    }
    // Write-scope backstop (context-bound worker): an edit outside the active item scope
    // is blocked deterministically, regardless of any instruction to widen scope.
    if (WRITE_SCOPE && !inScope(target)) {
      block(`editing '${target}' is outside the active item write-scope (${WRITE_SCOPE.join(", ")}). A context-bound worker may only write within its item's scope; stop and report to the orchestrator.`);
    }
    if (anyMatch(target, FORBIDDEN_BULK)) {
      ask(`editing a generated artifact directly -- regenerate it instead if possible: ${target}`);
    }
    if (anyMatch(target, CONTROL_FILES) && controlActive("controlFileGuard")) {
      ask(`editing a governance control file -- confirm this change to policy/enforcement: ${target}`);
    }
    if (anyMatch(target, SECRETS) && controlActive("secretsConfirm")) ask(`writing a secret-like path -- confirm: ${target}`);
    if (anyMatch(target, MIGRATION) && controlActive("migrationConfirm")) ask(`writing a migration / schema file -- confirm: ${target}`);
    allow();
  }

  allow();
} catch (err) {
  // Fail closed for mutating tools we could not classify; fail open for reads.
  if (MUTATING.includes(tool)) {
    block(`hook error while classifying a mutating action; failing closed: ${err && err.message}`);
  }
  allow();
}
