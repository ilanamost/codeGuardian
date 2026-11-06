import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv } from 'ajv'
import { parse } from 'yaml'
import { expect } from 'vitest'
import type { Response } from 'supertest'

// Checks a Supertest response against `.orchestrate/api-contract.yaml`: the status must be
// declared for that path and method, and a JSON body must match the declared schema.

type Json = Record<string, unknown>

const contractPath = fileURLToPath(new URL('../../../.orchestrate/api-contract.yaml', import.meta.url))
export const contract = parse(readFileSync(contractPath, 'utf8')) as Json

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
ajv.addSchema({ $id: 'contract', components: contract.components })

// Point local `#/components/...` refs at the registered contract document.
function rebase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rebase)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === '$ref' && typeof item === 'string' ? item.replace(/^#/, 'contract#') : rebase(item)
    ]))
  }
  return value
}

function resolve(value: unknown): Json {
  let current = value as Json
  while (typeof current.$ref === 'string') {
    const pointer = current.$ref.replace(/^#\//, '').split('/')
    current = pointer.reduce<Json>((node, key) => node[key] as Json, contract)
  }
  return current
}

export function operationOf(path: string, method: string): Json {
  const pathItem = (contract.paths as Json)[path] as Json | undefined
  const operation = pathItem?.[method.toLowerCase()] as Json | undefined
  if (!operation) throw new Error(`The contract has no ${method} ${path}.`)
  return operation
}

export function expectContract(response: Response, path: string, method: string): void {
  const responseMap = operationOf(path, method).responses as Json
  const declared = responseMap[String(response.status)] ?? (response.status >= 300 ? responseMap.default : undefined)
  expect(declared, `${method} ${path} does not declare status ${response.status}`).toBeDefined()

  const schema = (resolve(declared).content as Json | undefined)?.['application/json'] as Json | undefined
  if (!schema?.schema) {
    expect(response.text ?? '', `${method} ${path} ${response.status} should have no body`).toBe('')
    return
  }
  const validate = ajv.compile(rebase(schema.schema) as object)
  const valid = validate(response.body)
  expect(validate.errors ?? [], `${method} ${path} ${response.status} body does not match the contract`).toEqual([])
  expect(valid).toBe(true)
}

// Every error response: the standard shape, and requestId equal to the x-request-id header.
export function expectError(response: Response, status: number, code: string): void {
  expect(response.status).toBe(status)
  expect(response.body.error.code).toBe(code)
  expect(typeof response.body.error.message).toBe('string')
  expect(response.body.requestId).toBe(response.headers['x-request-id'])
}
