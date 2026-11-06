import { randomBytes, scryptSync, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { PASSWORD_HASH } from '../utils/constants.js'

// Passwords are hashed, never encrypted (plan 028, audited by plan 033): stored as
// `scrypt$<salt hex>$<hash hex>` with a new random salt per password, and compared in constant
// time. The plain value is never stored, returned or logged, and the browser sends it as typed
// over HTTPS: a hash made in the browser would simply become the password.

const { scheme, separator, encoding, saltBytes, keyLength } = PASSWORD_HASH

// Pinned (plan 033, Open Question 4): the same values for hashing and for every check, so a
// sign-in, the current-password check of a password change and the dummy check of an unknown
// user name all cost the same.
export const SCRYPT_OPTION: Readonly<ScryptOptions> = Object.freeze({
  N: PASSWORD_HASH.cost,
  r: PASSWORD_HASH.blockSize,
  p: PASSWORD_HASH.parallelization,
  maxmem: PASSWORD_HASH.maxMemory
})

export function hashPassword(password: string): string {
  const salt = randomBytes(saltBytes)
  const hash = scryptSync(password, salt, keyLength, SCRYPT_OPTION)
  return [scheme, salt.toString(encoding), hash.toString(encoding)].join(separator)
}

export function verifyPassword(password: string, stored: string): boolean {
  const [storedScheme, saltText, hashText] = stored.split(separator)
  if (storedScheme !== scheme || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, encoding)
  if (expected.length !== keyLength) return false
  const actual = scryptSync(password, Buffer.from(saltText, encoding), keyLength, SCRYPT_OPTION)
  return timingSafeEqual(actual, expected)
}
