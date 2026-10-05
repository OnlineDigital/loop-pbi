# Bun CLI for Loop PBI

Read this reference when using the helper. Bun is required; worktree/history commands also require Git. The helper installs no npm packages and does not depend on Bun Shell or any particular shell. It launches processes with argument arrays and explicit cwd on Windows/Linux/macOS. Project validators may have their own requirements, such as PowerShell for `.ps1` files.

The helper is `../scripts/loop-pbi.ts`, relative to this file. Run:

```text
bun "<skill>/scripts/loop-pbi.ts" --help
bun "<skill>/scripts/loop-pbi.ts" scan --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" ready --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" validate --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" claim 023 --agent "agent-023" --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" finish 023 --evidence "evidence/023.json" --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" worktree create vehicles-lite-01 --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" worktree list --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" worktree remove vehicles-lite-01 --root "<project>"
bun "<skill>/scripts/loop-pbi.ts" history 023 --root "<project>"
```

Output is JSON; errors have exit code 1. `scan` reports errors without running validators; `ready` rejects an inconsistent board. `validate` also runs project validators. No command automatically stages, commits, or publishes changes.

## Discovery and configuration

The CLI discovers a single board with columns equivalent to `To Do`, `In Progress`, and `Done`, ignoring differences in case, spaces, underscores, and hyphens. It searches up to six directory levels, excluding hidden directories (such as `.pbi-validation-*` copies), dependencies, and build outputs. For multiple, hidden, deeper, or differently named boards, use `--board` or explicit configuration.

Optional configuration lives at `<project>/.loop-pbi.json`, or at a project-local file supplied through `--config`. Create it only when default discovery/schema support is insufficient; do not impose configuration on every project.

```json
{
  "board": "backlog",
  "columns": { "todo": "Pending", "progress": "Active", "done": "Completed" },
  "statuses": { "todo": "To Do", "progress": "In Progress", "done": "Done" },
  "fields": {
    "id": "id", "status": "status", "dependencies": "depends_on",
    "owner": "owner", "started": "started_at", "completed": "completed_at"
  },
  "validate": [["bun", "scripts/validate-board.ts"]],
  "requireDone": [["bun", "scripts/validate-board.ts", "--require-done", "{id}"]]
}
```

Use actual project commands; the example does not create the named scripts. Column paths are relative to the board; the board is relative to the project. Default statuses are directory names. Each command is an argument array without shell interpolation; `{id}` and `{file}` are substituted as argument values. Validators and checks run with the project root as cwd.

If `<board>/Validate-Board.ps1` exists and `validate` is not configured, run it through PowerShell, including `-RequireDone ID` after finish. This is that validator's known convention; configure another project's different contract explicitly. Custom `validate` replaces autodetection: include every mandatory local gate and never use `[]` as a bypass. Add other scripts, such as Validate-Plan, to configuration or run them separately according to local instructions.

The dependency-free parser supports Markdown with YAML frontmatter, simple/quoted scalars, and inline dependency arrays (`["001", "009"]` or `[]`). It is not a general YAML parser: it rejects unknown syntax in operational fields rather than treating a task as dependency-free. For block-style dependencies or dependencies declared in prose, read the project's contract and provide explicit overrides:

```json
{ "dependencies": { "023": ["022", "009"], "044": [] } }
```

For formats without frontmatter, adapt the helper/schema explicitly; do not rewrite the entire board just to fit the CLI. Documentation discovery and criteria interpretation remain the agent's responsibility.

## Claim and finish

`claim` is the To Do -> In Progress transition, not a separate reservation. It checks dependencies in Done, writes owner/started_at/status/completed_at, and moves the same file. A temporary board-level lock serializes transitions in case two processes accidentally attempt the same claim. Tasks already In Progress are not automatically reassigned.

The `.loop-pbi-lock/owner.json` lock records PID and time. A crash may leave the lock or a partial transition; inspect processes, subagents, the actual file, and metadata before recovery. Do not delete active locks based on an arbitrary timeout. The CLI does not automatically repair partial state.

`finish` requires an existing project-local evidence JSON file:

```json
{
  "id": "023",
  "criteriaSatisfied": true,
  "result": "The mechanical catalog and integration are implemented; see detailed evidence in the PBI.",
  "limitations": "None",
  "checks": [["bun", "test", "tests/vehicles"]]
}
```

`criteriaSatisfied` is the agent's assertion after review, not an automated semantic check. The CLI actually executes `checks` commands; nonzero exit codes block the move. First complete criteria and evidence in the PBI according to local rules and link this JSON file/detailed evidence. A generic script's exit code does not replace visual/hardware verification. The CLI does not automatically check off criteria or fabricate evidence.

