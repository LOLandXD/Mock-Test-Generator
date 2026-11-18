/**
 * sanitizeLatex(): normalise scraped LaTeX so KaTeX can render it.
 *
 * String-level fixes (applied before auto-render splits the text):
 * - align/eqnarray/gather variants (incl. `*`) -> aligned
 * - tabular -> array (KaTeX has no tabular), \multicolumn spec stripped
 * - $\[...\]$ -> $$...$$ (mixed delimiters in scraped solutions)
 * - non-breaking spaces (U+00A0) -> plain space
 * - preamble/layout commands leaking into math (\usepackage, \setlength, \ref…)
 *
 * Span-level fixes live in fixMathSpan() (wired as auto-render's preProcess).
 * Both were tuned until an exact replica of the production pipeline rendered
 * every math span in every bank without errors.
 */
export function sanitizeLatex(s: string): string {
  let out = s
    // all unicode space variants (incl. NBSP U+00A0) -> plain space
    .replace(/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, ' ')
    .replace(/\\begin\{(align\*?|split|eqnarray\*?|gather\*?|multline\*?)\}/g, '\\begin{aligned}')
    .replace(/\\end\{(align\*?|split|eqnarray\*?|gather\*?|multline\*?)\}/g, '\\end{aligned}')
    .replace(/\\begin\{tabular\}(?:\[[^\]]*\])?\{/g, '\\begin{array}{')
    .replace(/\\end\{tabular\}/g, '\\end{array}')
    // nested display delimiters: $$\[ ... \]$$  (must run before the $\[ rule)
    .replace(/\$\$\\\[/g, '$$')
    .replace(/\\\]\$\$/g, '$$')
    .replace(/\$\\\[/g, '$$')
    .replace(/\\\]\$/g, '$$')
    // xfig/picture-mode figure code can never be math -> placeholder
    .replace(/\\\[\s*\\setlength\{\\unitlength\}[\s\S]*?\\end\{picture\}[\s\S]*?\\\]/g, '\\text{[figure]}')
    .replace(/\\begin\{picture\}[\s\S]*?\\end\{picture\}/g, '\\text{[figure]}')
    // alignat carries a column-count arg that aligned doesn't take
    .replace(/\\begin\{alignat\*?\}\{[^}]*\}/g, '\\begin{aligned}')
    .replace(/\\end\{alignat\*?\}/g, '\\end{aligned}')
    // array's optional vertical arg ([t]/[b]) is not supported by KaTeX
    .replace(/\\begin\{array\}(?:\[[^\]]*\])?\{/g, '\\begin{array}{')
    // v1 banks: the column spec was lost in scraping and only
    // "\begin{array}[t] \multicolumn{n}{..}" remains -> synthesise {ccc…c}
    .replace(/\\begin\{array\}(?:\[[^\]]*\])?\s*\\multicolumn\{(\d+)\}\{[^}]*\}/g,
      (_, n) => '\\begin{array}{' + 'c'.repeat(Number(n)) + '}')
    // keep the multicolumn content, drop the spec (simple no-nesting case)
    .replace(/\\multicolumn\{[^{}]*\}\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    // LaTeX preamble / layout commands leaking into scraped math
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\setlength\{[^}]*\}\{[^}]*\}/g, '')
    // old-TeX radix: \root{n}\of{x} -> \sqrt[n]{x}
    .replace(/\\root\{([^}]*)\}\\of/g, '\\sqrt[$1]')
    .replace(/\\lefteqn\s*\{/g, '{')
    .replace(/\\ref\{[^}]*\}/g, '')
    // \Aboxed{f(n\ \text{even}) &= ...} -> \boxed{...} (drop the alignment &;
    // tolerates one level of nested braces before the &)
    .replace(/\\Aboxed\{(((?:[^{}]|\{[^{}]*\})*?))&/g, '\\boxed{$1')
    .replace(/\\makebox(\[[^\]]*\])?\s*\{[^{}]*\}/g, '{}')
    .replace(/\\framebox(\[[^\]]*\])?\s*\{/g, '\\framebox{')
    // \sqrt optional-arg polish (\leftroot/\uproot not supported by KaTeX)
    .replace(/\\(?:left|up)root\{[^}]*\}/g, '')
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\tag\{[^}]*\}/g, '')
    .replace(/\\notag/g, '')
  const dollars = out.match(/(?<!\\)\$/g)
  if (dollars && dollars.length % 2 === 1) {
    const i = out.lastIndexOf('$')
    out = out.slice(0, i) + '\\$' + out.slice(i + 1)
  }
  return out
}

