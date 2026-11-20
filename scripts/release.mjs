#!/usr/bin/env node
// Bump version + tạo commit/tag phát hành. Không có dependency ngoài Node.
//
//   pnpm release <patch|minor|major|x.y.z[-pre]> [--dry-run] [--allow-branch <tên>]
//   pnpm release --check [x.y.z]     kiểm 3 file version khớp nhau (và khớp x.y.z nếu có)
//
// Không bao giờ push. Chỉ in lệnh push gợi ý.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  tauri: join(ROOT, 'src-tauri/tauri.conf.json'),
  pkg: join(ROOT, 'package.json'),
  cargo: join(ROOT, 'Cargo.toml'),
};
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
// Releases are cut from main only (the release workflow refuses tags elsewhere).
const DEFAULT_BRANCHES = ['main'];

const die = (msg) => {
  console.error(`Lỗi: ${msg}`);
  process.exit(1);
};

// ---- đọc / ghi version ----------------------------------------------------------------------

const JSON_VERSION = /^(\s*"version"\s*:\s*")([^"]*)(")/m; // "version" đầu tiên = cấp cao nhất

function cargoSection(text) {
  const start = text.search(/^\[workspace\.package\]\s*$/m);
  if (start < 0) die('Cargo.toml: không thấy [workspace.package].');
  const rest = text.slice(start + 1);
  const next = rest.search(/^\[/m);
  return { start, end: next < 0 ? text.length : start + 1 + next };
}

function readVersions() {
  const json = (f) => {
    const m = readFileSync(f, 'utf8').match(JSON_VERSION);
    return m ? m[2] : null;
  };
  const ctext = readFileSync(FILES.cargo, 'utf8');
  const { start, end } = cargoSection(ctext);
  const cm = ctext.slice(start, end).match(/^version\s*=\s*"([^"]*)"/m);
  return {
    'src-tauri/tauri.conf.json': json(FILES.tauri),
    'package.json': json(FILES.pkg),
    'Cargo.toml [workspace.package]': cm ? cm[1] : null,
  };
}

function writeVersions(next) {
  const out = {};
  for (const key of ['tauri', 'pkg']) {
    const t = readFileSync(FILES[key], 'utf8');
    if (!JSON_VERSION.test(t)) die(`${FILES[key]}: không thấy "version".`);
    out[FILES[key]] = t.replace(JSON_VERSION, `$1${next}$3`);
  }
  const ct = readFileSync(FILES.cargo, 'utf8');
  const { start, end } = cargoSection(ct);
  const sec = ct.slice(start, end).replace(/^(version\s*=\s*")[^"]*(")/m, `$1${next}$2`);
  out[FILES.cargo] = ct.slice(0, start) + sec + ct.slice(end);
  // Dependency nội bộ khai báo `version = "x" , path = ...` cũng phải theo version mới,
  // nếu không cargo không chọn được phiên bản.
  for (const f of pathDepManifests()) {
    const t = readFileSync(f, 'utf8');
    const re = /^(mailstudio-[\w-]+\s*=\s*\{[^}\n]*\bversion\s*=\s*")[^"]*("[^}\n]*\bpath\s*=)/gm;
    const re2 = /^(mailstudio-[\w-]+\s*=\s*\{[^}\n]*\bpath\s*=[^}\n]*\bversion\s*=\s*")[^"]*(")/gm;
    const u = t.replace(re, `$1${next}$2`).replace(re2, `$1${next}$2`);
    if (u !== t) out[f] = u;
  }
  return out;
}

function pathDepManifests() {
  return run('git', ['ls-files', '*Cargo.toml'])
    .out.split('\n')
    .filter((f) => f && f !== 'Cargo.toml' && !f.startsWith('vendor/'))
    .map((f) => join(ROOT, f));
}

function checkVersions(expected) {
  const v = readVersions();
  const values = Object.values(v);
  const missing = Object.entries(v).filter(([, x]) => !x);
  if (missing.length) die(`không đọc được version ở: ${missing.map(([k]) => k).join(', ')}`);
  const same = values.every((x) => x === values[0]);
  const matches = !expected || values.every((x) => x === expected);
  if (same && matches) {
    console.log(`Version khớp nhau ở cả 3 file: ${values[0]}`);
    return;
  }
  console.error('Version KHÔNG khớp:');
  for (const [k, x] of Object.entries(v)) console.error(`  ${k.padEnd(34)} ${x}`);
  if (expected) console.error(`  ${'(mong đợi)'.padEnd(34)} ${expected}`);
  console.error('Sửa bằng `pnpm release x.y.z` hoặc chỉnh tay cho cả 3 file về cùng một version.');
  process.exit(1);
}

function nextVersion(current, arg) {
  const m = current.match(SEMVER);
  if (!m) die(`version hiện tại "${current}" không phải semver.`);
  let [major, minor, patch] = [+m[1], +m[2], +m[3]];
  if (arg === 'major') return `${major + 1}.0.0`;
  if (arg === 'minor') return `${major}.${minor + 1}.0`;
  if (arg === 'patch') return `${major}.${minor}.${m[4] ? patch : patch + 1}`; // 1.2.3-rc.1 -> 1.2.3
  if (!SEMVER.test(arg)) die(`"${arg}" không phải patch|minor|major hay x.y.z[-pre] hợp lệ.`);
  return arg;
}

// ---- git / cargo ----------------------------------------------------------------------------

const ENV = {
  ...process.env,
  // cargo có thể không nằm trên PATH (rustup qua Homebrew): thử thêm thư mục toolchain mặc định.
  PATH: [
    process.env.PATH,
    join(homedir(), '.cargo/bin'),
    ...(existsSync(join(homedir(), '.rustup/toolchains'))
      ? readdirSync(join(homedir(), '.rustup/toolchains'))
          .filter((d) => d.startsWith('stable'))
          .map((d) => join(homedir(), '.rustup/toolchains', d, 'bin'))
      : []),
  ].join(':'),
};
function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: ENV });
  if (r.error) {
    if (allowFail)
      return {
        ok: false,
        out: '',
        err: String(r.error.message),
        missing: r.error.code === 'ENOENT',
      };
    die(`không chạy được ${cmd}: ${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) die(`${cmd} ${args.join(' ')} lỗi:\n${r.stderr || r.stdout}`);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const git = (...a) => run('git', a).out;

function buildChangelogSection(version) {
  const prev = run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*.*.*'], {
    allowFail: true,
  });
  const prevTag = prev.ok && prev.out ? prev.out : null;
  const range = prevTag ? [`${prevTag}..HEAD`] : ['HEAD'];
  const log = git('log', '--no-merges', '--pretty=format:%s (%h)', ...range);
  const lines = log ? log.split('\n').map((l) => `- ${l}`) : ['- (không có thay đổi mới)'];
  const date = new Date().toISOString().slice(0, 10);
  const head = `## v${version} - ${date}`;
  const from = prevTag ? `Thay đổi từ ${prevTag}.` : 'Phát hành đầu tiên.';
  return { prevTag, text: `${head}\n\n${from}\n\n${lines.join('\n')}\n` };
}

function insertChangelog(section) {
  const header =
    '# Changelog\n\nCác thay đổi đáng chú ý của MailStudio. File này do `pnpm release` cập nhật.\n\n';
  if (!existsSync(CHANGELOG)) return header + section + '\n';
  const t = readFileSync(CHANGELOG, 'utf8');
  const idx = t.search(/^## /m);
  if (idx < 0) return t.replace(/\s*$/, '\n\n') + section + '\n';
  return t.slice(0, idx) + section + '\n' + t.slice(idx);
}

// ---- main -----------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { dryRun: false, check: false, branches: [...DEFAULT_BRANCHES] };
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--check') flags.check = true;
  else if (a === '--allow-branch') {
    const b = argv[++i];
    if (!b) die('--allow-branch cần tên nhánh.');
    flags.branches.push(b);
  } else if (a.startsWith('--allow-branch=')) flags.branches.push(a.slice(15));
  else if (a === '-h' || a === '--help') {
    console.log(
      'Dùng: pnpm release <patch|minor|major|x.y.z[-pre]> [--dry-run] [--allow-branch <tên>]\n' +
        '      pnpm release --check [x.y.z]',
    );
    process.exit(0);
  } else if (a.startsWith('-')) die(`cờ không hợp lệ: ${a}`);
  else pos.push(a);
}

if (flags.check) {
  checkVersions(pos[0] ? pos[0].replace(/^v/, '') : undefined);
  process.exit(0);
}
if (pos.length !== 1) die('thiếu tham số: patch | minor | major | x.y.z[-pre]. Xem --help.');

// Chỉ tính file đã theo dõi: file untracked không ảnh hưởng commit phát hành.
if (git('status', '--porcelain', '--untracked-files=no')) {
  die('working tree có thay đổi chưa commit. Commit hoặc stash trước khi phát hành.');
}
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (!flags.branches.includes(branch)) {
  die(
    `đang ở nhánh "${branch}", không phải nhánh phát hành (${flags.branches.join(', ')}). Dùng --allow-branch ${branch} nếu cố ý.`,
  );
}

const cur = readVersions();
const curVals = new Set(Object.values(cur));
if (curVals.size !== 1) {
  checkVersions(); // in chi tiết và thoát
}
const current = [...curVals][0];
const next = nextVersion(current, pos[0]);
const tag = `v${next}`;
if (next === current) die(`version mới trùng version hiện tại (${current}).`);
if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFail: true }).ok) {
  die(`tag ${tag} đã tồn tại.`);
}

