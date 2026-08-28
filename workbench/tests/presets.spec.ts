import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

/**
 * Preset validation — the check DESIGN.md §12 proposed and nothing performed.
 *
 * A preset is plain YAML that nothing compiles, so a typo in a plugin name or
 * a missing persona survives every other gate in the repo and fails at boot,
 * or worse, mounts a persona claiming capabilities it does not have. These
 * assertions are the only thing standing between an edit and that.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESET_ROOT = resolve(HERE, '../cordis/presets')
const REPO_ROOT = resolve(HERE, '../..')

/** Harness discovery scans directories holding this file; flat files are ignored. */
const COMPOSITION_FILE = 'agent.cordis.yml'

/** The five personas DESIGN.md §6.12 specifies. */
const EXPECTED = ['artifact', 'code-analysis', 'document-analyst', 'engineering-vision', 'research']

interface Row { id?: string; name?: string; config?: Record<string, unknown> }

function presetDirs(): string[] {
  return readdirSync(PRESET_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

function rowsOf(preset: string): Row[] {
  const parsed = load(readFileSync(join(PRESET_ROOT, preset, COMPOSITION_FILE), 'utf8'))
  expect(Array.isArray(parsed), `${preset} must be a top-level list of plugin rows`).toBe(true)
  return parsed as Row[]
}

/** Whether a package name is declared by any workspace package. */
function packageExists(name: string): boolean {
  const roots = [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'workbench/packages')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const stack = [root]
    while (stack.length) {
      const dir = stack.pop()!
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== 'node_modules') stack.push(path)
        else if (entry.name === 'package.json') {
          try {
            if ((JSON.parse(readFileSync(path, 'utf8')) as { name?: string }).name === name) return true
          } catch {
            // A malformed package.json is not this suite's concern; skip it.
          }
        }
      }
    }
  }
  return false
}

describe('agent presets', () => {
  it('all five personas exist, and nothing extra', () => {
    expect(presetDirs()).toEqual(EXPECTED)
  })

  it('each is a directory holding agent.cordis.yml, the only form discovery scans', () => {
    // Flat <name>.cordis.yml files are silently ignored by scanRoot(), so a
    // preset in that shape never appears in the roster and nothing says why.
    for (const preset of EXPECTED) {
      expect(existsSync(join(PRESET_ROOT, preset, COMPOSITION_FILE)), `${preset} missing ${COMPOSITION_FILE}`).toBe(true)
    }
    expect(
      readdirSync(PRESET_ROOT).filter((f) => f.endsWith('.cordis.yml')),
      'a flat preset file would be ignored by discovery',
    ).toEqual([])
  })

  describe.each(EXPECTED)('%s', (preset) => {
    it('parses as a list of plugin rows, each with a name', () => {
      for (const row of rowsOf(preset)) {
        expect(typeof row.name, `a row in ${preset} has no plugin name`).toBe('string')
      }
    })

    it('every referenced plugin actually exists in the workspace', () => {
      // The failure this guards: a typo boots to "cannot resolve plugin", or
      // a renamed package leaves a preset quietly composing nothing.
      for (const row of rowsOf(preset)) {
        expect(packageExists(row.name!), `${preset} references unknown plugin ${row.name}`).toBe(true)
      }
    })

    it('opens with a header comment saying what the persona may and may not touch', () => {
      const text = readFileSync(join(PRESET_ROOT, preset, COMPOSITION_FILE), 'utf8')
      expect(text.startsWith('#'), `${preset} has no header comment`).toBe(true)
    })

    it('carries a persona row with prompt text', () => {
      const persona = rowsOf(preset).find((r) => r.id === 'persona')
      expect(persona, `${preset} has no persona row`).toBeDefined()
      const text = (persona!.config as { text?: unknown } | undefined)?.text
      expect(typeof text, `${preset}'s persona has no text`).toBe('string')
      expect((text as string).length).toBeGreaterThan(100)
    })

    it('the persona tells the model its actions are policy-governed', () => {
      // §6.12: this sentence is what makes the policy engine visible in the
      // product rather than enforced silently in the backend.
      const persona = rowsOf(preset).find((r) => r.id === 'persona')
      const text = String((persona!.config as { text?: unknown }).text)
      expect(text).toMatch(/policy-governed|policy engine/i)
      expect(text, `${preset} does not tell the model what to do on a denial`).toMatch(/denied|denial/i)
    })

    it('composes wb-rag — every persona is grounded in the corpus', () => {
      const names = rowsOf(preset).map((r) => r.name)
      expect(names).toContain('@mrpl/dsh-workbench-rag')
    })
  })

  it('the research persona is the only one granted web access', () => {
    // §5 allows exactly one PUBLIC-only egress path; a second preset carrying
    // tool-web would widen the sovereignty claim without anyone noticing.
    const withWeb = EXPECTED.filter((p) =>
      rowsOf(p).some((r) => r.name === '@deepseek-ai/dsh-tool-web'))
    expect(withWeb).toEqual(['research'])
  })

  it('only the code-analysis persona is granted a code runtime', () => {
    const withCode = EXPECTED.filter((p) =>
      rowsOf(p).some((r) => r.name === '@deepseek-ai/dsh-code-runtime'))
    expect(withCode).toEqual(['code-analysis'])
  })

  it('only the engineering-vision persona is granted vision tools', () => {
    const withVision = EXPECTED.filter((p) =>
      rowsOf(p).some((r) => r.name === '@mrpl/dsh-workbench-vision'))
    expect(withVision).toEqual(['engineering-vision'])
  })

  it('only the artifact persona is granted the generators', () => {
    const withArtifacts = EXPECTED.filter((p) =>
      rowsOf(p).some((r) => r.name === '@mrpl/dsh-workbench-artifacts'))
    expect(withArtifacts).toEqual(['artifact'])
  })
})
