#!/usr/bin/env node
// analyze.mjs — deterministic organization signals for the organize-modules skill.
//
// Zero dependencies; needs Node >= 18 and git on PATH. Run from anywhere inside
// the repository being analyzed:
//
//   node analyze.mjs [--scope <dir>] [--commits <n>] [--pkg-depth <n>] [--top <n>] [--json]
//
//   --scope      directory to analyze (default: current directory)
//   --commits    how much history to read (default: 1000 commits)
//   --pkg-depth  directory depth, relative to scope, that defines a "package" (default: 2)
//   --top        rows per report section (default: 15)
//   --json       emit full raw data as JSON instead of the report
//
// Sections: CONVENTION MARKERS, HOT SPOTS, PACKAGE CYCLES, CROSS-PACKAGE CO-CHANGE,
// HIDDEN COUPLING, PACKAGE COHESION, EXPORT SURFACE, DEEP IMPORTS, GRAB-BAGS, COVERAGE.
//
// The import graph is regex-extracted (JS/TS thorough; Python good; Go via go.mod;
// Java/Kotlin/Rust best-effort). COVERAGE reports how much of it resolved — when a
// native tool (madge, dependency-cruiser, go list, import-linter) is available it
// will beat this graph; the git-based sections are exact regardless of language.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve, sep, extname, basename } from 'node:path';

// ---------- options ----------

const opts = { scope: '.', commits: 1000, pkgDepth: 2, top: 15, json: false };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--scope') opts.scope = a[++i];
    else if (a[i] === '--commits') opts.commits = parseInt(a[++i], 10);
    else if (a[i] === '--pkg-depth') opts.pkgDepth = parseInt(a[++i], 10);
    else if (a[i] === '--top') opts.top = parseInt(a[++i], 10);
    else if (a[i] === '--json') opts.json = true;
    else if (a[i] === '--help' || a[i] === '-h') {
      console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 19).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else { console.error(`unknown option: ${a[i]}`); process.exit(2); }
  }
}

const THRESH = {
  commitFileCap: 25,   // commits touching more files than this are skipped (mass renames)
  coMin: 5,            // minimum co-commits for a co-change pair
  coConf: 0.3,         // co-commits / min(revisions) to flag a pair
  hiddenCoMin: 10,     // package-pair co-commits to flag hidden coupling (no import edge)
  fanInGrabbag: 8,     // file fan-in that makes a grab-bag candidate regardless of name
  cohesionMinFiles: 5, cohesionMinCommits: 10, cohesionLow: 0.25,
  maxFileBytes: 2_000_000,
};

// ---------- helpers ----------

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const posix = (p) => p.split(sep).join('/');
function normRel(p) { // normalize a joined relative path, posix separators
  const parts = [];
  for (const seg of posix(p).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (parts.length === 0 || parts[parts.length - 1] === '..') parts.push('..'); else parts.pop(); }
    else parts.push(seg);
  }
  return parts.join('/');
}

let repoRoot;
try { repoRoot = git('rev-parse --show-toplevel', process.cwd()).trim(); }
catch { console.error('not inside a git repository'); process.exit(1); }
const scopeAbs = resolve(process.cwd(), opts.scope);
if (!existsSync(scopeAbs)) { console.error(`scope does not exist: ${scopeAbs}`); process.exit(1); }
const scopeRelFromRepo = posix(relative(repoRoot, scopeAbs));
if (scopeRelFromRepo.startsWith('..')) { console.error('scope is outside the repository'); process.exit(1); }

// ---------- file inventory ----------

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'target', 'coverage', 'tmp', '__pycache__', 'venv', 'Pods', 'DerivedData']);
const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.scala', '.ex', '.exs', '.c', '.h', '.cc', '.hh', '.cpp', '.hpp', '.m', '.mm']);
const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte']);

const files = []; // { rel, abs, ext, loc }
(function walk(dir) {
  let names; try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.startsWith('.') || IGNORED_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) walk(abs);
    else if (st.isFile() && SOURCE_EXTS.has(extname(name)) && st.size <= THRESH.maxFileBytes) {
      files.push({ rel: posix(relative(scopeAbs, abs)), abs, ext: extname(name), loc: 0 });
    }
  }
})(scopeAbs);
const fileSet = new Map(files.map(f => [f.rel, f]));
const dirSet = new Set(files.map(f => dirname(f.rel)).map(d => (d === '.' ? '' : d)));

