import { useColony } from '../store/colonyStore'

/**
 * Live mode header: what the producer is, a few facts, and how real requests
 * ended. Counts come straight from reported outcomes (HTTP statuses).
 */
export function LiveHud() {
  const live = useColony((s) => s.live)!
  const stream = useColony((s) => s.stream)
  const tally = useColony((s) => s.tally)
  const names = stream?.outcomes ?? {}

  const rows: [string, number, string][] = [
    ['Requests', tally.requests, 'total'],
    [names.success ?? 'Success', tally.success, 'ok'],
    [names.rejected ?? 'Rejected', tally.rejected, 'no'],
  ]
  if (tally.error) rows.push([names.error ?? 'Error', tally.error, 'err'])

  return (
    <>
      <header className="brand live-brand">
        <h1>{stream?.title ?? 'LIVE'}</h1>
        <p className={`link link-${live.status}`}>
          <span className="link-dot" />
          {live.status === 'live' ? 'live data' : live.status === 'connecting' ? 'connecting' : 'reconnecting'}
          <span className="link-url">{live.url.replace(/^wss?:\/\//, '')}</span>
        </p>
        <dl className="stats">
          {rows.map(([k, v, tone]) => (
            <div key={k} className={`stat live-${tone}`} data-zero={v === 0}>
              <dt>{k.toUpperCase()}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </header>
      {stream && (
        <aside className="caption live-facts">
          {stream.fields.map((f) => (
            <div key={f.k} className="fact" data-k={f.k.toLowerCase()} data-v={f.v.toLowerCase()}>
              <span className="fact-k">{f.k}</span>
              <span className="fact-v">{f.v}</span>
            </div>
          ))}
        </aside>
      )}
      <nav className="bar live-bar">
        <span className="live-note">real requests · replayed in slow motion, in true order</span>
        <div className="bar-controls">
          <button className="bar-btn" onClick={() => useColony.getState().togglePause()} title="pause [space]">
            {useColony.getState().paused ? '▶' : '❚❚'}
          </button>
          <button className="bar-btn bar-sound" onClick={() => useColony.getState().toggleMute()} data-on={!useColony.getState().muted}>
            {useColony.getState().muted ? 'sound off' : 'sound on'}
          </button>
          <a className="bar-btn" href={location.pathname}>
            scenarios
          </a>
        </div>
      </nav>
    </>
  )
}
