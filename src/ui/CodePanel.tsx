import { Fragment, useMemo } from 'react'
import { scenarioById } from '../scenarios'
import { useColony } from '../store/colonyStore'

const KEYWORDS = /\b(func|go|for|range|var|defer|return|make|chan|if|select|type|struct)\b/g
const TYPES = /\b(sync\.Mutex|sync\.WaitGroup|Job|int|\*sync\.Mutex|\*sync\.WaitGroup)\b/g

/** Minimal Go highlighting: keywords, a few types, comments. */
function highlight(line: string) {
  const ci = line.indexOf('//')
  const code = ci >= 0 ? line.slice(0, ci) : line
  const comment = ci >= 0 ? line.slice(ci) : ''
  const parts: { text: string; cls?: string }[] = []
  const re = new RegExp(`${KEYWORDS.source}|${TYPES.source}|(<-)`, 'g')
  let last = 0
  for (const m of code.matchAll(re)) {
    if (m.index! > last) parts.push({ text: code.slice(last, m.index) })
    parts.push({ text: m[0], cls: m[0] === '<-' ? 'tk-op' : m[1] ? 'tk-kw' : 'tk-ty' })
    last = m.index! + m[0].length
  }
  if (last < code.length) parts.push({ text: code.slice(last) })
  if (comment) parts.push({ text: comment, cls: 'tk-cm' })
  return parts
}

/**
 * The program, with every goroutine pinned to the line it is executing.
 * A red chip on `jobs <- job` is worth a paragraph of explanation.
 */
export function CodePanel() {
  const scenarioId = useColony((s) => s.scenarioId)
  const markers = useColony((s) => s.markers)
  const lastLine = useColony((s) => s.lastLine)
  const code = scenarioById(scenarioId).code
  const lines = useMemo(() => code.map(highlight), [code])

  return (
    <section className="code" aria-label="program source">
      <div className="code-head">
        <span>main.go</span>
      </div>
      <ol className="code-body">
        {lines.map((parts, i) => {
          const n = i + 1
          const here = markers[n] ?? []
          const hot = here.some((m) => m.state === 'BLOCKED')
          return (
            <li
              key={n}
              className={`code-line${here.length ? ' has-g' : ''}${hot ? ' is-hot' : ''}`}
              data-flash={lastLine?.line === n ? lastLine.seq % 2 : undefined}
            >
              <span className="ln">{n}</span>
              <span className="src">
                {parts.map((p, k) => (
                  <Fragment key={k}>{p.cls ? <span className={p.cls}>{p.text}</span> : p.text}</Fragment>
                ))}
              </span>
              <span className="chips">
                {here.slice(0, 6).map((m) => (
                  <span key={m.gid} className={`chip st-${m.state.toLowerCase()}`}>
                    g{m.gid}
                  </span>
                ))}
                {here.length > 6 && <span className="chip st-more">+{here.length - 6}</span>}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