function pkgOf(rel) {
  const dir = dirname(rel);
  if (dir === '.') return '(root)';
  return dir.split('/').slice(0, opts.pkgDepth).join('/');
}

// ---------- git history: hot spots, co-change, cohesion ----------

const revs = new Map();      // rel -> commit count
const pairCount = new Map(); // 'a\x00b' -> co-commit count
const pkgAny = new Map(), pkgMulti = new Map(); // package cohesion
const scopePrefix = scopeRelFromRepo && scopeRelFromRepo !== '.' ? scopeRelFromRepo + '/' : '';
{
  const pathspec = scopeRelFromRepo && scopeRelFromRepo !== '.' ? JSON.stringify(scopeRelFromRepo) : '.';
  const raw = git(`log --no-merges -n ${opts.commits} --pretty=format:%x01%H --name-only -- ${pathspec}`, repoRoot);
  for (const block of raw.split('\x01')) {
    if (!block.trim()) continue;
    const lines = block.split('\n').filter(Boolean);
    const touched = [];
    for (const line of lines.slice(1)) {
      if (scopePrefix && !line.startsWith(scopePrefix)) continue;
      const rel = scopePrefix ? line.slice(scopePrefix.length) : line;
      if (fileSet.has(rel)) touched.push(rel);
    }
    for (const rel of touched) revs.set(rel, (revs.get(rel) || 0) + 1);
    const byPkg = new Map();
    for (const rel of touched) { const p = pkgOf(rel); byPkg.set(p, (byPkg.get(p) || 0) + 1); }
    for (const [p, n] of byPkg) { pkgAny.set(p, (pkgAny.get(p) || 0) + 1); if (n >= 2) pkgMulti.set(p, (pkgMulti.get(p) || 0) + 1); }
    if (touched.length >= 2 && touched.length <= THRESH.commitFileCap) {
      touched.sort();
      for (let i = 0; i < touched.length; i++) for (let j = i + 1; j < touched.length; j++) {
        const k = touched[i] + '\x00' + touched[j];
        pairCount.set(k, (pairCount.get(k) || 0) + 1);
      }
    }
  }
}

for (const f of files) { // LOC (also feeds hotspot score); read once, parse imports below in same pass
  try { f.content = readFileSync(f.abs, 'utf8'); f.loc = f.content.split('\n').length; } catch { f.content = ''; }
}

const hotspots = files
  .map(f => ({ rel: f.rel, revisions: revs.get(f.rel) || 0, loc: f.loc, score: (revs.get(f.rel) || 0) * f.loc }))
  .filter(h => h.revisions > 0).sort((a, b) => b.score - a.score);

// ---------- import extraction ----------

const fileEdges = new Map();      // fromRel -> Map(toRel -> [specs])
const importerSymbols = new Map(); // toRel -> Map(fromRel -> Set(symbol))
let specTotal = 0, specInternal = 0, specResolved = 0;

function addEdge(from, to, spec, symbols) {
  if (to === from) return;
  if (!fileEdges.has(from)) fileEdges.set(from, new Map());
  const m = fileEdges.get(from);
  if (!m.has(to)) m.set(to, []);
  m.get(to).push(spec);
  if (symbols && symbols.length) {
    if (!importerSymbols.has(to)) importerSymbols.set(to, new Map());
    const im = importerSymbols.get(to);
    if (!im.has(from)) im.set(from, new Set());
    for (const s of symbols) im.get(from).add(s);
  }
  specResolved++;
}

