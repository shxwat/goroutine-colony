import type { ColonyEvent } from './events'

type Listener = (e: ColonyEvent) => void

/** Tiny synchronous pub/sub. Listeners run in dispatch order, after World.apply. */
export class EventBus {
  private listeners = new Set<Listener>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  publish(e: ColonyEvent) {
    for (const fn of this.listeners) fn(e)
  }
}
