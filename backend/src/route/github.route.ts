import { Router } from 'express'
import { asyncHandler } from '../lib/async-handler.js'
import { orgOf } from '../lib/session-guard.js'
import { parse } from '../lib/validate.js'
import { fileIdSchema, githubConnectSchema, githubImportSchema, repoNameSchema, repoSearchSchema } from '../schema/github.schema.js'
import type { GithubImportService } from '../service/github-import.service.js'
import type { GithubService } from '../service/github.service.js'
import { FIELD, SUBJECT } from '../utils/error-messages.js'
import { HttpStatus } from '../utils/http-status.js'
import { ROUTE } from '../utils/constants.js'

// Every input is checked here (422) before the service makes any GitHub call (plan 030).
export function createGithubRouter(service: GithubService, importService: GithubImportService): Router {
  const router = Router()

  router.post(ROUTE.connect, asyncHandler(async (req, res) => {
    const { username } = parse(githubConnectSchema, req.body, SUBJECT.githubConnect)
    res.json(await service.connect(orgOf(req), username))
  }))

  router.post(ROUTE.disconnect, asyncHandler(async (req, res) => {
    await service.disconnect(orgOf(req))
    res.status(HttpStatus.NoContent).end()
  }))

  // Plan 023: import a public GitHub file or PR link. No connection needed.
  router.post(ROUTE.import, asyncHandler(async (req, res) => {
    const { url } = parse(githubImportSchema, req.body, SUBJECT.githubImport)
    res.json(await importService.importLink(url))
  }))

  router.get(ROUTE.repo, asyncHandler(async (req, res) => {
    const { query } = parse(repoSearchSchema, req.query, SUBJECT.query)
    res.json(await service.searchRepo(orgOf(req), query))
  }))

  router.get(ROUTE.repoFile, asyncHandler(async (req, res) => {
    const repoName = parse(repoNameSchema, req.params.repoId, FIELD.repoId)
    res.json(await service.listFile(orgOf(req), repoName))
  }))

  router.get(ROUTE.repoFileById, asyncHandler(async (req, res) => {
    const repoName = parse(repoNameSchema, req.params.repoId, FIELD.repoId)
    const fileId = req.params.fileId ?? ''
    const path = parse(fileIdSchema, fileId, FIELD.fileId)
    res.json(await service.getFile(orgOf(req), repoName, fileId, path))
  }))

  return router
}
