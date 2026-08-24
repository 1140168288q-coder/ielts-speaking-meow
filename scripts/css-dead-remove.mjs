import { readFileSync, writeFileSync } from 'node:fs'

const cssFiles = ['src/styles.css', 'src/design-system.css']
const unused = new Set(`account-user-id ai-comparison-card ai-offline-row analysis-caveat attempt-columns chosen-version-card comparison-feedback comparison-intro comparison-stack delta-card delta-grid empty-feedback expression-actions favorable feedback-index feedback-list feedback-section focus-reminder hero-card hero-cat hero-line hero-line-bottom hero-line-middle hero-line-top hero-lines hint-card hint-hold-button hint-overlay history-item holding issue-list live-transcript metrics-grid playback-button privacy-note question-filters question-recommendation record-button record-time record-visual recording-card reference-answer-list resume-card resume-icon review-actions review-aloud-card save-expression-card version-actions version-card version-list version-quote versions-card`.split(/\s+/))

const classNamesInSel = (sel) => {
  const set = new Set()
  for (const m of sel.matchAll(/\.([A-Za-z][\w-]*)/g)) set.add(m[1])
  return set
}
const selIsDead = (sel) => {
  const cs = classNamesInSel(sel)
  if (cs.size === 0) return false // element/pseudo-only selector: keep
  for (const c of cs) if (!unused.has(c)) return false
  return true
}
const ruleIsDead = (selectorList) => {
  // every comma-separated selector is dead => whole rule dead
  const sels = selectorList.split(',').map((s) => s.trim()).filter(Boolean)
  if (sels.length === 0) return false
  return sels.every(selIsDead)
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitTopLevel(css) {
  css = stripComments(css)
  const out = []
  let depth = 0, start = 0, selStart = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      if (depth === 0) {
        const sel = css.slice(start, i)
        // find where selector starts (after last } at depth 0)
        out.push({ type: 'rule', sel: sel.trim(), body: '', bodyStart: i + 1 })
        depth++
      } else {
        depth++
      }
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const last = out[out.length - 1]
        if (last && last.type === 'rule' && last.body === '') {
          last.body = css.slice(last.bodyStart, i)
          last.end = i
        } else if (last && last.type === 'media') {
          last.end = i
        }
        start = i + 1
      }
    }
  }
  // simplify: collect raw blocks
  return out
}

// Simpler: tokenize into top-level chunks (text between balanced braces)
function topChunks(css) {
  css = stripComments(css)
  const chunks = []
  let depth = 0, buf = ''
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    buf += ch
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        chunks.push(buf)
        buf = ''
      }
    }
  }
  if (buf.trim()) chunks.push(buf)
  return chunks
}

function processRule(text) {
  // text like "selector { decls }"
  const m = text.match(/^([^{}]*)\{([\s\S]*)\}$/)
  if (!m) return null
  const sel = m[1]
  const body = m[2]
  if (sel.trim().startsWith('@media')) {
    // media block: process inner
    const inner = body
    const innerChunks = topChunks(inner)
    const kept = innerChunks.map((c) => processRule(c)).filter(Boolean)
    if (kept.length === 0) return null
    return sel + ' {\n' + kept.join('\n') + '\n}'
  }
  if (ruleIsDead(sel)) return null
  return text
}

const apply = process.argv.includes('--apply')
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8')
  const chunks = topChunks(css)
  let removed = 0
  const kept = []
  for (const chunk of chunks) {
    const res = processRule(chunk)
    if (res === null) {
      removed++
      if (!apply) console.log('DEL', file, ':', chunk.slice(0, 90).replace(/\n/g, ' ').trim())
    } else {
      kept.push(res)
    }
  }
  const newCss = kept.join('\n\n') + '\n'
  const oldLines = css.split('\n').length
  const newLines = newCss.split('\n').length
  console.log(`${file}: removed ${removed} top-level chunks, lines ${oldLines} -> ${newLines}`)
  if (apply && removed > 0) writeFileSync(file, newCss)
}
