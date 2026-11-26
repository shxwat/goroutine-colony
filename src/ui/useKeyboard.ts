import { useEffect } from 'react'
import { SCENARIOS } from '../scenarios'
import { useColony } from '../store/colonyStore'

/** Keyboard shortcuts: SPACE pause · R replay · M sound · 1–5 scenarios · ←/→ prev/next scenario · ESC stop following. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = useColony.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        s.togglePause()
      } else if (e.key === 'r' || e.key === 'R') s.replay()
      else if (e.key === 'm' || e.key === 'M') s.toggleMute()
      else if (e.key === 'Escape') s.select(null)
      else if (/^[1-9]$/.test(e.key) && !s.live) {
        const sc = SCENARIOS[+e.key - 1]
        if (sc) s.setScenario(sc.id)
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !s.live) {
        const i = SCENARIOS.findIndex((sc) => sc.id === s.scenarioId)
        const step = e.key === 'ArrowRight' ? 1 : -1
        const next = SCENARIOS[(i + step + SCENARIOS.length) % SCENARIOS.length]
        s.setScenario(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
