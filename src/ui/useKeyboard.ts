import { useEffect } from 'react'
import { SCENARIOS } from '../scenarios'
import { useColony } from '../store/colonyStore'

/** SPACE pause · R replay · M sound · 1–5 scenarios · ESC stop following. */
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
