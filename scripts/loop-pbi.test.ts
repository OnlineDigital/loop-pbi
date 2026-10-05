import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { main } from './loop-pbi';

const roots: string[] = [];
const bin = process.execPath;
const call = (root: string, ...args: string[]) => main([...args, '--root', root]) as any;
function fixture(names = ['todo', 'in-progress', 'done']) {
  const root = mkdtempSync(join(tmpdir(), 'loop-pbi-test-')); roots.push(root);
  const board = join(root, 'pbis');
  for (const name of names) mkdirSync(join(board, name), { recursive: true });
  return { root, board, names };
}
function task(f: ReturnType<typeof fixture>, id: string, col = 0, deps: string[] = []) {
  const p = join(f.board, f.names[col], `${id}-task.md`);
  writeFileSync(p, `---\nid: "${id}"\nstatus: "${f.names[col]}"\ndepends_on: ${JSON.stringify(deps)}\nowner: null\nstarted_at: null\ncompleted_at: null\n---\n\n# Task ${id}\n`);
  return p;
}
function evidence(root: string, id: string, code = 'process.exit(0)') {
  const file = join(root, 'evidence.json');
  writeFileSync(file, JSON.stringify({ id, criteriaSatisfied: true, result: 'Implemented and reviewed', limitations: 'None', checks: [[bin, '-e', code]] }));
  return file;
}
function git(root: string, ...args: string[]) {
  const r = Bun.spawnSync(['git', '-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.invalid', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim();
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    // Every root is created by mkdtemp for this test; never touch the live project.
    if (existsSync(join(root, '.git'))) { try { git(root, 'worktree', 'prune'); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
});

test('discovers both folder conventions, prerequisites gate readiness and claim includes physical move', () => {
  for (const names of [['todo', 'in-progress', 'done'], ['To Do', 'In Progress', 'Done']]) {
    const f = fixture(names); const source = task(f, '001'); task(f, '002', 0, ['001']);
    expect(call(f.root, 'ready').ready.map((t: any) => t.id)).toEqual(['001']);
    expect(() => call(f.root, 'claim', '002', '--agent', 'a')).toThrow('Unfinished dependencies');
    call(f.root, 'claim', '001', '--agent', 'agent-a');
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(f.board, names[1], '001-task.md'), 'utf8')).toContain('owner: "agent-a"');
    expect(() => call(f.root, 'claim', '001', '--agent', 'agent-b')).toThrow('already progress');
    call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001'));
    expect(existsSync(join(f.board, names[2], '001-task.md'))).toBe(true);
    expect(call(f.root, 'ready').ready.map((t: any) => t.id)).toEqual(['002']);
  }
});

test('refuses missing dependencies, cycles, duplicate IDs and unknown dependency syntax', () => {
  const f = fixture(); const p = task(f, '001', 0, ['002']);
  expect(() => call(f.root, 'ready')).toThrow('missing dependency');
  task(f, '002', 0, ['001']); expect(() => call(f.root, 'ready')).toThrow('cycle');
  task(f, '002', 0); task(f, '001', 2);
  expect(() => call(f.root, 'validate')).toThrow('Duplicate ID');
  rmSync(join(f.board, f.names[2], '001-task.md'));
  writeFileSync(p, readFileSync(p, 'utf8').replace('depends_on: ["002"]', 'depends_on:\n  - "002"'));
  expect(() => call(f.root, 'ready')).toThrow('Unsupported');
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ dependencies: { '001': ['002'] } }));
  expect(call(f.root, 'ready').ready.map((t: any) => t.id)).toEqual(['002']);
});

test('failed implementation check and failed Done validator leave task in Progress', () => {
  const f = fixture(); task(f, '001'); call(f.root, 'claim', '001', '--agent', 'a');
  expect(() => call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001', 'process.exit(3)'))).toThrow('Command failed');
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ requireDone: [[bin, '-e', 'process.exit(7)']] }));
  expect(() => call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001'))).toThrow('Command failed');
  const progress = join(f.board, f.names[1], '001-task.md');
  expect(existsSync(progress)).toBe(true);
  expect(existsSync(join(f.board, f.names[2], '001-task.md'))).toBe(false);
  expect(readFileSync(progress, 'utf8')).toContain('completed_at: null');
  expect(existsSync(join(f.board, '.loop-pbi-lock'))).toBe(false);
});

