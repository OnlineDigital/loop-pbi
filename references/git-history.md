# Git as a delivery record

Use Git as the durable history of delivered changes. Do not create CHANGELOG.md or a concurrently edited duplicate journal by default. Uncommitted blockers and assumptions remain in the PBI/orchestrator's working record; Git does not replace the board, CI, or active-task state. If the project requires a release changelog, generate it from the relevant commit range and edit it for the intended audience.

## Searchable commits

Follow the project's subject convention. Describe a concrete result: `feat(vehicles): add differentiated vehicle classes [PBI 023]`. The body explains the problem, resulting behavior, significant decisions, and actual checks. Include simple trailers on separate lines:

```text
PBI: 023
PBI-Phase: integration
PBI-Checks: bun test tests/vehicles (PASS); browser probe (PASS)
PBI-Evidence: Docs/Evidence/023/results.json
PBI-Limitations: none
```

Use `PBI-Phase: implementation` for a child's commit; the parent's commit including Done uses `integration`. A task may have several commits; do not manufacture a one-PBI-to-one-commit relationship. For a commit that legitimately covers multiple PBIs, repeat `PBI: ID` for each.

Commands and limitations in a commit must be true at that commit. Do not reuse PASS results from before incompatible changes. Relevant evidence belongs in versioned files with relative paths, without secrets, credentials, or unnecessary machine-specific paths. Do not include the commit's own hash in its message: obtain it after creation. Use a temporary message file and `git commit -F <file>` to avoid fragile escaping.

## Investigation before implementation

- `git status --short` and `git diff`: separate existing work from new scope.
- `git log -n 20 -- <paths>`: find recent module contracts and decisions.
- `git show <commit> -- <paths>`: read the actual change, not just its message.
- `git blame -L <start>,<end> -- <file>`: identify a contract's provenance, then read the commit and context. Blame does not prove a bug's cause.
- `git log -S <text> -- <paths>` or `git log -G <pattern> -- <paths>`: find the introduction/removal of a rule or code changes.
- `git log --all --fixed-strings --grep="PBI: 023"`: include agent branches in investigation. Presence on a child's branch does not prove integration or push.

Use these searches when history may resolve an uncertainty before asking the user to explain decisions already recorded. Historical decisions do not override current requirements.

## Stage, commit, and push

1. In a shared checkout, inspect the index before staging. Do not include files already staged by someone else. If staged ownership is unclear, serialize integration and resolve it explicitly without automatic reset.
2. Stage only exact PBI paths, including deletion of the source and addition of the move destination. Inspect `git diff --cached --stat` and `git diff --cached`; the commit must not contain another unfinished task.
3. Commit with hooks enabled. Afterward, verify `git show --stat HEAD` and the actual hash. A child's commit is not evidence of canonical board completion.
4. Check the branch, remote, upstream, and necessary upstream changes. Use `git fetch <remote>` when current remote state is needed; network errors receive bounded retries, not an infinite loop.
5. Push to the established destination. For a non-fast-forward rejection, inspect divergence and integrate according to project rules; do not force-push or automatically rebase published commits. Teammates' active/dirty work may require serial integration.
6. On resumption, verify whether the integration hash is already an ancestor of HEAD and the freshly updated remote-tracking ref. Use `git merge-base --is-ancestor <hash> <ref>`; different HEAD/upstream hashes do not alone imply a missing push. `git log <upstream>..HEAD` shows local commits not delivered to that upstream.

Locally validated Done and successful push are distinct states. If publication fails, retain the hash and destination and retry publication of that result without creating a duplicate commit. Successful push does not prove CI checks passed.
