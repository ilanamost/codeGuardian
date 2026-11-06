import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { orgOf } from '../lib/session-guard.js'
import type { DashboardService } from '../service/dashboard.service.js'
import { ROUTE } from '../utils/constants.js'

export function createDashboardRouter(service: DashboardService): Router {
  const router = Router()

  router.get(ROUTE.root, asyncHandler(async (req, res) => {
    res.json(await service.get(orgOf(req)))
  }))

  return router
}
