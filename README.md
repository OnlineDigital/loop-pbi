# Loop PBI

[![skills.sh](https://skills.sh/b/onlinedigital/loop-pbi)](https://skills.sh/onlinedigital/loop-pbi)

An agent skill for continuously implementing a PBI backlog with delegated AI agents: dependency-aware scheduling, small groups of related tasks, physical board transitions, validation, Git delivery, and worktree cleanup.

## Install

```sh
npx skills add onlinedigital/loop-pbi --skill loop-pbi
```

For Codex, installed globally:

```sh
npx skills add onlinedigital/loop-pbi --skill loop-pbi --agent codex --global
```

The orchestration instructions are written in Romanian. The CLI help and machine-readable results are in English/JSON.

## Use

Invoke `$loop-pbi` in your project to process its backlog. By default, it delegates to Codex 6.1-Sol with medium reasoning and commits/pushes each completed PBI. Override the model, reasoning, scope, or Git behavior in your request, for example:

```text
$loop-pbi process only the documentation module, without push
```

The skill respects project instructions and discovers board/documentation paths instead of assuming specific folder names. Related, lightweight PBIs can share a single delegated agent and worktree; each PBI retains its own acceptance checks, evidence, lifecycle, and delivery.

Installing or reading the skill does not start implementation. Invoking it for execution authorizes the selected backlog workflow, including commit/push by default; specify `without push` when appropriate.

## Included Bun CLI

Requires [Bun](https://bun.sh). No npm dependencies. Worktree/history commands require Git; project validators retain their own runtime requirements. Run the CLI from the installed skill directory or this repository:

```sh
bun scripts/loop-pbi.ts --help
bun scripts/loop-pbi.ts scan --root /path/to/project
bun scripts/loop-pbi.ts ready --root /path/to/project
bun scripts/loop-pbi.ts validate --root /path/to/project
bun scripts/loop-pbi.ts claim 023 --agent vehicles-lite-01 --root /path/to/project
bun scripts/loop-pbi.ts finish 023 --evidence evidence/023.json --root /path/to/project
bun scripts/loop-pbi.ts worktree create vehicles-lite-01 --root /path/to/project
bun scripts/loop-pbi.ts history 023 --root /path/to/project
```

- `claim` assigns ownership and physically moves To Do → In Progress.
- `finish` executes evidence checks and project validators, moves the task to Done, and rolls back the lifecycle transition if final validation fails.
- Worktrees live under `.worktrees/<assignment>`, with `.worktrees/*` added to `.gitignore`.
- The orchestrator cleans up each completed delegation after integration, required push, and agent shutdown. The CLI refuses dirty or unintegrated worktree removal; branch deletion uses ordinary `git branch -d`.
- Git trailers make each PBI searchable without a duplicate changelog database.

Read [CLI configuration and behavior](references/cli.md) and [Git history conventions](references/git-history.md) before running mutating commands. The CLI accepts a deliberate subset of Markdown/YAML frontmatter, not arbitrary YAML. Field/folder mappings and explicit dependency overrides support different board conventions. Unknown dependency syntax is rejected rather than treated as empty.

## Delegation and checkout behavior

An orchestration runtime must support the chosen provider/model. T3-specific guidance is included, but the workflow also supports native delegation where available. A nested worktree does not automatically change a child agent's thread binding: the child must use the assigned absolute `cwd`/`workdir` for every operation. Shared-checkout ownership is the fallback when explicit worktree operations are unsupported.

## Tests

```sh
bun test scripts/loop-pbi.test.ts
```

Tests use isolated temporary repositories, covering dependency validation, concurrent claims, physical transitions, failed-validation rollback, shared worktrees for multiple PBIs, and cleanup protections.

## Discoverability on skills.sh

[The official FAQ](https://skills.sh/docs/faq) explains that skills are listed through installation telemetry from the `skills` CLI. Public GitHub availability and installability are immediate; leaderboard indexing is controlled by skills.sh and may not be immediate.
