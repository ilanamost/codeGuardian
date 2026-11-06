import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { orgOf } from '../lib/session-guard.js'
import { parse } from '../lib/validate.js'
import { supportRequestSchema } from '../schema/support.schema.js'
import type { SupportService } from '../service/support.service.js'
import { SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'
import { ROUTE } from '../utils/constants.js'

export function createSupportRouter(service: SupportService): Router {
  const router = Router()

  router.post(ROUTE.root, asyncHandler(async (req, res) => {
    res.status(HttpStatus.Created).json(await service.create(orgOf(req), parse(supportRequestSchema, req.body, SUBJECT.supportRequest)))
  }))

  return router
}
