import { readFileSync, writeFileSync } from 'node:fs'

const extract = (file) => {
  const css = readFileSync(file, 'utf8')
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:where\([^)]*\)/g, ':where()')
  const selectorCounts = new Map()
  // match simple rules: selector list followed by { ... } (non-nested)
  const ruleRe = /(^|\})\s*([^{}@]+?)\s*\{/g
  let m
  while ((m = ruleRe.exec(noComments)) !== null) {
    const raw = m[2].trim()
    if (!raw) continue
    const sels = raw.split(',').map((s) => s.trim()).filter(Boolean)
    for (const sel of sels) {
      // only single-class selectors like .foo (the discovery regex scope)
      if (/^\.[A-Za-z0-9_-]+$/.test(sel)) {
        const list = selectorCounts.get(sel) ?? []
        list.push(raw)
        selectorCounts.set(sel, list)
      }
    }
  }
  return selectorCounts
}

const a = extract('src/styles.css')
const b = extract('src/design-system.css')

const shell = ['.account-chip', '.api-badge', '.app-header', '.app-main', '.app-shell', '.bottom-nav', '.brand', '.brand-mark', '.empty-state', '.eyebrow', '.filter-toggle', '.header-tools', '.inline-note', '.page-stack', '.part-tabs', '.primary-button', '.secondary-button', '.step-track']

const duplicates = []
for (const [sel, blocks] of a) {
  if (b.has(sel)) duplicates.push(sel)
}
duplicates.sort()

const lines = []
lines.push(`duplicates found: ${duplicates.length}`)
for (const sel of duplicates) {
  const owner = shell.includes(sel) ? 'DS(shell)' : 'STYLES(card)'
  lines.push(`${sel.padEnd(28)} ${owner}   styles.css x${a.get(sel).length}  design-system x${b.get(sel).length}`)
}
// also: selectors duplicated WITHIN a single file
const withinA = [...a].filter(([, v]) => v.length > 1).map(([k]) => k)
const withinB = [...b].filter(([, v]) => v.length > 1).map(([k]) => k)
lines.push('')
lines.push(`within styles.css: ${withinA.join(' ')}`)
lines.push(`within design-system.css: ${withinB.join(' ')}`)
writeFileSync('scripts/.css-dup-report.txt', lines.join('\n'))
console.log(lines.join('\n'))
