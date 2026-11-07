import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import base from '../playwright.config'

const HERE = fileURLToPath(new URL('.', import.meta.url))

const serverList = (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
  ...server,
  cwd: server.cwd ? resolve(HERE, '..', server.cwd) : resolve(HERE, '..')
}))

export default defineConfig({
  ...base,
  testDir: './e2e',
  webServer: serverList,
  projects: [{ name: 'webkit', use: { ...devices['iPhone 13'] } }]
})
