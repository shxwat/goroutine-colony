import { useColony } from '../store/colonyStore'

/** The trace, as it streams. Same events the renderer consumes. */
export function EventLog() {
  const log = useColony((s) => s.log)
  return (
    <section className="log" aria-label="runtime trace">
      <div className="log-head">
        <span>trace</span>
        <span className="log-live" />
      </div>
      <ol className="log-body">
        {log.map((l, i) => (
          <li key={l.seq} className={`log-line tone-${l.tone}`} style={{ opacity: 0.35 + ((i + 1) / log.length) * 0.65 }}>
            <span className="log-t">{l.t.toFixed(2).padStart(5, ' ')}</span>
            <span className="log-text">{l.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
