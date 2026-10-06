import { at } from '../simulation/layout'
import { go, type Program } from '../simulation/program'
import type { Scenario } from './types'

function* transfer(from: string, to: string): Program {
  yield go.move(`${from}.gate`, 16)
  yield go.lock(from, 16)
  yield go.move(`${from}.inside`, 17)
  yield go.sleep(0.7, 18)
  yield go.move(`${to}.gate`, 19)
  yield go.lock(to, 19) // never returns
  yield go.unlock(to, 20)
  yield go.unlock(from, 17)
  yield go.wgDone('wg', 15)
}

function* worker(route: [number, number][], beat: number): Program {
  for (const [x, z] of route) {
    yield go.move(at(x, z), 25)
    yield go.work(beat, 25)
  }
  yield go.wgDone('wg', 24)
}

export const deadlock: Scenario = {
  id: 'deadlock',
  label: 'DEADLOCK',
  caption: 'each holds one lock and waits for the other. nobody can move',
  code: [
    'var muA, muB sync.Mutex',
    '',
    'func main() {',
    '    var wg sync.WaitGroup',
    '    wg.Add(5)',
    '    for range 3 {',
    '        go worker(&wg)',
    '    }',
    '    go transfer(&muA, &muB, &wg)',
    '    go transfer(&muB, &muA, &wg)',
    '    wg.Wait()',
    '}',
    '',
    'func transfer(from, to *sync.Mutex, wg *sync.WaitGroup) {',
    '    defer wg.Done()',
    '    from.Lock()',
    '    defer from.Unlock()',
    '    time.Sleep(10 * time.Millisecond)',
    '    to.Lock() // waits for the other one',
    '    defer to.Unlock()',
    '}',
    '',
    'func worker(wg *sync.WaitGroup) {',
    '    defer wg.Done()',
    '    doWork()',
    '}',
  ],
  shot: { target: [0, 0.5, 0.9], distance: 10.4, elevation: 0.5, azimuth: 0 },
  hold: 12,
  *main() {
    yield go.makeMutex('muA', { pos: [-3.1, -0.2], gate: Math.PI / 2 }, 1)
    yield go.makeMutex('muB', { pos: [3.1, -0.2], gate: -Math.PI / 2 }, 1)
    yield go.wgAdd('wg', 5, 5)
    // the two transfers lead; the workers keep the colony busy until they run out of work
    yield go.spawn('main.transfer', transfer('muA', 'muB'), 9)
    yield go.spawn('main.transfer', transfer('muB', 'muA'), 10)
    yield go.step(6)
    yield go.spawn('main.worker', worker([[-4.4, 2.4], [-1.6, 3.2]], 0.5), 7)
    yield go.spawn('main.worker', worker([[4.6, 2.4], [1.6, 3.4]], 0.9), 7)
    yield go.spawn('main.worker', worker([[-1.8, -2.6], [2.4, 2.6], [0.2, 3.6]], 0.5), 7)
    yield go.wgWait('wg', 11)
  },
}
