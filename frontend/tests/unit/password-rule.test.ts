// @vitest-environment node
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CSRF_HEADER } from '../../src/lib/api.constants'
import { COMMON_PASSWORD_LIST } from '../../src/lib/common-password'
import { passwordRuleCheck, passwordRuleError } from '../../src/lib/password-rule'
import { hasFieldError, validateRegistration, validateSignIn } from '../../src/lib/sessionForm'
import { AppError } from '../../src/models/app-error'
import { createApiService, type FetchFn } from '../../src/services/api.service'

// Plan 028, Open Question 7: the password rules and the common-password list are the backend's.
const owner = { username: 'grace.h', email: 'grace@example.com' }

describe('password rules', () => {
  it('passes a password that follows every rule', () => {
    expect(passwordRuleCheck('brand-new-1', owner)).toEqual({ length: true, letterDigit: true, personal: true, common: true })
    expect(passwordRuleError('brand-new-1', owner)).toBeUndefined()
  })

  it.each([
    ['short1', 'Password must be 8 to 200 characters.'],
    ['a1'.repeat(101), 'Password must be 8 to 200 characters.'],
    ['12345678901', 'Password must contain at least one letter and one digit.'],
    ['no-digits-at-all', 'Password must contain at least one letter and one digit.'],
    ['GRACE@example.com', 'Password must contain at least one letter and one digit.'],
    ['password123', 'This password is too common. Choose another one.'],
    ['P@ssw0rd', 'This password is too common. Choose another one.']
  ])('%s is refused: %s', (password, message) => {
    expect(passwordRuleError(password, owner)).toBe(message)
  })

  it('refuses the user name or the email, in any case', () => {
    expect(passwordRuleError('Grace.H1', { username: 'grace.h1', email: 'g@example.com' })).toBe('Password must not be your user name or email address.')
    expect(passwordRuleError('G1@EXAMPLE.COM', { username: 'grace', email: ' g1@example.com ' })).toBe('Password must not be your user name or email address.')
  })

  it('counts any letter, not only ASCII ones', () => {
    expect(passwordRuleCheck('пароль-12', owner).letterDigit).toBe(true)
  })

  it('keeps the same common-password list as the backend', async () => {
    const backend = (await import(/* @vite-ignore */ resolve(__dirname, '../../../backend/src/utils/common-password.ts'))) as { COMMON_PASSWORD_LIST: readonly string[] }
    expect(COMMON_PASSWORD_LIST).toEqual(backend.COMMON_PASSWORD_LIST)
    expect(COMMON_PASSWORD_LIST.every((entry) => entry === entry.toLowerCase())).toBe(true)
  })
})

describe('login and register form checks', () => {
  it('sign-in: both fields required, the user name trimmed', () => {
    expect(validateSignIn('   ', '')).toEqual({ username: 'Enter your user name.', password: 'Enter your password.' })
    expect(validateSignIn(' john.doe ', 'x')).toEqual({})
    expect(validateSignIn('a'.repeat(65), 'x'.repeat(201))).toEqual({ username: 'Use at most 64 characters.', password: 'Password must be at most 200 characters.' })
  })

  it('registration: the contract limits and the confirm field', () => {
    const valid = { username: 'grace.h', email: 'grace@example.com', password: 'brand-new-1', confirmPassword: 'brand-new-1' }
    expect(hasFieldError(validateRegistration(valid))).toBe(false)
    expect(validateRegistration({ ...valid, username: 'a'.repeat(33) }).username).toBe('User name must be 3 to 32 characters.')
    expect(validateRegistration({ ...valid, username: 'grace!' }).username).toBe('Use letters, numbers, dots, dashes and underscores only.')
    expect(validateRegistration({ ...valid, email: `${'a'.repeat(250)}@b.co` }).email).toBe('Email address must be at most 254 characters.')
    expect(validateRegistration({ ...valid, email: 'grace@' }).email).toBe('Enter a valid email address')
    expect(validateRegistration({ ...valid, confirmPassword: 'other-one-1' }).confirmPassword).toBe('Passwords do not match.')
  })
})

describe('api.service and the session (plan 028)', () => {
  function capture() {
    const fetchFn = vi.fn<FetchFn>(async () => new Response(null, { status: 204 }))
    return { fetchFn, source: createApiService({ baseUrl: 'http://api.test', fetchFn }) }
  }

  it('sends the cookie on every request and X-CSRF-Protection only on state-changing ones', async () => {
    const { fetchFn, source } = capture()

    await source.request('GET', '/api/session')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) await source.request(method, '/api/x', method === 'DELETE' ? undefined : { a: 1 })

    const [getInit, ...writeInitList] = fetchFn.mock.calls.map(([, init]) => init)
    expect(getInit.credentials).toBe('include')
    expect(getInit.headers).not.toHaveProperty(CSRF_HEADER.name)
    for (const init of writeInitList) {
      expect(init.credentials).toBe('include')
      expect(init.headers).toMatchObject({ [CSRF_HEADER.name]: CSRF_HEADER.value })
    }
  })

  it('sends a Blob body raw with its Content-Type, not as JSON', async () => {
    const { fetchFn, source } = capture()
    const photo = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })

    await source.request('PUT', '/api/account/avatar', photo, { contentType: 'image/png' })

    const init = fetchFn.mock.calls[0][1]
    expect(init.body).toBe(photo)
    expect(init.headers).toMatchObject({ 'Content-Type': 'image/png', [CSRF_HEADER.name]: '1' })
  })

  it('keeps the wait time of a 429 (details.retryAfterSecond)', () => {
    const error = AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'x', details: { retryAfterSecond: 90 } } })

    expect(error.retryAfterSecond).toBe(90)
    expect(AppError.fromJson(error.toJSON()).retryAfterSecond).toBe(90)
    expect(AppError.fromResponse(429, { error: { code: 'rate_limited', message: 'x', details: { retryAfterSecond: 'soon' } } }).retryAfterSecond).toBeUndefined()
  })
})