// tsconfig paths / baseUrl (best-effort, repo root and scope root)
const tsAliases = []; // { prefix, suffixWild, targets: [scope-relative prefix] }
let tsBaseUrlRel = null;
for (const dir of new Set([repoRoot, scopeAbs])) {
  const tj = join(dir, 'tsconfig.json');
  if (!existsSync(tj)) continue;
  try {
    const txt = readFileSync(tj, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
    const co = (JSON.parse(txt).compilerOptions) || {};
    const base = resolve(dir, co.baseUrl || '.');
    if (co.baseUrl) { const r = posix(relative(scopeAbs, base)); if (!r.startsWith('..')) tsBaseUrlRel = r; }
    for (const [pat, targets] of Object.entries(co.paths || {})) {
      const prefix = pat.replace(/\*$/, '');
      for (const t of targets) {
        const abs = resolve(base, t.replace(/\*$/, ''));
        const rel = posix(relative(scopeAbs, abs));
        if (!rel.startsWith('..')) tsAliases.push({ prefix, wild: pat.endsWith('*'), target: rel });
      }
    }
  } catch { /* unparseable tsconfig — skip */ }
}
tsAliases.sort((a, b) => b.prefix.length - a.prefix.length);

const JS_PROBES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.vue', '.svelte'];
function probeJs(rel) {
  for (const e of JS_PROBES) if (fileSet.has(rel + e)) return rel + e;
  for (const e of JS_PROBES.slice(1)) if (fileSet.has(rel + '/index' + e)) return rel + '/index' + e;
  return null;
}
function resolveJs(fromRel, spec) {
  if (spec.startsWith('.')) { specInternal++; return probeJs(normRel(join(dirname(fromRel), spec))); }
  for (const al of tsAliases) {
    if (spec === al.prefix.replace(/\/$/, '') || spec.startsWith(al.prefix)) {
      specInternal++;
      return probeJs(normRel(al.target + '/' + spec.slice(al.prefix.length)));
    }
  }
  if (tsBaseUrlRel !== null) {
    const t = probeJs(normRel((tsBaseUrlRel ? tsBaseUrlRel + '/' : '') + spec));
    if (t) { specInternal++; return t; }
  }
  return null; // external package
}

function parseJs(f) {
  const src = f.content;
  const R_FROM = /(import|export)\b([\s\S]{0,600}?)\bfrom\s*['"]([^'"\n]+)['"]/g;
  const R_SIDE = /(?:^|[;\n])\s*import\s*['"]([^'"\n]+)['"]/g;
  const R_REQ = /\brequire\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  const R_DYN = /\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = R_FROM.exec(src))) {
    specTotal++;
    const to = resolveJs(f.rel, m[3]);
    if (!to) continue;
    const brace = /\{([^}]*)\}/.exec(m[2]);
    const symbols = brace ? brace[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
    addEdge(f.rel, to, m[3], symbols);
  }
  for (const re of [R_SIDE, R_REQ, R_DYN]) {
    while ((m = re.exec(src))) { specTotal++; const to = resolveJs(f.rel, m[1]); if (to) addEdge(f.rel, to, m[1], []); }
  }
}

function probePy(rel) {
  if (fileSet.has(rel + '.py')) return rel + '.py';
  if (fileSet.has(rel + '/__init__.py')) return rel + '/__init__.py';
  return null;
}
const PY_ROOTS = ['', 'src/'];
function resolvePyModule(fromRel, dots, module) {
  specInternal += dots > 0 ? 1 : 0;
  if (dots > 0) {
    let base = dirname(fromRel); if (base === '.') base = '';
    for (let i = 1; i < dots; i++) base = base.includes('/') ? dirname(base) : '';
    return probePy(normRel(base + (module ? '/' + module.replace(/\./g, '/') : '')));
  }
  for (const root of PY_ROOTS) {
    const t = probePy(normRel(root + module.replace(/\./g, '/')));
    if (t) { specInternal++; return t; }
  }
  return null;
}
function parsePy(f) {
  const src = f.content;
  const R_FROM = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+([^\n]+)/gm;
  const R_IMP = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm;
  let m;
  while ((m = R_FROM.exec(src))) {
    specTotal++;
    const to = resolvePyModule(f.rel, m[1].length, m[2]);
    if (!to) continue;
    const symbols = m[3].replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(s => s && s !== '*');
    addEdge(f.rel, to, `${m[1]}${m[2]}`, symbols);
  }
  while ((m = R_IMP.exec(src))) {
    for (const mod of m[1].split(',').map(s => s.trim())) {
      specTotal++;
      const to = resolvePyModule(f.rel, 0, mod);
      if (to) addEdge(f.rel, to, mod, []);
    }
  }
}