/** Close open groups before a stray `\end{…}` whose environment began above them,
 * drop top-level `}`, append any still-open groups at the end. Scraped data often
 * loses braces; environments legitimately nested in groups must NOT be touched. */
function fixBraces(s: string): string {
  let out = ''
  let level = 0
  let i = 0
  const beginLevels: { env: string; level: number }[] = []
  while (i < s.length) {
    const endMatch = /^\\end\{([^}]*)\}/.exec(s.slice(i))
    if (endMatch) {
      const bi = beginLevels.map((b) => b.env).lastIndexOf(endMatch[1])
      if (bi >= 0 && level > beginLevels[bi].level) {
        out += '}'.repeat(level - beginLevels[bi].level)
        level = beginLevels[bi].level
      }
      beginLevels.splice(bi >= 0 ? bi : beginLevels.length, bi >= 0 ? 1 : 0)
      out += endMatch[0]
      i += endMatch[0].length
      continue
    }
    const beginMatch = /^\\begin\{([^}]*)\}/.exec(s.slice(i))
    if (beginMatch) {
      beginLevels.push({ env: beginMatch[1], level })
      out += beginMatch[0]
      i += beginMatch[0].length
      continue
    }
    const ch = s[i]
    if (ch === '\\') {
      out += s.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '{') level++
    else if (ch === '}') {
      if (level > 0) level--
      else {
        i++ // top-level } is always a parse error — drop it
        continue
      }
    }
    out += ch
    i++
  }
  return out + '}'.repeat(level)
}

/** Append missing `\end{env}`s and drop stray ones (scraped envs often dangle). */
function fixEnvs(s: string): string {
  const re = /\\(begin|end)\{([^}]*)\}/g
  const open = new Map<string, number>()
  let out = ''
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const [tok, kind, env] = m
    if (kind === 'end' && (open.get(env) ?? 0) <= 0) {
      out += s.slice(cursor, m.index) // stray \end{...} — drop it
      cursor = m.index + tok.length
      continue
    }
    open.set(env, (open.get(env) ?? 0) + (kind === 'begin' ? 1 : -1))
  }
  out += s.slice(cursor)
  let suffix = ''
  for (const [env, n] of open) if (n > 0) suffix += `\\end{${env}}`.repeat(n)
  return out + suffix
}

/** v1 scraped arrays often lost their column spec entirely ("\begin{array} \hline …"):
 * synthesise one from the & count of the first row. */
function fixArraySpecs(s: string): string {
  const re = /\\begin\{array\}(?!\s*(?:\[[^\]]*\])?\s*\{)/g
  return s.replace(re, (match, offset: number) => {
    const rest = s.slice((offset as number) + match.length)
    const rowEnd = rest.search(/\\\\|\\end\{array\}/)
    const firstRow = rowEnd === -1 ? rest : rest.slice(0, rowEnd)
    let cols = 1
    let esc = false
    for (const ch of firstRow) {
      if (esc) { esc = false; continue }
      if (ch === '\\') esc = true
      else if (ch === '&') cols++
    }
    return `\\begin{array}{${'c'.repeat(Math.max(1, cols))}}`
  })
}

/**
 * Macros scraped AoPS/Putnam/USAMO sources rely on but KaTeX lacks.
 * Verified with scripts/latex_scan.mjs (renders every math span in every bank
 * with throwOnError — keep that at 0 errors).
 */