const files = writeVersions(next);
const section = buildChangelogSection(next);
const changelogNew = insertChangelog(section.text);

console.log(
  `${flags.dryRun ? '[dry-run] ' : ''}Phát hành ${current} -> ${next} (tag ${tag}, nhánh ${branch})`,
);
for (const f of Object.keys(files))
  console.log(`  sửa  ${f.replace(ROOT + '/', '')}: version ${current} -> ${next}`);
console.log(
  `  ${existsSync(CHANGELOG) ? 'sửa ' : 'tạo '} CHANGELOG.md (từ ${section.prevTag ?? 'đầu lịch sử'}):\n`,
);
console.log(section.text.replace(/^/gm, '    '));
console.log('  chạy cargo update -w --offline để cập nhật Cargo.lock');
console.log(`  commit "chore(release): ${tag}" và tạo tag annotated ${tag}`);

if (flags.dryRun) {
  console.log('\n[dry-run] chưa ghi gì.');
  process.exit(0);
}

for (const [f, text] of Object.entries(files)) writeFileSync(f, text);
writeFileSync(CHANGELOG, changelogNew);

const toAdd = [...Object.keys(files).map((f) => f.replace(ROOT + '/', '')), 'CHANGELOG.md'];
const lock = run('cargo', ['update', '-w', '--offline'], { allowFail: true });
if (lock.ok) toAdd.push('Cargo.lock');
else {
  console.warn(
    `\nCẢNH BÁO: không cập nhật được Cargo.lock (${lock.missing ? 'không có cargo trên PATH' : lock.err.split('\n')[0]}).\n` +
      'Chạy `cargo update -w --offline` rồi `git commit --amend --no-edit` (tag cần tạo lại) trước khi push.',
  );
}

git('add', ...toAdd);
git('commit', '-m', `chore(release): ${tag}`);
git('tag', '-a', tag, '-m', `MailStudio ${tag}`);

console.log(`\nĐã tạo commit "chore(release): ${tag}" và tag ${tag}. CHƯA push. Để phát hành:`);
console.log(`  git push origin ${branch}`);
console.log(`  git push origin ${tag}`);