test('board lock blocks claim without changing the task and destination is not overwritten', () => {
  const f = fixture(); const source = task(f, '001');
  mkdirSync(join(f.board, '.loop-pbi-lock'));
  expect(() => call(f.root, 'claim', '001', '--agent', 'a')).toThrow('Board locked');
  expect(existsSync(source)).toBe(true);
  rmSync(join(f.board, '.loop-pbi-lock'), { recursive: true });
  task(f, '001', 1);
  expect(() => call(f.root, 'claim', '001', '--agent', 'a')).toThrow('Duplicate ID');
});

test('config maps arbitrary columns and fields; ambiguous discovery requires a choice', () => {
  const f = fixture(['pending', 'active', 'completed']); const p = task(f, 'abc');
  writeFileSync(p, readFileSync(p, 'utf8').replace('id:', 'ticket:').replace('depends_on:', 'requires:'));
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ board: 'pbis', columns: { todo: 'pending', progress: 'active', done: 'completed' }, fields: { id: 'ticket', dependencies: 'requires' } }));
  expect(call(f.root, 'ready').ready[0].id).toBe('abc');
  const g = fixture(); task(g, '001');
  for (const col of g.names) mkdirSync(join(g.root, 'other', col), { recursive: true });
  expect(() => call(g.root, 'scan')).toThrow('found 2');
  expect(call(g.root, 'ready', '--board', 'pbis').ready.length).toBe(1);
  expect(() => call(g.root, 'scan', '--board', '..')).toThrow('escapes root');
});

test('worktree lifecycle uses ignored subfolder, preserves branches and rejects dirty/unintegrated removal', () => {
  const f = fixture(); task(f, '001'); git(f.root, 'init'); git(f.root, 'add', 'pbis'); git(f.root, 'commit', '-m', 'Bootstrap');
  const info = call(f.root, 'worktree', 'create', '001');
  expect(readFileSync(join(f.root, '.gitignore'), 'utf8')).toContain('.worktrees/*');
  expect(info.base).toBe(git(f.root, 'rev-parse', 'HEAD'));
  writeFileSync(join(info.path, 'new.txt'), 'new');
  expect(() => call(f.root, 'worktree', 'remove', '001')).toThrow('dirty');
  git(info.path, 'add', 'new.txt'); git(info.path, 'commit', '-m', 'feat: implement thing\n\nPBI: 001\nPBI-Checks: bun test (PASS)');
  expect(() => call(f.root, 'worktree', 'remove', '001')).toThrow('not integrated');
  git(f.root, 'merge', '--ff-only', info.branch);
  expect(call(f.root, 'history', '001').commits.length).toBe(1);
  expect(call(f.root, 'history', '999').commits.length).toBe(0);
  call(f.root, 'worktree', 'remove', '001');
  expect(existsSync(info.path)).toBe(false);
  expect(git(f.root, 'branch', '--list', 'loop-pbi/001')).toContain('loop-pbi/001');
});

test('concurrent CLI processes cannot both claim one PBI', async () => {
  const f = fixture(); task(f, '001');
  const cli = join(import.meta.dir, 'loop-pbi.ts');
  const agents = ['a', 'b'].map(agent => Bun.spawn([bin, cli, 'claim', '001', '--agent', agent, '--root', f.root], { stdout: 'pipe', stderr: 'pipe' }));
  const codes = await Promise.all(agents.map(p => p.exited));
  expect(codes.filter(c => c === 0)).toHaveLength(1);
  expect(call(f.root, 'scan').tasks[0].column).toBe('progress');
});

test('Done hooks receive exact paths and failed post-move check preserves new evidence during rollback', () => {
  const f = fixture(['To Do', 'In Progress', 'Done']); task(f, '001'); call(f.root, 'claim', '001', '--agent', 'a');
  writeFileSync(join(f.root, 'hook.ts'), `import { appendFileSync } from 'node:fs'; appendFileSync(Bun.argv[2], '\\nEvidence captured after move\\n');`);
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ afterMove: [[bin, 'hook.ts', '{file}']], requireDone: [[bin, '-e', 'process.exit(4)']] }));
  expect(() => call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001'))).toThrow('Command failed');
  const text = readFileSync(join(f.board, 'In Progress', '001-task.md'), 'utf8');
  expect(text).toContain('Evidence captured after move'); expect(text).toContain('status: "In Progress"');
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ requireDone: [[bin, '-e', 'if(Bun.argv[1] !== "001" || !Bun.argv[2].includes("Done")) process.exit(5)', '{id}', '{file}']] }));
  call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001'));
  expect(call(f.root, 'ready').inProgress).toHaveLength(0);
});

