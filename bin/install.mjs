#!/usr/bin/env node
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILLS_ROOT = join(PKG_ROOT, 'skills')

const USAGE = `leo-skills — install Leo's agent skills into a Claude Code skills directory

Usage
  npx leo-skills install [skill...]   Install every skill, or only the named ones
  npx leo-skills list                 List the skills this package ships

Options
  --project, -p   Install into ./.claude/skills (this repo only)
  --global, -g    Install into ~/.claude/skills (all projects) [default]
  --dir <path>    Install into an explicit directory
  --force, -f     Overwrite a skill that is already installed
  --help, -h      Show this message
`

async function shippedSkills() {
  const entries = await readdir(SKILLS_ROOT, { withFileTypes: true }).catch(() => [])
  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      await stat(join(SKILLS_ROOT, entry.name, 'SKILL.md'))
      found.push(entry.name)
    } catch {
      // not a skill directory
    }
  }
  return found.sort()
}

function parseArgs(argv) {
  const opts = { force: false, target: null, names: [], command: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--force' || arg === '-f') opts.force = true
    else if (arg === '--project' || arg === '-p') opts.target = resolve('.claude/skills')
    else if (arg === '--global' || arg === '-g') opts.target = join(homedir(), '.claude', 'skills')
    else if (arg === '--dir') opts.target = resolve(argv[++i] ?? '')
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    else if (!opts.command) opts.command = arg
    else opts.names.push(arg)
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const available = await shippedSkills()

  if (opts.help || (!opts.command && opts.names.length === 0)) {
    process.stdout.write(USAGE)
    return
  }

  if (opts.command === 'list') {
    for (const name of available) process.stdout.write(`${name}\n`)
    return
  }

  if (opts.command !== 'install') {
    throw new Error(`Unknown command: ${opts.command}. Run with --help.`)
  }

  const wanted = opts.names.length ? opts.names : available
  const unknown = wanted.filter((name) => !available.includes(name))
  if (unknown.length) {
    throw new Error(`No such skill: ${unknown.join(', ')}. Available: ${available.join(', ')}`)
  }

  const target = opts.target ?? join(homedir(), '.claude', 'skills')
  await mkdir(target, { recursive: true })

  let installed = 0
  let skipped = 0
  for (const name of wanted) {
    const dest = join(target, name)
    const exists = await stat(dest).then(
      () => true,
      () => false,
    )
    if (exists && !opts.force) {
      process.stdout.write(`  ${'skip'.padEnd(6)} ${name} (already installed — pass --force to overwrite)\n`)
      skipped++
      continue
    }
    if (exists) await rm(dest, { recursive: true, force: true })
    await cp(join(SKILLS_ROOT, name), dest, { recursive: true })
    process.stdout.write(`  ${(exists ? 'update' : 'add').padEnd(6)} ${name}\n`)
    installed++
  }

  process.stdout.write(`\n${installed} installed, ${skipped} skipped → ${target}\n`)
  if (installed) process.stdout.write('Restart Claude Code (or run /reload-skills) to pick them up.\n')
}

main().catch((error) => {
  process.stderr.write(`leo-skills: ${error.message}\n`)
  process.exit(1)
})
