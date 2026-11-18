#!/usr/bin/env node
/**
 * LaTeX rendering regression check.
 *
 * Replays the ENTIRE production math pipeline over EVERY math span in EVERY
 * bank (question + choices + solution):
 *
 *   sanitizeLatex(whole text) -> KaTeX splitAtDelimiters (verbatim from
 *   katex/dist/contrib/auto-render) -> fixMathSpan (the auto-render
 *   `preProcess`) -> katex.renderToString with throwOnError:true
 *
 * Exits non-zero if any span fails to render. Keep this at 0 errors.
 *
 * Usage (from the repo root, with app/web deps installed):
 *   node scripts/latex_scan.mjs
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import katex from '../app/web/node_modules/katex/dist/katex.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// ---- compile lib/latex.ts (pure TS, no imports) with esbuild ----
const BUILD = path.join(ROOT, '.latex_scan_build.cjs')
execFileSync(
  'npx',
  ['esbuild', path.join(ROOT, 'app/web/src/lib/latex.ts'), '--format=cjs', '--outfile=' + BUILD],
  { cwd: path.join(ROOT, 'app/web'), stdio: 'inherit' },
)
const { sanitizeLatex, fixMathSpan, MACROS } = require(BUILD)

// ---- delimiter splitting: verbatim from katex/contrib/auto-render ----
const findEndOfMath = function (delimiter, text, startIndex) {
  let index = startIndex
  let braceLevel = 0
  const delimLength = delimiter.length
  while (index < text.length) {
    const character = text[index]
    if (braceLevel <= 0 && text.slice(index, index + delimLength) === delimiter) return index
    else if (character === '\\') { index++ }
    else if (character === '{') { braceLevel++ }
    else if (character === '}') { braceLevel-- }
    index++
  }
  return -1
}
const amsRegex = /^\\begin\{/
const splitAtDelimiters = function (text, delimiters) {
  let index
  const data = []
  const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const regexLeft = new RegExp('(' + delimiters.map((x) => escapeRegex(x.left)).join('|') + ')')
  while (true) {
    index = text.search(regexLeft)
    if (index === -1) break
    if (index > 0) {
      data.push({ type: 'text', data: text.slice(0, index) })
      text = text.slice(index)
    }
    const i = delimiters.findIndex((delim) => text.startsWith(delim.left))
    index = findEndOfMath(delimiters[i].right, text, delimiters[i].left.length)
    if (index === -1) break
    const rawData = text.slice(0, index + delimiters[i].right.length)
    const math = amsRegex.test(rawData) ? rawData : text.slice(delimiters[i].left.length, index)
    data.push({ type: 'math', data: math, display: delimiters[i].display })
    text = text.slice(index + delimiters[i].right.length)
  }
  return data
}
const DELIMS = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false },
]

// ---- scan every bank ----
const files = fs
  .readdirSync(path.join(ROOT, 'bank'))
  .filter((f) => f.endsWith('.json') && !f.endsWith('.v1.json'))
  .map((f) => path.join(ROOT, 'bank', f))
  .concat([path.join(ROOT, 'bank/v2/amc10.json'), path.join(ROOT, 'bank/v2/amc12.json')])

let total = 0
let errs = 0
const errKinds = new Map()
for (const f of files) {
  let d
  try {
    d = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    continue
  }
  for (const v of d.variants || []) {
    const texts = [String(v.question || '')]
    for (const c of Object.values(v.choices || {})) texts.push(String(c))
    if (v.solution) texts.push(String(v.solution))
    for (const t of texts) {
      for (const part of splitAtDelimiters(sanitizeLatex(String(t)), DELIMS)) {
        if (part.type !== 'math') continue
        total++
        try {
          katex.renderToString(fixMathSpan(part.data), {
            displayMode: part.display,
            throwOnError: true,
            trust: true,
            strict: 'ignore',
            macros: MACROS,
          })
        } catch (e) {
          errs++
          const key = e.message.slice(0, 70)
          if (!errKinds.has(key)) {
            errKinds.set(key, { n: 0, ex: part.data.replace(/\n+/g, ' ').slice(0, 110), f })
          }
          errKinds.get(key).n++
        }
      }
    }
  }
}

fs.rmSync(BUILD, { force: true })
console.log(`latex_scan: ${total} math spans, ${errs} errors`)
for (const [k, v] of [...errKinds.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`\n${v.n}x ${k}\n   [${v.f}] ${v.ex}`)
}
process.exit(errs ? 1 : 0)
