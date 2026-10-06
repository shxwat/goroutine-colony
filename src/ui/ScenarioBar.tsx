import { SCENARIOS } from '../scenarios'
import { useColony } from '../store/colonyStore'

export function ScenarioBar() {
  const scenarioId = useColony((s) => s.scenarioId)
  const paused = useColony((s) => s.paused)
  const muted = useColony((s) => s.muted)
  const { setScenario, replay, togglePause, toggleMute } = useColony.getState()

  return (
    <nav className="bar">
      <div className="bar-scenarios" role="tablist">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === scenarioId}
            className="bar-tab"
            onClick={() => setScenario(s.id)}
            title={`${s.caption}  [${i + 1}]`}
          >
            <span className="bar-key">{i + 1}</span>
            {s.label}
          </button>
        ))}
      </div>
      <div className="bar-controls">
        <button className="bar-btn" onClick={togglePause} title="pause [space]">
          {paused ? '▶' : '❚❚'}
        </button>
        <button className="bar-btn" onClick={replay} title="replay [R]">
          ↻
        </button>
        <button className="bar-btn bar-sound" onClick={toggleMute} title="sound [M]" data-on={!muted}>
          {muted ? 'sound off' : 'sound on'}
        </button>
      </div>
    </nav>
  )
}