let goModule = null;
{
  const gm = join(repoRoot, 'go.mod');
  if (existsSync(gm)) { const m = /^module\s+(\S+)/m.exec(readFileSync(gm, 'utf8')); if (m) goModule = m[1]; }
}
const dirRep = new Map(); // dir -> representative file rel
for (const f of files) { const d = dirname(f.rel) === '.' ? '' : dirname(f.rel); if (!dirRep.has(d)) dirRep.set(d, f.rel); }
function parseGo(f) {
  if (!goModule) return;
  const src = f.content;
  const specs = [];
  let m;
  const R_BLOCK = /import\s*\(([\s\S]*?)\)/g, R_ONE = /import\s+(?:\w+\s+)?"([^"]+)"/g, R_IN = /"([^"]+)"/g;
  while ((m = R_BLOCK.exec(src))) { let n; while ((n = R_IN.exec(m[1]))) specs.push(n[1]); }
  while ((m = R_ONE.exec(src))) specs.push(m[1]);
  for (const spec of specs) {
    specTotal++;
    if (spec !== goModule && !spec.startsWith(goModule + '/')) continue;
    specInternal++;
    const repoDir = spec === goModule ? '' : spec.slice(goModule.length + 1);
    const scopeDir = scopePrefix ? (repoDir.startsWith(scopePrefix) ? repoDir.slice(scopePrefix.length) : (repoDir + '/' === scopePrefix ? '' : null)) : repoDir;
    if (scopeDir === null) continue;
    const rep = dirRep.get(scopeDir);
    if (rep) addEdge(f.rel, rep, spec, []);
  }
}

const dirList = [...dirSet];
const suffixCache = new Map();
function dirBySuffix(suffix) {
  if (suffixCache.has(suffix)) return suffixCache.get(suffix);
  const hit = dirList.find(d => d === suffix || d.endsWith('/' + suffix)) ?? null;
  suffixCache.set(suffix, hit);
  return hit;
}
function parseJavaLike(f) {
  const R = /^import\s+(?:static\s+)?([\w.]+)\s*;?/gm;
  let m;
  while ((m = R.exec(f.content))) {
    specTotal++;
    const parts = m[1].split('.');
    const dir = dirBySuffix(parts.slice(0, -1).join('/'));
    if (!dir) continue;
    specInternal++;
    const rep = dirRep.get(dir);
    if (rep) addEdge(f.rel, rep, m[1], []);
  }
}
function parseRust(f) {
  const R = /^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm;
  let m;
  while ((m = R.exec(f.content))) {
    specTotal++; specInternal++;
    const segs = m[1].split('::');
    for (let n = segs.length; n >= 1; n--) {
      const p = segs.slice(0, n).join('/');
      const hit = ['src/' + p + '.rs', 'src/' + p + '/mod.rs', p + '.rs', p + '/mod.rs'].find(c => fileSet.has(c));
      if (hit) { addEdge(f.rel, hit, m[1], []); break; }
    }
  }
}

for (const f of files) {
  if (JS_EXTS.has(f.ext)) parseJs(f);
  else if (f.ext === '.py') parsePy(f);
  else if (f.ext === '.go') parseGo(f);
  else if (f.ext === '.java' || f.ext === '.kt' || f.ext === '.scala') parseJavaLike(f);
  else if (f.ext === '.rs') parseRust(f);
}

// ---------- package graph: cycles, fan-in/out ----------

const pkgEdges = new Map(); // fromPkg -> Map(toPkg -> count)
for (const [from, tos] of fileEdges) {
  const fp = pkgOf(from);
  for (const [to, specs] of tos) {
    const tp = pkgOf(to);
    if (fp === tp) continue;
    if (!pkgEdges.has(fp)) pkgEdges.set(fp, new Map());
    pkgEdges.get(fp).set(tp, (pkgEdges.get(fp).get(tp) || 0) + specs.length);
  }
}
const pkgs = new Set([...files.map(f => pkgOf(f.rel))]);
const fanOut = new Map(), fanIn = new Map();
for (const [fp, tos] of pkgEdges) { fanOut.set(fp, tos.size); for (const tp of tos.keys()) fanIn.set(tp, (fanIn.get(tp) || 0) + 1); }

function tarjanSccs() {
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  const out = []; let counter = 0;
  function strongconnect(v) {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    for (const w of (pkgEdges.get(v) || new Map()).keys()) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w; do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length >= 2) out.push(comp.sort());
    }
  }
  for (const p of pkgs) if (!index.has(p)) strongconnect(p);
  return out;
}
const cycles = tarjanSccs();

