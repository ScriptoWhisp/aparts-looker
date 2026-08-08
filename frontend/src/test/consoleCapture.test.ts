/**
 * consoleCapture.test.ts — ring buffer + monkey-patch coverage.
 *
 * console.* is a module-level singleton patch (init() is idempotent), so
 * every test calls __resetForTests() first to clear the buffer without
 * un-patching — the patch only needs to happen once per process.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { init, getRecentLogs, __resetForTests } from '@/lib/consoleCapture'

describe('consoleCapture', () => {
  beforeEach(() => {
    init()
    __resetForTests()
  })

  it('is idempotent — calling init() twice does not double-patch', () => {
    init()
    console.log('once')
    expect(getRecentLogs()).toHaveLength(1)
  })

  it('captures console.log with level=log', () => {
    console.log('hello world')
    const logs = getRecentLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBe('log')
    expect(logs[0].args).toEqual(['hello world'])
  })

  it('captures console.warn with level=warn', () => {
    console.warn('careful')
    expect(getRecentLogs()[0].level).toBe('warn')
  })

  it('captures console.error with level=error', () => {
    console.error('boom')
    expect(getRecentLogs()[0].level).toBe('error')
  })

  it('captures console.info with level=info', () => {
    console.info('fyi')
    expect(getRecentLogs()[0].level).toBe('info')
  })

  it('includes an ISO timestamp on every entry', () => {
    console.log('x')
    const [entry] = getRecentLogs()
    expect(() => new Date(entry.ts).toISOString()).not.toThrow()
  })

  it('serializes multiple args to strings', () => {
    console.log('count:', 42, { a: 1 })
    const [entry] = getRecentLogs()
    expect(entry.args).toEqual(['count:', '42', '{"a":1}'])
  })

  it('serializes Error instances to "Name: message"', () => {
    console.error(new Error('bad thing'))
    const [entry] = getRecentLogs()
    expect(entry.args[0]).toBe('Error: bad thing')
  })

  it('truncates a single arg at 500 chars', () => {
    console.log('x'.repeat(1000))
    const [entry] = getRecentLogs()
    expect(entry.args[0]).toHaveLength(500)
  })

  it('caps the ring buffer at 50 entries, keeping the most recent', () => {
    for (let i = 0; i < 60; i++) console.log(`entry-${i}`)
    const logs = getRecentLogs()
    expect(logs).toHaveLength(50)
    expect(logs[0].args[0]).toBe('entry-10') // oldest 10 evicted
    expect(logs[49].args[0]).toBe('entry-59')
  })

  it('getRecentLogs returns a snapshot copy, not a live reference', () => {
    console.log('one')
    const snapshot = getRecentLogs()
    console.log('two')
    expect(snapshot).toHaveLength(1)
    expect(getRecentLogs()).toHaveLength(2)
  })

  it('never throws on a circular object argument', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => console.log(circular)).not.toThrow()
    expect(getRecentLogs()[0].args[0]).toBe('[unserializable]')
  })
})
