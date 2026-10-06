import { useEffect, useState } from 'react'
import { session } from '../simulation/session'
import { useColony, type Verdict as VerdictT } from '../store/colonyStore'

/** Types text out like a terminal, honouring pause. */
function useTypewriter(text: string, cps: number, active: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    if (!active) return
    let raf = 0
    let acc = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      if (!session.paused) acc += dt * cps
      setN(Math.min(text.length, Math.floor(acc)))
      if (acc < text.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [text, cps, active])
  return text.slice(0, n)
}

export function Verdict() {
  const verdict = useColony((s) => s.verdict)
  if (!verdict) return null
  return verdict.kind === 'race' ? <RaceVerdict {...verdict} /> : <DeadlockVerdict lines={verdict.lines} />
}

function RaceVerdict({ mem, value, expected, gids, frames, title, detail }: Extract<VerdictT, { kind: 'race' }>) {
  const cell = session.world.memory.get(mem)
  const addr = cell?.addr || '0xc000012098'
  const name = cell?.label ?? mem
  const heading = title ?? 'DATA RACE'
  return (
    <>
      <div className="verdict verdict-race">
        <div className="race-title" data-text={heading}>
          {heading}
        </div>
      </div>
      <pre className="verdict race-report">
        {detail ? (
          <span className="dim">{detail}{'\n'}</span>
        ) : (
          <>
            <span className="dim">Write at {addr} by goroutine {gids[0]}:</span>
            {'\n'}  {frames[0]}{'\n'}
            <span className="dim">Previous write at {addr} by goroutine {gids[1]}:</span>
            {'\n'}  {frames[1]}{'\n'}
          </>
        )}
        {'\n'}
        <span className="hot">
          {name} = {value}
        </span>
        <span className="dim">
          {'   '}want {expected}.{typeof value === 'number' ? ' one increment was lost.' : ''}
        </span>
      </pre>
    </>
  )
}

function DeadlockVerdict({ lines }: { lines: string[] }) {
  const [head, ...rest] = lines
  const title = useTypewriter(head, 34, true)
  const body = useTypewriter(rest.join('\n'), 140, title.length === head.length)
  return (
    <div className="verdict verdict-deadlock">
      <pre>
        <span className="fatal">{title}</span>
        {title.length < head.length && <span className="caret">▌</span>}
        {'\n'}
        <span className="dump">{body}</span>
        {title.length === head.length && body.length < rest.join('\n').length && <span className="caret">▌</span>}
      </pre>
    </div>
  )
}
