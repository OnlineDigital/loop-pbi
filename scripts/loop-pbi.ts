#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync, rmdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join, relative, dirname, basename, sep, isAbsolute } from 'node:path';

// No package dependencies. Git and configured project validators remain external tools.
type Column = 'todo' | 'progress' | 'done';
type Config = {
  board?: string; columns?: Partial<Record<Column, string>>;
  fields?: Partial<Record<'id' | 'status' | 'dependencies' | 'owner' | 'started' | 'completed', string>>;
  statuses?: Partial<Record<Column, string>>;
  dependencies?: Record<string, string[]>;
  validate?: string[][]; requireDone?: string[][]; afterMove?: string[][];
};
type Task = { id: string; column: Column; file: string; status: string; dependencies: string[]; owner?: string; title: string };
const ignored = new Set(['.git', '.worktrees', 'node_modules', 'dist', 'build', '.next', '.loop-pbi-lock']);
const fields = { id: 'id', status: 'status', dependencies: 'depends_on', owner: 'owner', started: 'started_at', completed: 'completed_at' };
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
const fail = (s: string): never => { throw new Error(s); };
function inside(root: string, candidate: string) {
  const p = resolve(root, candidate), rel = relative(root, p);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail(`Path escapes root: ${candidate}`);
  // Refuse symlink/junction traversal as well as lexical escapes.
  let parent = p;
  while (!existsSync(parent)) { const next = dirname(parent); if (next === parent) fail(`Missing path root: ${p}`); parent = next; }
  const physical = relative(realpathSync(root), realpathSync(parent));
  if (physical === '..' || physical.startsWith('..' + sep) || isAbsolute(physical)) fail(`Symlink escapes root: ${p}`);
  return p;
}
function run(root: string, argv: string[], allowFailure = false) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) fail('Commands must be nonempty string arrays, never shell text');
  const result = Bun.spawnSync(argv, { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const stdout = result.stdout.toString().trim(), stderr = result.stderr.toString().trim();
  if (result.exitCode !== 0 && !allowFailure) fail(`Command failed (${result.exitCode}): ${JSON.stringify(argv)}\n${stderr || stdout}`);
  return { argv, exitCode: result.exitCode, stdout, stderr };
}
function git(root: string, ...args: string[]) { return run(root, ['git', ...args]).stdout; }
function walk(root: string, depth = 0): string[] {
  if (depth > 5) return [];
  return readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !ignored.has(e.name))
    .flatMap(e => { const p = join(root, e.name); return [p, ...walk(p, depth + 1)]; });
}
function atomicWrite(file: string, text: string) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { writeFileSync(temp, text, { flag: 'wx' }); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
function frontmatter(text: string): { head: string; body: string; newline: string; values: Map<string, string> } {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) fail('Expected Markdown with YAML frontmatter; adapt the project schema explicitly');
  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) { if (values.has(m[1])) fail(`Duplicate frontmatter key: ${m[1]}`); values.set(m[1], m[2]); }
  }
  return { head: match[1], body: match[2], newline: text.includes('\r\n') ? '\r\n' : '\n', values };
}
function scalar(raw: string | undefined, key: string): string {
  if (raw === undefined) fail(`Missing frontmatter field ${key}`);
  const value = raw!.trim();
  if (value.startsWith('"')) { try { const s = JSON.parse(value); if (typeof s === 'string') return s; } catch {} fail(`Unsupported quoted value for ${key}`); }
  if (/^'[^\n]*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (!value || value === 'null' || /^[\[{>|&*!]/.test(value) || /\s#/.test(value)) fail(`Unsupported scalar for ${key}: ${value}`);
  return value;
}
function dependencies(raw: string | undefined, key: string): string[] {
  if (raw === undefined) fail(`Missing ${key}; use [] or configure explicit dependency overrides`);
  const value = raw!.trim();
  if (!/^\[.*\]$/.test(value)) fail(`Unsupported ${key}: only inline scalar arrays are supported; configure overrides for other YAML`);
  if (value === '[]' || /^\[\s*\]$/.test(value)) return [];
  return value.slice(1, -1).split(',').map(x => scalar(x.trim(), key));
}
function update(text: string, values: Record<string, string | null>) {
  const fm = frontmatter(text); let lines = fm.head.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}: ${value === null ? 'null' : JSON.stringify(value)}`;
    const i = lines.findIndex(x => x.startsWith(key + ':'));
    if (i < 0) lines.push(line); else lines[i] = line;
  }
  return `---${fm.newline}${lines.join(fm.newline)}${fm.newline}---${fm.newline}${fm.body}`;
}

class Board {
  root: string; board: string; paths: Record<Column, string>; statuses: Record<Column, string>;
  config: Config; fields: typeof fields;
  constructor(root: string, config: Config, boardOverride?: string, public allowProjectCommands = false) {
    this.root = root; this.config = config; this.fields = { ...fields, ...config.fields };
    let board = boardOverride || config.board;
    if (!board) {
      const candidates = [root, ...walk(root)].filter(p => {
        const names = readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => norm(e.name));
        return names.includes('todo') && names.includes('inprogress') && names.includes('done');
      });
      if (candidates.length !== 1) fail(`Expected one board, found ${candidates.length}; use --board or configuration. Candidates: ${JSON.stringify(candidates)}`);
      board = candidates[0];
    }
    this.board = inside(root, board!);
    const names = readdirSync(this.board, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    const canonical = { todo: 'todo', progress: 'inprogress', done: 'done' };
    this.paths = {} as Record<Column, string>; this.statuses = {} as Record<Column, string>;
    for (const col of Object.keys(canonical) as Column[]) {
      const matches = names.filter(n => norm(n) === canonical[col]);
      const name = config.columns?.[col] || (matches.length === 1 ? matches[0] : undefined);
      if (!name) fail(`Cannot resolve ${col} column; configure columns explicitly`);
      const p = inside(this.board, name);
      if (!existsSync(p) || !lstatSync(p).isDirectory()) fail(`Column missing: ${p}`);
      this.paths[col] = p; this.statuses[col] = config.statuses?.[col] || basename(p);
    }
    if (new Set(Object.values(this.paths)).size !== 3) fail('Columns must be distinct');
  }
  tasks(): Task[] {
    const tasks: Task[] = [];
    for (const col of ['todo', 'progress', 'done'] as Column[]) {
      const files = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap(e => {
        const file = inside(this.board, join(p, e.name));
        return e.isDirectory() ? files(file) : e.isFile() && /\.md$/i.test(e.name) && !/^(README|AGENTS)\.md$/i.test(e.name) ? [file] : [];
      });
      for (const file of files(this.paths[col])) {
        const fm = frontmatter(readFileSync(file, 'utf8')); const f = this.fields;
        const id = scalar(fm.values.get(f.id), f.id), status = scalar(fm.values.get(f.status), f.status);
        const deps = this.config.dependencies?.[id] ?? dependencies(fm.values.get(f.dependencies), f.dependencies);
        if (!Array.isArray(deps) || deps.some(x => typeof x !== 'string')) fail(`Invalid dependency override: ${id}`);
        const ownerRaw = fm.values.get(f.owner);
        tasks.push({ id, column: col, file, status, dependencies: deps, owner: ownerRaw && ownerRaw !== 'null' ? scalar(ownerRaw, f.owner) : undefined,
          title: fm.values.has('title') ? scalar(fm.values.get('title'), 'title') : basename(file) });
      }
    }
    return tasks.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }
  validate() {
    const tasks = this.tasks(), errors: string[] = [], map = new Map<string, Task>();
    for (const t of tasks) {
      if (map.has(t.id)) errors.push(`Duplicate ID ${t.id}`); map.set(t.id, t);
      if (t.status !== this.statuses[t.column]) errors.push(`${t.id}: status ${t.status} does not match ${this.statuses[t.column]}`);
    }
    for (const t of tasks) for (const dep of t.dependencies) {
      if (!map.has(dep)) errors.push(`${t.id}: missing dependency ${dep}`);
      else if (t.column !== 'todo' && map.get(dep)!.column !== 'done') errors.push(`${t.id}: dependency ${dep} is not Done`);
    }
    const active = new Set<string>(), seen = new Set<string>();
    const visit = (id: string, chain: string[]) => {
      if (active.has(id)) { errors.push(`Dependency cycle: ${[...chain, id].join(' -> ')}`); return; }
      if (seen.has(id) || !map.has(id)) return;
      active.add(id); for (const dep of map.get(id)!.dependencies) visit(dep, [...chain, id]);
      active.delete(id); seen.add(id);
    };
    for (const t of tasks) visit(t.id, []);
    return { tasks, errors };
  }
  valid() { const result = this.validate(); if (result.errors.length) fail(result.errors.join('\n')); return result.tasks; }
  task(id: string) { const t = this.valid().find(t => t.id === id); return t || fail(`Unknown ID: ${id}`); }
  commands(commands: string[][] | undefined, id = '', file = '') {
    if (commands?.length && !this.allowProjectCommands) fail('Project-defined commands are disabled. Review all configuration/evidence commands, then explicitly pass --allow-project-commands.');
    return (commands || []).map(argv => run(this.root, argv.map(s => s.replaceAll('{id}', id).replaceAll('{file}', file))));
  }
  external(id = '', file = '', done = false) {
    const results = this.commands(this.config.validate, id, file);
    if (done) results.push(...this.commands(this.config.requireDone, id, file));
    return results;
  }
  lock<T>(action: () => T): T {
    const path = join(this.board, '.loop-pbi-lock');
    try { mkdirSync(path); } catch { fail(`Board locked: ${path}. Inspect owner and active processes; do not remove an active lock.`); }
    try { writeFileSync(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return action(); }
    finally { if (existsSync(join(path, 'owner.json'))) unlinkSync(join(path, 'owner.json')); rmdirSync(path); }
  }
  transition(id: string, target: Column, change: Record<string, string | null>, verify: (file: string) => unknown) {
    return this.lock(() => {
      const t = this.task(id), original = readFileSync(t.file, 'utf8');
      const dest = inside(this.board, join(this.paths[target], relative(this.paths[t.column], t.file)));
      if (existsSync(dest)) fail(`Destination already exists: ${dest}`);
      this.external(id, t.file);
      mkdirSync(dirname(dest), { recursive: true });
      atomicWrite(t.file, update(original, { ...change, [this.fields.status]: this.statuses[target] }));
      try { renameSync(t.file, dest); } catch (err) { atomicWrite(t.file, original); throw err; }
      try {
        if (existsSync(t.file) || !existsSync(dest)) fail('Physical transition failed');
        this.valid(); const result = verify(dest);
        return { id, from: t.file, to: dest, result };
      } catch (err) {
        // Preserve any new body/evidence written by afterMove, but restore lifecycle metadata.
        const current = frontmatter(readFileSync(dest, 'utf8')), before = frontmatter(original);
        atomicWrite(dest, `---${before.newline}${before.head}${before.newline}---${before.newline}${current.body}`);
        if (existsSync(t.file)) fail(`Rollback collision; inspect ${dest} and ${t.file}. Original error: ${err}`);
        renameSync(dest, t.file); throw err;
      }
    });
  }
}

function parse(argv: string[]) {
  const opts: Record<string, string> = {}, args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (key === 'help' || key === 'allow-project-commands') { opts[key] = 'true'; continue; }
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`Missing value for --${key}`);
      if (opts[key]) fail(`Repeated option --${key}`); opts[key] = argv[++i];
    } else args.push(argv[i]);
  }
  const known = ['root', 'config', 'board', 'agent', 'evidence', 'base', 'limit', 'help', 'allow-project-commands'];
  for (const key of Object.keys(opts)) if (!known.includes(key)) fail(`Unknown option --${key}`);
  return { opts, args };
}
const help = `loop-pbi: Bun-only CLI (Git required for worktrees/history)
Usage: bun loop-pbi.ts COMMAND [ID] --root PROJECT [--config FILE] [--board PATH]
Read-only: scan | ready | validate | history [ID] [--limit 50] | worktree list
Mutations: claim ID --agent NAME | finish ID --evidence JSON_FILE
           worktree create ASSIGNMENT [--base COMMIT] | worktree remove ASSIGNMENT
Config: optional PROJECT/.loop-pbi.json. See references/cli.md.
Project-defined commands require review and explicit --allow-project-commands; no validator scripts are autodetected.
claim = reservation + metadata + physical To Do -> In Progress (no separate claim database).
finish executes evidence checks and project validators, then moves physically to Done.
worktree create uses .worktrees/ASSIGNMENT for one agent with one or more PBIs, from committed HEAD.
It adds .worktrees/* to .gitignore and never commits/pushes.
No command auto-stages, commits, pushes, removes dirty worktrees, or bypasses validators.`;

export function main(argv: string[]) {
  const { opts, args } = parse(argv);
  if (!args.length || opts.help) return { help };
  const requested = resolve(opts.root || process.cwd());
  if (!existsSync(requested)) fail(`Root does not exist: ${requested}`);
  // Keep requested project scope; do not silently ascend and process another project's board.
  const root = realpathSync(requested), command = args[0];
  const configFile = inside(root, opts.config || '.loop-pbi.json');
  if (opts.config && !existsSync(configFile)) fail(`Config missing: ${configFile}`);
  const config: Config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const allowed = ['board', 'columns', 'fields', 'statuses', 'dependencies', 'validate', 'requireDone', 'afterMove'];
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(k => !allowed.includes(k))) fail('Invalid or unknown configuration keys');
  for (const k of ['validate', 'requireDone', 'afterMove'] as const) {
    if (config[k] && (!Array.isArray(config[k]) || config[k]!.some(a => !Array.isArray(a) || !a.length || a.some(s => typeof s !== 'string')))) fail(`Invalid command arrays: ${k}`);
  }
  if (config.validate && !config.validate.length) fail('validate must not be empty; do not disable project validators');
  for (const [key, supported] of [['columns', ['todo', 'progress', 'done']], ['statuses', ['todo', 'progress', 'done']],
      ['fields', Object.keys(fields)]] as const) {
    const value = config[key];
    if (value && (typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k, v]) => !supported.includes(k) || typeof v !== 'string' || !v.trim())))
      fail(`Invalid configuration: ${key}`);
  }
  if (config.fields && Object.values(config.fields).some(s => !/^[\w-]+$/.test(s!))) fail('Field names must be simple YAML keys');
  if (command === 'history') {
    const id = args[1]; const limit = Number(opts.limit || 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) fail('limit must be 1..10000');
    const format = '%H%x00%aI%x00%an%x00%s%x00%b%x00';
    // Structured trailers are the lookup key; no regex injection from IDs.
    const output = git(root, 'log', `--format=${format}`, ...(id ? ['--fixed-strings', `--grep=PBI: ${id}`] : [`-n${limit}`]));
    const chunks = output.split('\0'), commits: unknown[] = [];
    for (let i = 0; i + 4 < chunks.length; i += 5) {
      const [hash, date, author, subject, body] = chunks.slice(i, i + 5);
      if (!id || body.split('\n').some(line => line === `PBI: ${id}`)) commits.push({ hash: hash.trim(), date, author, subject, body });
      if (commits.length === limit) break;
    }
    return { commits };
  }
  if (command === 'worktree') {
    const repo = realpathSync(git(root, 'rev-parse', '--show-toplevel'));
    if (repo !== root) fail('Use the Git repository/worktree root for worktree commands');
    if (args[1] === 'list') return { worktrees: git(root, 'worktree', 'list', '--porcelain') };
    const assignment = args[2];
    if (!assignment || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(assignment)) fail('Assignment name must contain only letters, digits, dots, underscores, hyphens');
    let p = inside(root, `.worktrees/${assignment}`);
    const branch = `loop-pbi/${assignment}`;
    // Older CLI versions used pbi-ID. Do not strand existing clean worktrees on upgrade.
    const legacy = inside(root, `.worktrees/pbi-${assignment}`);
    if (args[1] === 'remove' && !existsSync(p) && existsSync(legacy)) p = legacy;
    if (args[1] === 'create') {
      if (existsSync(p)) fail(`Worktree already exists: ${p}; inspect and reuse explicitly`);
      if (existsSync(legacy)) fail(`Legacy worktree already exists: ${legacy}; inspect before creating a new assignment`);
      if (run(root, ['git', 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], true).exitCode === 0) fail(`Branch already exists: ${branch}`);
      const base = git(root, 'rev-parse', '--verify', '--end-of-options', `${opts.base || 'HEAD'}^{commit}`);
      const ignore = join(root, '.gitignore'); inside(root, '.gitignore');
      const old = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
      if (!old.split(/\r?\n/).includes('.worktrees/*')) atomicWrite(ignore, old + (old && !old.endsWith('\n') ? '\n' : '') + '.worktrees/*\n');
      // Negation rules could defeat the entry. Check the actual proposed path before creation.
      if (run(root, ['git', 'check-ignore', '-q', relative(root, p)], true).exitCode !== 0) fail('Worktree path is not ignored; inspect .gitignore rules');
      mkdirSync(dirname(p), { recursive: true });
      git(root, 'worktree', 'add', '-b', branch, p, base);
      return { assignment, path: p, branch, base, warning: 'Only committed files are present. One agent may work on multiple assigned PBIs here. Set child tool cwd explicitly; inherited thread binding is unchanged.' };
    }
    if (args[1] === 'remove') {
      if (!existsSync(p)) fail(`Missing worktree: ${p}`);
      const listed = git(root, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => resolve(l.slice(9)));
      if (!listed.some(l => realpathSync(l) === realpathSync(p))) fail('Path is not a registered worktree of this repository');
      if (git(p, 'status', '--porcelain', '--untracked-files=all')) fail('Refusing to remove a dirty worktree');
      const primaryHead = git(root, 'rev-parse', 'HEAD');
      if (run(p, ['git', 'merge-base', '--is-ancestor', 'HEAD', primaryHead], true).exitCode !== 0) fail('Refusing to remove worktree whose HEAD is not integrated into the parent HEAD');
      git(root, 'worktree', 'remove', p); return { removed: p, retainedBranch: branch };
    }
    fail('Use worktree create ASSIGNMENT, list, or remove ASSIGNMENT');
  }
  const board = new Board(root, config, opts.board, opts['allow-project-commands'] === 'true');
  if (command === 'scan') return { root, board: board.board, columns: board.paths, ...board.validate() };
  if (command === 'validate') {
    const tasks = board.valid(); const checks = board.external(); return { valid: true, count: tasks.length, checks };
  }
  if (command === 'ready') {
    const tasks = board.valid(), done = new Set(tasks.filter(t => t.column === 'done').map(t => t.id));
    return { ready: tasks.filter(t => t.column === 'todo' && t.dependencies.every(d => done.has(d))), inProgress: tasks.filter(t => t.column === 'progress') };
  }
  const id = args[1]; if (!id) fail('Task ID required');
  if (command === 'claim') {
    if (!opts.agent) fail('--agent is required');
    const t = board.task(id); if (t.column !== 'todo') fail(`Task ${id} is already ${t.column}; inspect existing owner before resuming`);
    const done = new Set(board.valid().filter(t => t.column === 'done').map(t => t.id));
    if (!t.dependencies.every(d => done.has(d))) fail(`Unfinished dependencies: ${t.dependencies.filter(d => !done.has(d)).join(', ')}`);
    return board.transition(id, 'progress', { [board.fields.owner]: opts.agent, [board.fields.started]: new Date().toISOString(), [board.fields.completed]: null }, file => board.external(id, file));
  }
  if (command === 'finish') {
    const t = board.task(id); if (t.column !== 'progress') fail('finish requires In Progress');
    if (!opts.evidence) fail('--evidence JSON_FILE required');
    const evidenceFile = inside(root, opts.evidence), evidence = JSON.parse(readFileSync(evidenceFile, 'utf8'));
    if (evidence.id !== id || evidence.criteriaSatisfied !== true || typeof evidence.result !== 'string' || !evidence.result.trim() ||
        typeof evidence.limitations !== 'string' || !evidence.limitations.trim() || !Array.isArray(evidence.checks) || !evidence.checks.length)
      fail('Evidence requires matching id, criteriaSatisfied:true, result, limitations, nonempty checks (argv arrays)');
    const checks = board.commands(evidence.checks, id, t.file);
    return board.transition(id, 'done', { [board.fields.completed]: new Date().toISOString() }, file => {
      const after = board.commands(config.afterMove, id, file);
      board.valid(); return { evidence: evidenceFile, checks, afterMove: after, validators: board.external(id, file, true) };
    });
  }
  fail(`Unknown command: ${command}`);
}

if (import.meta.main) {
  try { const result = main(Bun.argv.slice(2)); console.log('help' in result ? result.help : JSON.stringify(result, null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
