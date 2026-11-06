import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Static checks for the layering rules of plan 016.
const srcDir = resolve(__dirname, '../../src')

function sourceFileList(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFileList(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

const fileList = sourceFileList(srcDir).map((path) => ({
  path: relative(srcDir, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8')
}))

const appFileList = fileList

function filesMatching(pattern: RegExp, allowed: string[]) {
  return appFileList.filter((file) => !allowed.includes(file.path) && pattern.test(file.text)).map((file) => file.path)
}

describe('layering', () => {
  it('calls fetch only in services/api.service.ts', () => {
    expect(filesMatching(/\bfetch\s*\(/, ['services/api.service.ts'])).toEqual([])
  })

  it('touches localStorage only in services/storage.service.ts', () => {
    expect(filesMatching(/localStorage/, ['services/storage.service.ts'])).toEqual([])
  })

  it('raises error toasts only in services/notification.service.ts', () => {
    expect(filesMatching(/toast\.error\s*\(/, ['services/notification.service.ts'])).toEqual([])
  })

  it('keeps every error text in utils/error-messages.ts', () => {
    const errorText = /['"`](Could not|Unable to|Failed to|Something went wrong|Request timed out|Passwords do not match|Password must be|Select an issue type|Enter a valid|Use letters, numbers)[^'"`]*['"`]/
    // The Help page's "Error messages" table quotes these texts to explain them (static content).
    expect(filesMatching(errorText, ['utils/error-messages.ts', 'lib/help.constants.ts'])).toEqual([])
  })

  it('keeps thunks and components away from the API and storage services', () => {
    const offender = appFileList
      .filter((file) => /^(store|components|pages)\//.test(file.path))
      .filter((file) => /from '\.\.\/services\/(api|storage)\.service'/.test(file.text))
      .map((file) => file.path)
    expect(offender).toEqual([])
  })

  // Plan 035: the app has one data source, the HTTP API. Sample data lives in tests/ only.
  it('has no mock data folder or JSON data source in the app, and imports nothing from tests/', () => {
    expect(existsSync(join(srcDir, 'mocks'))).toBe(false)
    expect(readdirSync(join(srcDir, 'services')).filter((name) => name.startsWith('json-'))).toEqual([])
    expect(fileList.filter((file) => /from '(\.\.\/)+(tests|mocks)\//.test(file.text)).map((file) => file.path)).toEqual([])
  })

  it('has no trailing semicolons in the new layers', () => {
    const offender = fileList
      .filter((file) => /^(models|services|store|utils)\//.test(file.path))
      .filter((file) => file.text.split('\n').some((line) => /;\s*$/.test(line) && !/^\s*(\/\/|\*)/.test(line)))
      .map((file) => file.path)
    expect(offender).toEqual([])
  })
})
