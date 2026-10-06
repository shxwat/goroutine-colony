import { go, type Program } from '../simulation/program'
import type { Scenario } from './types'

function* increment(side: 'l' | 'r', warmup: number): Program {
  yield go.move(`counter.${side}`, 14)
  if (warmup) yield go.work(warmup, 14)
  for (let i = 0; i < 3; i++) {
    const v = yield go.read('counter', 15)
    yield go.work(0.55, 16)
    yield go.write('counter', v + 1, 17)
    yield go.work(0.25, 14)
  }
  yield go.wgDone('wg', 13)
}

export const race: Scenario = {
  id: 'race',
  label: 'RACE',
  caption: 'counter++ is read, add, write. two goroutines, no lock',
  code: [
    'var counter int',
    '',
    'func main() {',
    '    var wg sync.WaitGroup',
    '    wg.Add(2)',
    '    go increment(&wg)',
    '    go increment(&wg)',
    '    wg.Wait()',
    '    fmt.Println(counter) // want 6',
    '}',
    '',
    'func increment(wg *sync.WaitGroup) {',
    '    defer wg.Done()',
    '    for range 3 {',
    '        v := counter // read',
    '        v = v + 1',
    '        counter = v  // write: no lock!',
    '    }',
    '}',
  ],
  shot: { target: [0, 0.95, 1.0], distance: 7.8, elevation: 0.36, azimuth: 0 },
  hold: 6,
  *main() {
    yield go.alloc('counter', 0, { pos: [0, 0.6] }, 1)
    yield go.wgAdd('wg', 2, 5)
    yield go.spawn('main.increment', increment('l', 0), 6)
    yield go.spawn('main.increment', increment('r', 1.3), 7)
    yield go.wgWait('wg', 8)
    const counter = yield go.read('counter', 9)
    yield go.print(`${counter}`, 9)
  },
}
