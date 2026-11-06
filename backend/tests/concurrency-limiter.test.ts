import { describe, expect, it } from 'vitest'
import { createConcurrencyLimiter } from '../src/lib/concurrency-limiter.js'

describe('concurrency limiter (plan 039)', () => {
  it('runs up to max at once and queues the rest in FIFO order', async () => {
    const limiter = createConcurrencyLimiter(2)
    const first = limiter.acquire()
    const second = limiter.acquire()
    const third = limiter.acquire()
    const fourth = limiter.acquire()

    expect([first.queued, second.queued, third.queued, fourth.queued]).toEqual([false, false, true, true])
    expect(limiter.count()).toEqual({ active: 2, waiting: 2 })

    const order: string[] = []
    void third.granted.then(() => order.push('third'))
    void fourth.granted.then(() => order.push('fourth'))
    limiter.release()
    await third.granted
    expect(limiter.count()).toEqual({ active: 2, waiting: 1 })
    limiter.release()
    await fourth.granted
    expect(order).toEqual(['third', 'fourth'])
  })

  it('never goes below zero on a surplus release', () => {
    const limiter = createConcurrencyLimiter(1)
    limiter.release()
    expect(limiter.count().active).toBe(0)
    expect(limiter.acquire().queued).toBe(false)
  })
})