// ---------- co-change findings ----------

const coChange = [];
for (const [k, count] of pairCount) {
  if (count < THRESH.coMin) continue;
  const [a, b] = k.split('\x00');
  if (pkgOf(a) === pkgOf(b)) continue;
  const conf = count / Math.min(revs.get(a) || count, revs.get(b) || count);
  if (conf >= THRESH.coConf) coChange.push({ a, b, coCommits: count, confidence: +conf.toFixed(2) });
}
coChange.sort((x, y) => y.coCommits - x.coCommits);

const pkgCo = new Map(); // 'p\x00q' sorted -> co-commits
for (const [k, count] of pairCount) {
  const [a, b] = k.split('\x00');
  const pa = pkgOf(a), pb = pkgOf(b);
  if (pa === pb) continue;
  const key = [pa, pb].sort().join('\x00');
  pkgCo.set(key, (pkgCo.get(key) || 0) + count);
}
const hiddenCoupling = [];
for (const [key, count] of pkgCo) {
  if (count < THRESH.hiddenCoMin) continue;
  const [p, q] = key.split('\x00');
  const linked = (pkgEdges.get(p)?.has(q)) || (pkgEdges.get(q)?.has(p));
  if (!linked) hiddenCoupling.push({ a: p, b: q, coCommits: count });
}
hiddenCoupling.sort((x, y) => y.coCommits - x.coCommits);

const cohesion = [];
for (const p of pkgs) {
  const nFiles = files.filter(f => pkgOf(f.rel) === p).length;
  const any = pkgAny.get(p) || 0, multi = pkgMulti.get(p) || 0;
  if (nFiles < THRESH.cohesionMinFiles || any < THRESH.cohesionMinCommits) continue;
  cohesion.push({ pkg: p, files: nFiles, commits: any, cohesion: +(multi / any).toFixed(2) });
}
cohesion.sort((a, b) => a.cohesion - b.cohesion);

// ---------- export surface ----------

function countJsExports(src) {
  let n = 0, m;
  const R_DECL = /^export\s+(?:default\b|(?:abstract\s+)?class\b|(?:async\s+)?function\b|const\b|let\b|var\b|enum\b|interface\b|type\b|namespace\b)/gm;
  const R_BRACE = /^export\s*\{([^}]*)\}/gm;
  const R_STAR = /^export\s*\*\s*from/gm;
  while (R_DECL.exec(src)) n++;
  while ((m = R_BRACE.exec(src))) n += m[1].split(',').filter(s => s.trim()).length;
  while (R_STAR.exec(src)) n += 1;
  return n;
}
function countPyExports(src) {
  const all = /__all__\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (all) return all[1].split(',').filter(s => s.trim()).length;
  let n = 0;
  const R = /^(?:def|class)\s+([A-Za-z_]\w*)/gm;
  let m; while ((m = R.exec(src))) if (!m[1].startsWith('_')) n++;
  return n;
}
const pkgStats = new Map(); // pkg -> { files, loc, exports, hasIndex, indexRel }
for (const f of files) {
  const p = pkgOf(f.rel);
  if (!pkgStats.has(p)) pkgStats.set(p, { pkg: p, files: 0, loc: 0, exports: 0, hasIndex: false, indexRel: null });
  const s = pkgStats.get(p);
  s.files++; s.loc += f.loc;
  if (JS_EXTS.has(f.ext)) s.exports += countJsExports(f.content);
  else if (f.ext === '.py') s.exports += countPyExports(f.content);
  const isIndex = /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(basename(f.rel)) || basename(f.rel) === '__init__.py';
  if (isIndex && (dirname(f.rel) === p || (p === '(root)' && dirname(f.rel) === '.'))) { s.hasIndex = true; s.indexRel = f.rel; }
}
const surface = [...pkgStats.values()]
  .filter(s => s.files >= 2)
  .map(s => ({ ...s, exportsPerFile: +(s.exports / s.files).toFixed(1), fanIn: fanIn.get(s.pkg) || 0 }))
  .sort((a, b) => b.exports - a.exports);

