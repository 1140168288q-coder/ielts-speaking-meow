import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const cssFiles = ['src/styles.css', 'src/design-system.css']
const codeExts = new Set(['.ts', '.tsx'])

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'backend') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (codeExts.has(extname(p))) out.push(p)
  }
}

const codeFiles = []
walk('src', codeFiles)
const codeBlob = codeFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

const classNames = new Set()
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8')
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of noComments.matchAll(/\.([A-Za-z][A-Za-z0-9_-]+)/g)) {
    classNames.add(m[1])
  }
}

const unused = []
for (const cls of classNames) {
  // search as word/substring in code (handles template-string concatenation)
  const re = new RegExp(`\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  if (!re.test(codeBlob)) {
    unused.push(cls)
  }
}
unused.sort()

console.log('total classes:', classNames.size)
console.log('unused candidates:', unused.length)
console.log(unused.join(' '))

// commented CSS blocks containing braces
console.log('\n--- commented CSS blocks (with braces) ---')
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8')
  const re = /\/\*[\s\S]*?\*\//g
  let m
  let n = 0
  while ((m = re.exec(css)) !== null) {
    if (m[0].includes('{') || m[0].includes('}')) {
      n++
      if (n <= 5) console.log(file, ':', m[0].slice(0, 120).replace(/\n/g, ' '))
    }
  }
  if (n) console.log(file, 'total commented-with-braces:', n)
}

// empty media queries
console.log('\n--- empty @media blocks ---')
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8')
  const re = /@media[^{]*\{\s*\}/g
  let m
  while ((m = re.exec(css)) !== null) {
    console.log(file, ':', m[0].replace(/\n/g, ' '))
  }
}
