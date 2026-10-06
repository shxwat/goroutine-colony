import { go, type Program } from '../simulation/program'
import type { Scenario } from './types'

function* deposit(amount: number): Program {
  yield go.move('mu.gate', 17)
  yield go.lock('mu', 17)
  yield go.move('mu.inside', 17)
  const b = yield go.read('balance', 18)
  yield go.work(0.35, 19)
  yield go.write('balance', b + amount, 19)
  yield go.work(0.3, 20)
  yield go.unlock('mu', 20)
  yield go.wgDone('wg', 16)
}

export const mutex: Scenario = {
  id: 'mutex',
  label: 'MUTEX',
  caption: 'one goroutine inside the lock. everyone else queues at the gate',
  code: [
    'var (',
    '    mu      sync.Mutex',
    '    balance int',
    ')',
    '',
    'func main() {',
    '    var wg sync.WaitGroup',
    '    for range 5 {',
    '        wg.Add(1)',
    '        go deposit(&wg, 100)',
    '    }',
    '    wg.Wait()',
    '    fmt.Println(balance)',
    '}',
    '',
    'func deposit(wg *sync.WaitGroup, amt int) {',
    '    defer wg.Done()',
    '    mu.Lock()',
    '    b := balance',
    '    balance = b + amt',
    '    mu.Unlock()',
    '}',
  ],
  shot: { target: [-0.4, 0.7, 0.9], distance: 8.8, elevation: 0.46, azimuth: -0.12 },
  hold: 3,
  *main() {
    yield go.makeMutex('mu', { pos: [0.9, 0.5], gate: -Math.PI / 2 }, 2)
    yield go.alloc('balance', 0, { pos: [0.9, 0.5] }, 3)
    for (let i = 0; i < 5; i++) {
      yield go.wgAdd('wg', 1, 9)
      yield go.spawn('main.deposit', deposit(100), 10)
      yield go.work(0.2, 10)
    }
    yield go.wgWait('wg', 12)
    yield go.print('500', 13)
  },
}
