import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import type { TestService } from '../service/test.service.js'
import { HttpStatus } from '../utils/http-status.js'
import { ROUTE } from '../utils/constants.js'

// Test-only router. `createApp` mounts it only when the config flag `enableTestRoute` is on;
// otherwise these paths fall through to the normal 404 `not_found`.
export function createTestRouter(service: TestService): Router {
  const router = Router()

  router.post(ROUTE.reset, asyncHandler(async (_req, res) => {
    await service.reset()
    res.status(HttpStatus.NoContent).end()
  }))

  return router
}