// ---------- deep imports ----------

const deepImports = new Map(); // 'fromPkg -> toPkg' -> { count, samples }
for (const [from, tos] of fileEdges) {
  const fp = pkgOf(from);
  for (const [to, specs] of tos) {
    const tp = pkgOf(to);
    if (fp === tp) continue;
    const st = pkgStats.get(tp);
    const bypassesIndex = st?.hasIndex && to !== st.indexRel;
    const intoInternal = to.split('/').includes('internal') && !from.startsWith(tp + '/');
    if (!bypassesIndex && !intoInternal) continue;
    const key = `${fp} -> ${tp}`;
    if (!deepImports.has(key)) deepImports.set(key, { count: 0, samples: new Set() });
    const d = deepImports.get(key);
    d.count += specs.length;
    if (d.samples.size < 3) d.samples.add(`${from} imports ${to}`);
  }
}
const deepList = [...deepImports.entries()].map(([k, v]) => ({ edge: k, count: v.count, samples: [...v.samples] })).sort((a, b) => b.count - a.count);

// ---------- grab-bags ----------

const fileFanIn = new Map(); // toRel -> Set(fromRel)
for (const [from, tos] of fileEdges) for (const to of tos.keys()) {
  if (!fileFanIn.has(to)) fileFanIn.set(to, new Set());
  fileFanIn.get(to).add(from);
}
const GRABBAG_NAME = /^(utils?|helpers?|common|shared|misc|lib|constants|types)$/i;
const grabBags = [];
for (const f of files) {
  const importers = fileFanIn.get(f.rel);
  const fanInN = importers ? importers.size : 0;
  const nameHit = GRABBAG_NAME.test(basename(f.rel, f.ext)) || GRABBAG_NAME.test(basename(dirname(f.rel)));
  if (!(fanInN >= THRESH.fanInGrabbag || (nameHit && fanInN >= 3))) continue;
  const symMap = importerSymbols.get(f.rel);
  let disjointness = null, symbols = 0;
  if (symMap && symMap.size >= 2) {
    const sets = [...symMap.values()].filter(s => s.size > 0);
    symbols = new Set(sets.flatMap(s => [...s])).size;
    if (sets.length >= 2) {
      let sum = 0, n = 0;
      for (let i = 0; i < sets.length && n < 200; i++) for (let j = i + 1; j < sets.length && n < 200; j++) {
        const inter = [...sets[i]].filter(x => sets[j].has(x)).length;
        const union = new Set([...sets[i], ...sets[j]]).size;
        sum += union ? inter / union : 0; n++;
      }
      if (n) disjointness = +(1 - sum / n).toFixed(2);
    }
  }
  grabBags.push({ rel: f.rel, fanIn: fanInN, exportedSymbolsUsed: symbols, disjointness });
}
grabBags.sort((a, b) => b.fanIn - a.fanIn);

// ---------- convention markers ----------

const MARKERS = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'nuxt.config.ts', 'angular.json', 'remix.config.js', 'svelte.config.js', 'astro.config.mjs', 'gatsby-config.js', 'vite.config.ts', 'vite.config.js', 'Gemfile', 'config.ru', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'manage.py', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'mix.exs', 'composer.json', 'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json'];
const markers = MARKERS.filter(m => existsSync(join(repoRoot, m)));
try {
  const pj = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  if (pj.workspaces) markers.push('package.json workspaces');
} catch { /* no package.json */ }

// ---------- output ----------

const result = {
  repoRoot, scope: scopeRelFromRepo || '.', commitsAnalyzed: opts.commits, pkgDepth: opts.pkgDepth,
  files: files.length, packages: pkgs.size, markers,
  hotspots: hotspots.slice(0, 50),
  cycles, coChange: coChange.slice(0, 50), hiddenCoupling: hiddenCoupling.slice(0, 50),
  cohesion, surface, deepImports: deepList.slice(0, 50), grabBags: grabBags.slice(0, 50),
  coverage: { importSpecs: specTotal, internalLooking: specInternal, resolved: specResolved },
};