test('refuses path traversal, junction escape and empty validator bypass', () => {
  const f = fixture(); task(f, '001');
  expect(() => call(f.root, 'worktree', 'create', '../escape')).toThrow();
  writeFileSync(join(f.root, '.loop-pbi.json'), JSON.stringify({ validate: [] }));
  expect(() => call(f.root, 'validate')).toThrow('must not be empty');
  rmSync(join(f.root, '.loop-pbi.json'));
  const outside = fixture(); task(outside, '003');
  symlinkSync(outside.board, join(f.root, 'linked-board'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => call(f.root, 'scan', '--board', 'linked-board')).toThrow('Symlink escapes');
});

test('discovery ignores hidden validation copies without hiding an explicitly selected board', () => {
  const f = fixture(); task(f, '001');
  for (const col of f.names) mkdirSync(join(f.root, '.pbi-validation-index', 'pbis', col), { recursive: true });
  expect(call(f.root, 'scan').tasks).toHaveLength(1);
  expect(call(f.root, 'scan', '--board', '.pbi-validation-index/pbis').tasks).toHaveLength(0);
});

test('one assignment worktree hosts two PBIs with independent integration, Done transitions and history', () => {
  const f = fixture(); task(f, '001'); task(f, '002');
  git(f.root, 'init'); git(f.root, 'add', 'pbis'); git(f.root, 'commit', '-m', 'Bootstrap');
  const assignment = 'vehicles-lite-01';
  const info = call(f.root, 'worktree', 'create', assignment);
  expect(info.assignment).toBe(assignment);
  expect(info.path).toBe(join(f.root, '.worktrees', assignment));
  for (const id of ['001', '002']) call(f.root, 'claim', id, '--agent', assignment);
  writeFileSync(join(info.path, 'one.txt'), 'PBI 001');
  git(info.path, 'add', 'one.txt'); git(info.path, 'commit', '-m', 'feat: first PBI\n\nPBI: 001\nPBI-Phase: implementation');
  const first = git(info.path, 'rev-parse', 'HEAD');
  writeFileSync(join(info.path, 'two.txt'), 'PBI 002');
  git(info.path, 'add', 'two.txt'); git(info.path, 'commit', '-m', 'feat: second PBI\n\nPBI: 002\nPBI-Phase: implementation');
  git(f.root, 'merge', '--ff-only', first);
  call(f.root, 'finish', '001', '--evidence', evidence(f.root, '001'));
  expect(call(f.root, 'scan').tasks.map((t: any) => t.column)).toEqual(['done', 'progress']);
  expect(() => call(f.root, 'worktree', 'remove', assignment)).toThrow('not integrated');
  git(f.root, 'add', 'pbis'); git(f.root, 'commit', '-m', 'Complete first PBI\n\nPBI: 001\nPBI-Phase: integration');
  git(f.root, 'merge', '--no-edit', info.branch);
  call(f.root, 'finish', '002', '--evidence', evidence(f.root, '002'));
  expect(call(f.root, 'scan').tasks.map((t: any) => t.column)).toEqual(['done', 'done']);
  expect(call(f.root, 'history', '001').commits).toHaveLength(2);
  expect(call(f.root, 'history', '002').commits).toHaveLength(1);
  call(f.root, 'worktree', 'remove', assignment);
  expect(existsSync(info.path)).toBe(false);
});

test('old pbi-ID worktrees remain removable after upgrade without creating duplicates', () => {
  const f = fixture(); task(f, '001'); git(f.root, 'init'); git(f.root, 'add', 'pbis'); git(f.root, 'commit', '-m', 'Bootstrap');
  const old = join(f.root, '.worktrees', 'pbi-001');
  git(f.root, 'worktree', 'add', '-b', 'loop-pbi/001', old);
  expect(() => call(f.root, 'worktree', 'create', '001')).toThrow('Legacy worktree already exists');
  call(f.root, 'worktree', 'remove', '001'); expect(existsSync(old)).toBe(false);
});
