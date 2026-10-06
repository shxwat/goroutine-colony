import { go, type Program } from '../simulation/program'
import type { Scenario } from './types'

function* produce(i: number): Program {
  const job = yield go.hold(`job ${i}`, 14)
  yield go.move('jobs.send', 14)
  yield go.send('jobs', job, 14)
  yield go.wgDone('wg', 13)
}

function* consume(): Program {
  yield go.move('jobs.recv', 19)
  yield go.sleep(3.2, 19)
  for (let i = 0; i < 5; i++) {
    const job = yield go.recv('jobs', 21)
    yield go.work(0.85, 21)
    yield go.consume(job, 21)
  }
  yield go.wgDone('wg', 18)
}

export const buffered: Scenario = {
  id: 'buffer',
  label: 'BUFFER',
  caption: 'make(chan Job, 3) — three slots. the fourth sender waits outside',
  code: [
    'func main() {',
    '    jobs := make(chan Job, 3)',
    '    var wg sync.WaitGroup',
    '    wg.Add(6)',
    '    for i := range 5 {',
    '        go produce(jobs, i, &wg)',
    '    }',
    '    go consume(jobs, &wg)',
    '    wg.Wait()',
    '}',
    '',
    'func produce(jobs chan<- Job, i int, wg *sync.WaitGroup) {',
    '    defer wg.Done()',
    '    jobs <- Job{ID: i} // blocks while buffer is full',
    '}',
    '',
    'func consume(jobs <-chan Job, wg *sync.WaitGroup) {',
    '    defer wg.Done()',
    '    time.Sleep(warmup) // not ready yet',
    '    for range 5 {',
    '        process(<-jobs)',
    '    }',
    '}',
  ],
  shot: { target: [-1.1, 0.5, 1.4], distance: 9.3, elevation: 0.44, azimuth: 0.06 },
  hold: 3,
  *main() {
    yield go.makeChan('jobs', 'Job', 3, { from: [-2.6, 0.9], to: [2.9, 0.9] }, 2)
    yield go.wgAdd('wg', 6, 4)
    for (let i = 1; i <= 5; i++) {
      yield go.step(5)
      yield go.spawn('main.produce', produce(i), 6)
      yield go.work(0.25, 6)
    }
    yield go.spawn('main.consume', consume(), 8)
    yield go.wgWait('wg', 9)
  },
}
