import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Vector3 } from 'three'
import { session } from '../simulation/session'
import { creatures } from './registry'

const LIFE = 2.2

interface Badge {
  el: HTMLDivElement
  pos: Vector3
  born: number
}

/**
 * The response a goroutine finished with, floated above where it ended —
 * "201 RESERVED", "409". Only shown when the producer reports a status; the
 * text is the producer's, never the renderer's.
 */
export function ResultBadges() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const layer = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'badges'
    return el
  }, [])
  const badges = useMemo<Badge[]>(() => [], [])

  useEffect(() => {
    const host = gl.domElement.parentElement ?? document.body
    host.appendChild(layer)
    return () => {
      layer.remove()
      badges.length = 0
    }
  }, [gl, layer, badges])

  useEffect(
    () =>
      session.bus.subscribe((e) => {
        if (e.type !== 'GOROUTINE_DONE' || !e.status) return
        const c = creatures.get(e.gid)
        if (!c) return
        const el = document.createElement('div')
        const success = e.outcome === 'success'
        el.className = `badge badge-${e.outcome ?? 'error'}`
        el.textContent = success ? e.status : e.status.split(' ')[0]
        layer.appendChild(el)
        badges.push({ el, pos: new Vector3(c.pos.x, c.bodyY + 0.55 * c.size, c.pos.z), born: session.clock })
      }),
    [layer, badges],
  )

  const v = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const now = session.clock
    for (let i = badges.length - 1; i >= 0; i--) {
      const b = badges[i]
      const age = (now - b.born) / LIFE
      if (age >= 1) {
        b.el.remove()
        badges.splice(i, 1)
        continue
      }
      v.copy(b.pos)
      v.y += age * 0.6
      v.project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      const fade = age < 0.12 ? age / 0.12 : 1 - Math.max(0, (age - 0.6) / 0.4)
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`
      b.el.style.opacity = String(fade)
    }
  })

  return null
}
