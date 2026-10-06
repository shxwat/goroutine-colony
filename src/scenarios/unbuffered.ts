import { at } from '../simulation/layout'
import { go, type Program } from '../simulation/program'
import type { Scenario } from './types'

const BENCH = at(-5.4, 2.6)
const DESK = at(5.4, 2.6)

function* producer(): Program {
  for (let i = 1; i <= 3; i++) {
    yield go.move(BENCH, 11)
    yield go.work(i === 3 ? 3.4 : 0.9, 12)
    const job = yield go.hold(`job ${i}`, 12)
    yield go.move('jobs.send', 13)
    yield go.send('jobs', job, 13)
  }
  yield go.wgDone('wg', 10)
}

function* consumer(): Program {
  yield go.move(DESK, 19)
  yield go.sleep(3, 19)
  for (let i = 0; i < 3; i++) {
    yield go.move('jobs.recv', 21)
    const job = yield go.recv('jobs', 21)
    yield go.move(DESK, 22)
    yield go.work(0.9, 22)
    yield go.consume(job, 22)
  }
  yield go.wgDone('wg', 18)
}

export const unbuffered: Scenario = {
  id: 'channel',
  label: 'CHANNEL',
  caption: 'unbuffered: a send waits until someone is there to receive',
  code: [
    'func main() {',
    '    jobs := make(chan Job) // unbuffered',
    '    wg.Add(2)',
    '    go producer(jobs)',
    '    go consumer(jobs)',
    '    wg.Wait()',
    '}',
    '',
    'func producer(jobs chan<- Job) {',
    '    defer wg.Done()',
    '    for i := 1; i <= 3; i++ {',
    '        job := build(i)',
    '        jobs <- job // blocks until received',
    '    }',
    '}',
    '',
    'func consumer(jobs <-chan Job) {',
    '    defer wg.Done()',
    '    time.Sleep(warmup)',
    '    for range 3 {',
    '        job := <-jobs',
    '        process(job)',
    '    }',
    '}',
  ],
  shot: { target: [0, 0.5, 1.2], distance: 9.4, elevation: 0.42, azimuth: 0 },
  hold: 2.5,
  *main() {
    yield go.makeChan('jobs', 'Job', 0, { from: [-3.1, 0.9], to: [3.1, 0.9] }, 2)
    yield go.wgAdd('wg', 2, 3)
    yield go.spawn('main.producer', producer(), 4)
    yield go.spawn('main.consumer', consumer(), 5)
    yield go.wgWait('wg', 6)
  },
}