export const MACROS: Record<string, string> = {
  '\\textsc': '\\text{#1}',
  '\\overarc': '\\widehat{#1}',
  '\\ds': '',
  '\\textdollar': '\\$',
  '\\mathdollar': '\\$',
  '\\mbox': '\\text{#1}',
  '\\equal': '=',
  '\\plus': '+',
  '\\minus': '-',
  '\\cent': '\\text{¢}',
  '\\framebox': '\\boxed{#1}',
  '\\textcircled': '\\text{○}',
  '\\ensuremath': '#1',
  '\\linebreak': '',
  '\\break': '',
  // blackboard-bold number/field sets (Putnam solutions)
  '\\RR': '\\mathbb{R}',
  '\\ZZ': '\\mathbb{Z}',
  '\\CC': '\\mathbb{C}',
  '\\QQ': '\\mathbb{Q}',
  '\\FF': '\\mathbb{F}',
  '\\NN': '\\mathbb{N}',
  '\\EE': '\\mathbb{E}',
  '\\ee': '\\mathrm{e}',
  // operator names
  '\\lcm': '\\operatorname{lcm}',
  '\\Trace': '\\operatorname{Trace}',
  '\\Var': '\\operatorname{Var}',
  '\\Cov': '\\operatorname{Cov}',
  '\\sgn': '\\operatorname{sgn}',
  // misc
  '\\deltal': '\\Delta l',
  '\\textgreater': '>',
  '\\textless': '<',
  '\\indent': '',
  '\\medskip': '',
  '\\hfill': '',
  '\\qedhere': '',
  '\\hdots': '\\ldots',
  // \calA .. \calZ -> \mathcal{A} .. \mathcal{Z}
  ...Object.fromEntries(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L) => [`\\cal${L}`, `\\mathcal{${L}}`]),
  ),
}

/**
 * Per-math-span repairs (wired into KaTeX auto-render as `preProcess`).
 * Every rewrite here targets input that is a guaranteed KaTeX parse error.
 */
export function fixMathSpan(s: string): string {
  let out = s
    // \mbox{textA $ math $ textB} -> \text{textA} math \text{textB} — the
    // nested math must stay in math mode (\leq etc. are undefined in \text)
    .replace(/\\(?:mbox|text)\{([^{}$]*?)\$([^$]+?)\$([^{}$]*?)\}/g, '\\text{$1}$2\\text{$3}')
    // remaining nested $...$ pairs inside math (e.g. \mbox{if $x<e$}) -> unwrap;
    // a remaining lone $ is always an error -> escape it (currency etc.)
    .replace(/(?<!\\)\$([^$]*?)(?<!\\)\$/g, '$1')
    .replace(/(?<!\\)\$/g, '\\$')
    // stray display/inline delimiters leaking inside an outer math span
    // (the (?<!\\) keeps row separators "\\[...]" intact)
    .replace(/(?<!\\)(?:\\\[|\\\]|\\\(|\\\))/g, '')
    // _ or ^ with no following token (incl. "x_^" -> "x_{}^{}") -> empty group
    .replace(/([_^])(?=[_^]|[\s}&\\]|$)/g, '$1{}')
    // \sqrt with no argument at all
    .replace(/\\sqrt(?=[\s}\\]|$)/g, '\\sqrt{}')
    // \frac{num} with the denominator missing before & / \\\\ / end of span
    // (tolerates one level of nested braces in the numerator)
    .replace(/\\([dt]?frac)(\{(?:[^{}]|\{[^{}]*\})*\})(?=\s*(?:&|\\\\|\\[dt]?frac)|$)/g, '\\$1$2{}')
    // bare \frac right before }, = or end of span
    .replace(/\\([dt]?frac)(?=$|=|})/g, '\\$1{}{}')
    // detached row-separator size arg: "\\ [0.5ex]" -> "\\[0.5ex]"
    // (only when the bracket content is a valid size — "\\ [XYZ]" is real content)
    .replace(/\\\\\s+(\[\s*-?[\d.]+\s*(?:em|ex|mu|pt|mm|cm|in|pc)\s*\])/gi, '\\\\$1')
  out = fixArraySpecs(out)
  out = fixEnvs(fixBraces(out))
  // "& \\ \hline\end{array}" — hline dangling after the last row separator
  out = out.replace(/\\\\\s*\\hline(?=\s*\\end\{array\})/g, '\\\\')
  // A \hline must follow \\, \begin{array}, or another \hline; anything else
  // means the row separator was lost in scraping -> restore "\\ \hline".
  out = out.replace(/\\hline/g, (tok, offset: number) => {
    let j = (offset as number) - 1
    while (j >= 0 && /\s/.test(out[j])) j--
    if (j < 0) return '\\\\ \\hline'
    if (out[j] === '\\') {
      if (out[j - 1] === '\\') return tok // after a \\ row separator
      if (out.slice(Math.max(0, j - 5), j + 1) === '\\hline') return tok // double hline
    }
    if (out[j] === '}' && /\\begin\{[^}]*\}$/.test(out.slice(0, j + 1))) return tok
    return '\\\\ \\hline'
  })
  return out
}
