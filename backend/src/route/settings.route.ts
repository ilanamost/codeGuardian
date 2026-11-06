import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { orgOf } from '../lib/session-guard.js'
import { parse } from '../lib/validate.js'
import { settingsSchema } from '../schema/settings.schema.js'
import type { SettingsService } from '../service/settings.service.js'
import { SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'
import { ROUTE } from '../utils/constants.js'

export function createSettingsRouter(service: SettingsService): Router {
  const router = Router()

  router.get(ROUTE.root, asyncHandler(async (req, res) => {
    res.json(await service.get(orgOf(req)))
  }))

  router.put(ROUTE.root, asyncHandler(async (req, res) => {
    await service.save(orgOf(req), parse(settingsSchema, req.body, SUBJECT.settings))
    res.status(HttpStatus.NoContent).end()
  }))

  return router
}