After moving the file, it runs internal validation, optional `afterMove` commands, then final validators. `afterMove` contains existing local commands for checklist items that must be checked strictly after the move, when the project requires that. Do not configure a command that checks off unverified implementation criteria. If post-move verification fails, the file returns to In Progress with its previous metadata; body changes/new evidence are preserved. Rollback does not undo external script effects; validators should be read-only.

## Project-local worktrees

`worktree create ASSIGNMENT` creates the `loop-pbi/ASSIGNMENT` branch and `<project>/.worktrees/ASSIGNMENT` checkout from committed HEAD or `--base COMMIT`. ASSIGNMENT is a unique delegation name, such as `vehicles-lite-01`, not a PBI ID. The same subagent may work on 2-4 similar, lightweight PBIs in one worktree; the CLI does not limit a group to one PBI. The orchestrator records IDs and ownership, claims/finishes each separately, and respects canonical dependencies. One agent owns the group's checkout. The command idempotently adds `.worktrees/*` to `.gitignore` and verifies exclusion. It does not automatically commit that change; the orchestrator explicitly includes it in an infrastructure commit or the first appropriate PBI commit.

Creation does not copy uncommitted changes, untracked files, installed dependencies, or local configuration. Prerequisites are not satisfied merely by existing in the parent's dirty checkout. The canonical board remains the orchestrator's board, not the historical copy in the child's worktree. Read the current PBI and instructions from canonical paths supplied in the brief; implement code in the child's worktree.

A subdirectory worktree may be accessible to the child, but access does not change cwd or thread binding. When child tools accept explicit `cwd`/`workdir`, require the absolute worktree path for every operation and verification of `git rev-parse --show-toplevel` and the branch before editing. Do not depend on a `cd` persisting across tool calls. If the runtime does not support explicit operations in that checkout, use shared-checkout ownership; do not simulate isolation with unrequested top-level threads.

The child may create implementation commits only in its own worktree and only when the brief authorizes them; it does not edit the canonical board or push. For a group, deliver distinct commits, evidence, and results per PBI. The parent integrates serially up to the available PBI's commit, in branch order, verifies integrated code, completes that PBI, makes its final commit and push, then proceeds to the next. Do not integrate a branch tip containing unverified results. Prefer merges without history rewriting to preserve ancestry and provenance, according to project rules. Inspect the parent's staged/unstaged changes before merging; do not automatically stash/reset others' work. Resolve conflicts through contracts, not mechanical ours/theirs selection.

`worktree remove ASSIGNMENT` refuses dirty worktrees and HEADs that are not ancestors of the parent's HEAD. It does not use force and retains the branch. For checkouts created by the previous version, it also accepts the old `.worktrees/pbi-ASSIGNMENT` location when the new location is absent. After cherry-pick, ancestry may be missing even when the patch is present: refusal is intentional; inspect separately before manual cleanup. Do not remove a worktree while its agent is active or group PBI results remain unintegrated.

### Cleanup after delegation delivery

The orchestrator cleans up after every delivered group: the agent is inactive, its own processes are stopped, evidence is preserved in the project, all PBIs are integrated/validated/committed, and authorized push succeeded. `worktree remove` is deliberately a low-level command: it checks the checkout and ancestry but does not know active agents, the board, or the push destination; the orchestrator checks these preconditions.

```text
bun "<skill>/scripts/loop-pbi.ts" worktree remove vehicles-lite-01 --root "<project>"
git -C "<project>" merge-base --is-ancestor loop-pbi/vehicles-lite-01 HEAD
git -C "<project>" branch -d -- loop-pbi/vehicles-lite-01
git -C "<project>" worktree list
```

Execute sequentially and inspect each result: `branch -d` only after successful removal, ancestry verification, and confirmation that no other worktree uses the branch. Do not force with `-D` if Git refuses. The final list and disk check confirm checkout removal. Do not delete remote branches, other worktrees, or the `.worktrees` root by default. The .gitignore rule remains for future delegations.

If removal/branch deletion fails, retain the location, branch, and reason in the working record. Continue other tasks and retry only after resolving the cause. Do not lose undelivered implementations to finish cleanup. Deleting an integrated branch does not delete PBI history: commits remain accessible through the parent's branch. For idempotent resumption, first inspect `worktree list` and `git branch --list`; a location already removed does not need another removal.

## Git history as a change record

Read [git-history.md](git-history.md) for commit trailers, queries, and delivery recovery. `history ID` matches the exact `PBI: ID` trailer on the current branch without treating the ID as a regular expression. Without an ID, `history` lists the latest 50 commits, adjustable through `--limit`. Find older commits without trailers through Git using task names, messages, or files; the CLI does not guess or rewrite them.

Run helper tests with `bun test "<skill>/scripts/loop-pbi.test.ts"`; they use temporary repositories without mutating the current project.
