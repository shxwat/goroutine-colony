import { useEffect, useRef, useState } from 'react'
import { STATE_HEX } from '../entities/palette'
import { session } from '../simulation/session'
import { useColony, type HoverTarget } from '../store/colonyStore'

interface Row {
  k: string
  v: string
  tone?: string
}

function describe(h: HoverTarget): { title: string; rows: Row[] } | null {
  const world = session.world
  switch (h.kind) {
    case 'goroutine': {
      const g = world.goroutines.get(h.id)
      if (!g) return null
      const rows: Row[] = [
        { k: 'state', v: g.state, tone: STATE_HEX[g.state] },
        { k: 'func', v: g.fn },
      ]
      if (g.blockedOn) rows.push({ k: 'waiting', v: g.blockedOn.startsWith('wg:') ? 'wg.Wait()' : `${g.blockedOn} · ${g.reason}` })
      const held = [...world.mutexes.values()].filter((m) => m.owner === g.gid).map((m) => m.name)
      if (held.length) rows.push({ k: 'holds', v: held.join(', ') })
      const carrying = [...world.payloads.values()].find((p) => p.loc.k === 'g' && p.loc.gid === g.gid)
      if (carrying) rows.push({ k: 'carries', v: carrying.label })
      if (g.line) rows.push({ k: 'line', v: `main.go:${g.line}` })
      if (g.status) rows.push({ k: 'response', v: g.status, tone: g.outcome === 'success' ? '#ffcf7a' : STATE_HEX.BLOCKED })
      return { title: g.label ? `${g.label} · goroutine ${g.gid}` : `goroutine ${g.gid}${g.fn === 'main.main' ? ' · main' : ''}`, rows }
    }
    case 'channel': {
      const ch = world.channels.get(h.id)
      if (!ch) return null
      const senders = world.queue(h.id, 'chan send').length
      const receivers = world.queue(h.id, 'chan receive').length
      return {
        title: `${ch.name}  chan ${ch.elem}`,
        rows: [
          { k: 'buffer', v: ch.cap ? `${ch.buffer.length}/${ch.cap}` : 'unbuffered', tone: ch.cap && ch.buffer.length === ch.cap ? STATE_HEX.BLOCKED : undefined },
          { k: 'sendq', v: String(senders), tone: senders ? STATE_HEX.BLOCKED : undefined },
          { k: 'recvq', v: String(receivers), tone: receivers ? STATE_HEX.WAITING : undefined },
        ],
      }
    }
    case 'mutex': {
      const mu = world.mutexes.get(h.id)
      if (!mu) return null
      const waiting = world.queue(h.id, 'sync.Mutex.Lock').length
      return {
        title: `${mu.name}  sync.Mutex`,
        rows: [
          { k: 'owner', v: mu.owner != null ? `goroutine ${mu.owner}` : '—', tone: mu.owner != null ? STATE_HEX.WAITING : undefined },
          { k: 'waiting', v: String(waiting), tone: waiting ? STATE_HEX.BLOCKED : undefined },
        ],
      }
    }
    case 'memory': {
      const m = world.memory.get(h.id)
      if (!m) return null
      return {
        title: typeof m.value === 'number' ? `${m.label}  int` : m.label,
        rows: [
          { k: 'value', v: String(m.value), tone: m.raced ? STATE_HEX.BLOCKED : undefined },
          ...(m.addr ? [{ k: m.addr.startsWith('0x') ? 'addr' : 'of', v: m.addr }] : []),
          { k: 'writes', v: String(m.writes) },
          ...(m.raced ? [{ k: 'race', v: 'unsynchronized writes', tone: STATE_HEX.BLOCKED }] : []),
        ],
      }
    }
  }
}

export function Tooltip() {
  const hover = useColony((s) => s.hover)
  const ref = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<ReturnType<typeof describe>>(null)

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  useEffect(() => {
    if (!hover) return setInfo(null)
    setInfo(describe(hover))
    const id = window.setInterval(() => setInfo(describe(hover)), 150)
    return () => clearInterval(id)
  }, [hover])

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
  }, [hover])

  return (
    <div ref={ref} className="tooltip" data-visible={!!info}>
      {info && (
        <>
          <div className="tt-title">{info.title}</div>
          {info.rows.map((r) => (
            <div key={r.k} className="tt-row">
              <span className="tt-k">{r.k}</span>
              <span className="tt-v" style={r.tone ? { color: r.tone } : undefined}>
                {r.v}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
