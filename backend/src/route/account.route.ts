import express, { Router, type Request } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { clientIpOf, orgOf, readSessionId } from '../lib/session-guard.js'
import { setSessionCookie, type CookieConfig } from '../lib/session.js'
import { parse } from '../lib/validate.js'
import { accountUpdateSchema, passwordChangeSchema, registrationSchema } from '../schema/account.schema.js'
import type { AccountService } from '../service/account.service.js'
import type { RequestContext } from '../service/session.service.js'
import { SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'
import { AVATAR, HEADER, ROUTE } from '../utils/constants.js'
import { LIMIT } from '../utils/limits.js'

function contextOf(req: Request): RequestContext {
  return { requestId: req.requestId, ip: clientIpOf(req) }
}

// The declared media type without parameters (`image/png; x=y` is `image/png`).
function mediaTypeOf(req: Request): string | undefined {
  return req.get(HEADER.contentType)?.split(';')[0]?.trim().toLowerCase()
}

export function createAccountRouter(service: AccountService, cookie: CookieConfig): Router {
  const router = Router()

  router.get(ROUTE.root, asyncHandler(async (req, res) => {
    res.json(await service.get(orgOf(req)))
  }))

  // Registration (public, plan 028): 201 with the account, signed in.
  router.post(ROUTE.root, asyncHandler(async (req, res) => {
    const input = parse(registrationSchema, req.body, SUBJECT.registration)
    const { account, started } = await service.register(input, readSessionId(req, cookie), contextOf(req))
    setSessionCookie(res, cookie, started.id, started.maxAgeMs)
    res.status(HttpStatus.Created).json(account)
  }))

  // Plan 034: the user name and/or email; the session and its cookie are kept.
  router.put(ROUTE.root, asyncHandler(async (req, res) => {
    const input = parse(accountUpdateSchema, req.body, SUBJECT.accountUpdate)
    res.json(await service.update(orgOf(req), input, contextOf(req)))
  }))

  router.put(ROUTE.password, asyncHandler(async (req, res) => {
    const input = parse(passwordChangeSchema, req.body, SUBJECT.passwordChange)
    const started = await service.changePassword(orgOf(req), input, contextOf(req))
    setSessionCookie(res, cookie, started.id, started.maxAgeMs)
    res.status(HttpStatus.NoContent).end()
  }))

  router.get(ROUTE.avatar, asyncHandler(async (req, res) => {
    const avatar = await service.getAvatar(orgOf(req))
    res.set({
      [HEADER.contentType]: avatar.contentType,
      [HEADER.contentTypeOption]: AVATAR.contentTypeOption,
      [HEADER.contentSecurityPolicy]: AVATAR.contentSecurityPolicy,
      [HEADER.contentDisposition]: AVATAR.contentDisposition,
      [HEADER.cacheControl]: AVATAR.cacheControl
    })
    res.send(avatar.data)
  }))

  // The raw image is the body: `express.raw` only here, at most 2 MB (larger is 413).
  router.put(ROUTE.avatar, express.raw({ type: [...AVATAR.typeList], limit: LIMIT.avatarByte }), asyncHandler(async (req, res) => {
    res.json(await service.setAvatar(orgOf(req), mediaTypeOf(req), req.body))
  }))

  router.delete(ROUTE.avatar, asyncHandler(async (req, res) => {
    res.json(await service.removeAvatar(orgOf(req)))
  }))

  return router
}
