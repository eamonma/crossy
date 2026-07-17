---
name: dream
description: Reconcile the docs with reality. Verifies doc claims against code and vectors, captures design decisions that landed only in PRs, and proposes reorganization. Run when the CI doc-staleness job warns, after a wave-track merges, or on request.
---

# Dreaming: periodic doc reconciliation

Docs are this project's long-term memory, and agents navigate by them. A dream
replays what happened since the last one (merged PRs, new code, vector changes) and
consolidates it into the docs, the way sleep consolidates the day. Without it, drift
compounds: agents plan against stale claims and re-litigate decided questions.

## Doc statuses

Every tracked `*.md` in scope carries YAML frontmatter:

```yaml
---
status: normative | descriptive | archive
verified: <full commit sha last verified against, absent = never verified>
---
```

- **normative**: code must match the doc. `PROTOCOL.md`, `DESIGN.md`,
  `ANALYTICS.md`, `vectors/**`, and plan-of-record design docs (`design/**`).
- **descriptive**: the doc must match the code. READMEs, `ROADMAP.md`, feature
  design docs (`docs/design/**`), per-app docs.
- **archive**: frozen point-in-time record (`reports/**`). Never verified, never
  updated. A content edit to an archive doc is a review red flag; reclassifying one
  is an owner call.

`CLAUDE.md` is normative by fiat and carries no frontmatter: every line of it loads
into every agent context, so it stays lean. The repo precedence rule is unchanged:
`vectors/` > `PROTOCOL.md` > `DESIGN.md` prose > any implementation.

Out of scope: `CLAUDE.md` (above), `crossy-design-system (v2 reference)/`, generated
or vendored markdown. A new doc declares its status at birth; the next dream
classifies any that forgot.

## The direction rule (the one invariant)

Repair direction follows status, never convenience:

- **Normative doc vs code drift is a code bug.** File a GitHub issue labeled
  `drift/normative`, one per owning doc with the drifts itemized and
  severity-tagged, citing evidence on both sides (`doc section` and `file:line`).
  NEVER edit a normative doc to match the code: that launders a bug into the spec.
  The issue may propose a code fix or an owner-ruled doc amendment; the owner
  decides which.
- **Descriptive doc vs code drift is a doc bug.** Fix the doc in a scoped PR.
- **Broken cross-references are mechanical repairs**, even in normative docs: a
  dead pointer cannot launder a bug, so retargeting or removing it rides a dream
  PR. The direction rule protects behavior claims.

## Running a dream

**Preflight.** Record HEAD (the sha this dream stamps into watermarks). Find the
previous report in `reports/dreams/` to bound the replay window; if none, the window
is the doc's `verified` sha, or its last-touched commit when unverified.

**Pass 1, accuracy.** For each non-archive doc whose subject code changed since its
watermark: extract every checkable claim (ownership statements, constants, behavior,
file paths, cross-references), verify each against code and vectors. Weight status
lines and temporal phrasing ("later", "upcoming", "ahead of the engine", "this PR")
highest: dream #1 found nearly all drift there, not in behavior claims. Fan out one
agent per doc; agents return claim verdicts, they do not edit. Drifted descriptive
claims become doc fixes. Drifted normative claims become issues.

Watermarks stamp only fully-settled docs: clean as verified, or clean once the fix
riding the same PR lands. A doc with an open `drift/normative` issue stays
unstamped so the staleness nudge keeps pointing at it until the owner rules.

**Pass 2, decision capture.** Walk PRs merged since the last dream. For each, ask:
did this embody a design decision no doc records (a tradeoff chosen, a contract
extended, an owner ruling in a PR thread)? Write each into the doc that owns that
territory, linking the PR as provenance. Decisions belong in docs; PR descriptions
are where decisions go to be forgotten.

**Pass 3, organization.** With the full inventory: propose merges, splits, moves,
and archival (docs describing shipped work, duplicate trees, oversized live docs).
Propose in the report only. Structural moves execute in a follow-up PR after owner
sign-off, because in-flight branches reference current paths.

**Report.** Write `reports/dreams/YYYY-MM-DD.md` (status: archive when written):
claims checked and verdicts, drift found and where each went (PR or issue link),
decisions captured, organization proposals, docs deliberately skipped. The report
rides the same PR as the watermark stamps.

## Output conventions

- Branches: `dream/<yyyy-mm-dd>-<area>`. Doc-fix PRs stay small, one area each,
  through the normal PR gate (main is golden).
- Watermark stamps for a doc ride the same PR as that doc's fixes.
- Issues: title `drift: <doc> vs <code area>`, label `drift/normative`.
- Never mix a dream PR with feature work.

## Staleness nudge

`scripts/doc-staleness.sh` (CI job `doc-staleness`, advisory, never blocks) warns
when a normative doc's watermark falls more than 15 code commits behind HEAD or was
never verified. A warning means a dream is due, not that anything is broken.
