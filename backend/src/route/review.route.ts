import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { orgOf } from '../lib/session-guard.js'
import { parse, parseId } from '../lib/validate.js'
import { newReviewSchema, renameReviewSchema, saveReviewSchema, testConfigSchema } from '../schema/review.schema.js'
import type { ReviewService } from '../service/review.service.js'
import { FIELD, SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'
import { ROUTE } from '../utils/constants.js'

// A request without a body: nothing parsed, or an empty JSON object.
function isEmptyBody(body: unknown): boolean {
  return body === undefined || body === null ||
    (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0)
}

export function createReviewRouter(service: ReviewService): Router {
  const router = Router()

  router.get(ROUTE.root, asyncHandler(async (req, res) => {
    res.json(await service.list(orgOf(req)))
  }))

  router.post(ROUTE.root, asyncHandler(async (req, res) => {
    const input = parse(newReviewSchema, req.body, SUBJECT.review)
    res.status(HttpStatus.Accepted).json(await service.create(orgOf(req), input))
  }))

  router.get(ROUTE.id, asyncHandler(async (req, res) => {
    res.json(await service.get(orgOf(req), parseId(req.params.id, FIELD.id)))
  }))

  router.put(ROUTE.id, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, FIELD.id)
    res.json(await service.save(orgOf(req), id, parse(saveReviewSchema, req.body, SUBJECT.review)))
  }))

  router.patch(ROUTE.id, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, FIELD.id)
    res.json(await service.rename(orgOf(req), id, parse(renameReviewSchema, req.body, SUBJECT.review).name))
  }))

  router.delete(ROUTE.id, asyncHandler(async (req, res) => {
    await service.remove(orgOf(req), parseId(req.params.id, FIELD.id))
    res.status(HttpStatus.NoContent).end()
  }))

  router.post(ROUTE.run, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, FIELD.id)
    const input = parse(saveReviewSchema, req.body, SUBJECT.review)
    res.status(HttpStatus.Accepted).json(await service.run(orgOf(req), id, input))
  }))

  // Plan 034: the body is an optional TestConfig; no body, or an empty object, means none.
  router.post(ROUTE.generatedTest, asyncHandler(async (req, res) => {
    const id = parseId(req.params.id, FIELD.id)
    const testConfig = isEmptyBody(req.body) ? undefined : parse(testConfigSchema, req.body, SUBJECT.testConfig)
    res.json(await service.regenerateTest(orgOf(req), id, testConfig))
  }))

  return router
}