if (opts.json) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

const P = console.log;
function section(t) { P(`\n== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`); }
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : 'n/a');

P(`organize-modules signals  |  scope: ${result.scope}  |  ${files.length} files, ${pkgs.size} packages (pkg-depth ${opts.pkgDepth})  |  last ${opts.commits} commits`);

section('CONVENTION MARKERS');
P(markers.length ? '  ' + markers.join(', ') : '  none found at repo root');

section('HOT SPOTS  (revisions x LOC — where organization debt actually costs)');
for (const h of hotspots.slice(0, opts.top)) P(`  ${String(h.score).padStart(8)}  ${String(h.revisions).padStart(4)} revs  ${String(h.loc).padStart(6)} loc  ${h.rel}`);
if (!hotspots.length) P('  no commits touched files in scope');

section('PACKAGE CYCLES  (strongly connected components — always actionable)');
for (const c of cycles) P(`  cycle: ${c.join(' <-> ')}`);
if (!cycles.length) P('  none — package import graph is a DAG');

section(`CROSS-PACKAGE CO-CHANGE  (pairs co-committing >= ${THRESH.coMin} times at >= ${THRESH.coConf * 100}% confidence)`);
for (const c of coChange.slice(0, opts.top)) P(`  ${String(c.coCommits).padStart(4)} co-commits  conf ${c.confidence}  ${c.a}  <->  ${c.b}`);
if (!coChange.length) P('  none above threshold');

section('HIDDEN COUPLING  (packages that co-change with no import edge between them)');
for (const h of hiddenCoupling.slice(0, opts.top)) P(`  ${String(h.coCommits).padStart(4)} co-commits  ${h.a}  <->  ${h.b}`);
if (!hiddenCoupling.length) P('  none above threshold');

section(`PACKAGE COHESION  (share of a package's commits touching >= 2 of its files; low = accidental grouping)`);
for (const c of cohesion.slice(0, opts.top)) P(`  cohesion ${String(c.cohesion).padEnd(4)}  ${String(c.files).padStart(4)} files  ${String(c.commits).padStart(4)} commits  ${c.pkg}${c.cohesion < THRESH.cohesionLow ? '   <- accidental grouping?' : ''}`);
if (!cohesion.length) P('  not enough history per package to judge');

section('EXPORT SURFACE  (exports vs internal mass — depth is few exports over rich behavior)');
for (const s of surface.slice(0, opts.top)) P(`  ${String(s.exports).padStart(5)} exports  ${String(s.files).padStart(4)} files  ${String(s.loc).padStart(7)} loc  ${s.exportsPerFile.toFixed(1).padStart(5)}/file  index:${s.hasIndex ? 'yes' : 'no '}  fan-in:${String(s.fanIn).padStart(3)}  ${s.pkg}`);

section('DEEP IMPORTS  (cross-package imports bypassing a declared index / reaching internal)');
for (const d of deepList.slice(0, opts.top)) { P(`  ${String(d.count).padStart(4)}  ${d.edge}`); for (const s of d.samples) P(`          e.g. ${s}`); }
if (!deepList.length) P('  none detected');

section('GRAB-BAGS  (high fan-in utility files; disjointness ~1 means importers share no symbols)');
for (const g of grabBags.slice(0, opts.top)) P(`  fan-in ${String(g.fanIn).padStart(3)}  symbols used ${String(g.exportedSymbolsUsed).padStart(3)}  disjointness ${g.disjointness ?? 'n/a '}  ${g.rel}`);
if (!grabBags.length) P('  none detected');

section('COVERAGE  (trust the git sections fully; weigh graph sections by this)');
P(`  import specs seen: ${specTotal}   internal-looking: ${specInternal}   resolved into graph: ${specResolved} (${pct(specResolved, specInternal)} of internal)`);
P('  a native tool (madge, dependency-cruiser, go list, import-linter) beats this graph when available');
