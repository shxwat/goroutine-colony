import { useColony } from '../store/colonyStore'
import { CodePanel } from './CodePanel'
import { EventLog } from './EventLog'
import { Hud } from './Hud'
import { LiveHud } from './LiveHud'
import { ScenarioBar } from './ScenarioBar'
import { Tooltip } from './Tooltip'
import { Verdict } from './Verdict'

/** DOM layer. Everything hugs the edges; the colony keeps the middle. */
export function Overlay() {
  const verdict = useColony((s) => s.verdict?.kind)
  const live = useColony((s) => s.live != null)
  // pause/mute re-render the live bar's labels
  useColony((s) => s.paused)
  useColony((s) => s.muted)
  if (live) {
    return (
      <div className="overlay overlay-live" data-verdict={verdict}>
        <LiveHud />
        <Verdict />
        <Tooltip />
      </div>
    )
  }
  return (
    <div className="overlay" data-verdict={verdict}>
      <Hud />
      <CodePanel />
      <EventLog />
      <Verdict />
      <ScenarioBar />
      <Tooltip />
    </div>
  )
}
