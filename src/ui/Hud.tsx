import { scenarioById } from '../scenarios'
import { useColony } from '../store/colonyStore'

const ROWS = [
  ['RUNNING', 'run'],
  ['BLOCKED', 'block'],
  ['WAITING', 'wait'],
  ['SLEEPING', 'sleep'],
] as const

export function Hud() {
  const stats = useColony((s) => s.stats)
  const scenarioId = useColony((s) => s.scenarioId)
  const paused = useColony((s) => s.paused)
  const scenario = scenarioById(scenarioId)

  return (
    <>
      <header className="brand">
        <h1>GOROUTINE COLONY</h1>
        <p>The Go runtime, alive.</p>
        <dl className="stats">
          <div className="stat stat-total">
            <dt>GOROUTINES</dt>
            <dd>{stats.total}</dd>
          </div>
          {ROWS.map(([k, tone]) => (
            <div key={k} className={`stat tone-${tone}`} data-zero={stats[k] === 0}>
              <dt>{k}</dt>
              <dd>{stats[k]}</dd>
            </div>
          ))}
        </dl>
      </header>
      <aside className="caption" key={scenarioId}>
        <span className="caption-tag">{scenario.label.toLowerCase()}</span>
        <span className="caption-text">{scenario.caption}</span>
        {paused && <span className="caption-paused">paused</span>}
      </aside>
    </>
  )
}
