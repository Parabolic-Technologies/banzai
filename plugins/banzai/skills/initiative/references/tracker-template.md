# Tracker template

`start` writes the tracker in this shape. The modes find sections by heading
prefix: `## Stage`, `### Gate`, `## ADR reservations`, `## Owner decisions`,
`## Open questions` and `## Deviations from the brief`. The first column of a
stage table is the package ID, whatever its header says. The owner may add
sections. Keep the digest line exactly as shown.

```markdown
# <Initiative title> tracker

Status: active · Stage 1 not started · Updated <YYYY-MM-DD>

Brief SHA-256: `<64 lowercase hex>`

This file is the only living record of the initiative. The plan itself is the
frozen [brief.md](brief.md); never edit it. Record anything that departs from
the brief under [Deviations from the brief](#deviations-from-the-brief).

## How to use this tracker

1. Start every session here: read this file, then the brief section of the
   package you are about to touch.
2. One package, one change set, one `documentation/work/<slug>/` directory.
   Turn the brief's "Done when" items into numbered requirements and link the
   brief section.
3. A package is done only when its report is written and its row below is
   updated. The owner commits; start the next package only after that commit,
   so two change sets never mix in the working tree.
4. Reserve an ADR ID in [ADR reservations](#adr-reservations) when its draft
   starts.
5. After the last package of a stage, write the gate report in this directory
   and stop for the owner.

Status values: `not started` · `ADR draft` · `ADR proposed` · `ADR accepted` ·
`in progress` · `report ready` · `committed`.

## Baseline

- The brief was frozen against `<short commit>` (or "no commits") on
  <YYYY-MM-DD>.

## Stage 1: <name>

| ID  | Package | Depends on | ADR  | Work directory   | Status      | Commit | Notes |
| --- | ------- | ---------- | ---- | ---------------- | ----------- | ------ | ----- |
| P1  | <title> | —          | none | `<package-slug>` | not started |        |       |

### Gate 1

Report: `gate-1-report.md` (not written).

- [ ] <Gate item copied from the brief.>

## ADR reservations

| ID  | Package | Title | Status |
| --- | ------- | ----- | ------ |

## Owner decisions

- <YYYY-MM-DD>: brief frozen with `<owner's exact words>`. <One sentence of
  effect.>

## Open questions

- None.

## Deviations from the brief

- None.
```
