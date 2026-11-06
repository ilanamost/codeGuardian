import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import { contract, expectContract } from './helper/contract.js'

const fake = (status: number, body: unknown, text = JSON.stringify(body)) => ({ status, body, text }) as unknown as Response

type Operation = { security?: unknown[], parameters?: { $ref?: string }[], responses?: Record<string, unknown> }

function operationList(): [string, Operation][] {
  return Object.entries(contract.paths as Record<string, Record<string, Operation>>).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => method !== 'parameters').map(([method, operation]) => [`${method.toUpperCase()} ${path}`, operation] as [string, Operation]))
}

function publicOperationList(): string[] {
  return operationList().filter(([, operation]) => Array.isArray(operation.security) && operation.security.length === 0).map(([label]) => label)
}

describe('contract helper', () => {
  it('is on contract version 0.17.0', () => {
    expect((contract.info as { version: string }).version).toBe('0.17.0')
  })

  it('requires the session cookie globally, with only the public routes marked security: [] (plan 028)', () => {
    expect(contract.security).toEqual([{ sessionCookie: [] }])
    const scheme = (contract.components as { securitySchemes: Record<string, unknown> }).securitySchemes.sessionCookie
    expect(scheme).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'cr_session' })
    expect(publicOperationList().sort()).toEqual([
      'GET /api/auth/github', 'GET /api/auth/github/callback', 'GET /api/health', 'GET /api/session', 'POST /api/account', 'POST /api/session', 'POST /api/test/reset'
    ])
  })

  it('declares 401 on every protected operation, and the CSRF header and 403 on every state-changing one', () => {
    const missing: string[] = []
    const publicList = publicOperationList()
    for (const [label, operation] of operationList()) {
      const responses = operation.responses ?? {}
      if (!publicList.includes(label) && !responses['401']) missing.push(`${label} 401`)
      if (/^(POST|PUT|PATCH|DELETE) /.test(label)) {
        const hasHeader = (operation.parameters ?? []).some((item) => item.$ref === '#/components/parameters/CsrfHeader')
        if (!hasHeader) missing.push(`${label} X-CSRF-Protection`)
        if (!responses['403']) missing.push(`${label} 403`)
      }
    }
    expect(missing).toEqual([])
  })

  it('no longer has the sign-out route of 0.4.0', () => {
    expect((contract.paths as Record<string, unknown>)['/api/account/sign-out']).toBeUndefined()
  })

  it('declares a default error response on every operation (QA round 1, D4)', () => {
    const missing: string[] = []
    for (const [path, item] of Object.entries(contract.paths as Record<string, Record<string, { responses?: Record<string, unknown> }>>)) {
      for (const [method, operation] of Object.entries(item)) {
        if (method !== 'parameters' && !operation.responses?.default) missing.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('accepts a body that matches the schema', () => {
    expect(() => expectContract(fake(200, { login: 'octocat', name: null }), '/api/github/connect', 'POST')).not.toThrow()
  })

  it('rejects a body that breaks the schema', () => {
    expect(() => expectContract(fake(200, { email: 'a@b.co' }), '/api/github/connect', 'POST')).toThrow()
    expect(() => expectContract(fake(200, [{ id: 'x', name: 'y' }]), '/api/github/repo', 'GET')).toThrow()
    // Plan 030: the list routes are { items, truncated }, and a GitHub field outside the contract is refused.
    expect(() => expectContract(fake(200, []), '/api/github/repo', 'GET')).toThrow()
    expect(() => expectContract(fake(200, { items: [{ id: 'x', name: 'x', description: '', html_url: 'u' }], truncated: false }), '/api/github/repo', 'GET')).toThrow()
    expect(() => expectContract(fake(200, { login: 'o', name: null, avatar_url: 'u' }), '/api/github/connect', 'POST')).toThrow()
  })

  it('rejects a status the operation does not declare', () => {
    expect(() => expectContract(fake(201, { email: 'a@b.co' }), '/api/github/connect', 'POST')).toThrow()
  })

  it('has a test file that checks every contract operation', () => {
    const testDir = fileURLToPath(new URL('.', import.meta.url))
    const source = readdirSync(testDir).filter((name) => name.endsWith('.test.ts') && name !== 'contract.test.ts')
      .map((name) => readFileSync(`${testDir}/${name}`, 'utf8')).join('\n')
    const missing: string[] = []
    for (const [path, item] of Object.entries(contract.paths as Record<string, Record<string, unknown>>)) {
      for (const method of Object.keys(item).filter((key) => key !== 'parameters')) {
        const call = `expectContract(response, '${path}', '${method.toUpperCase()}')`
        if (!source.includes(call)) missing.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(missing).toEqual([])
  })
})
