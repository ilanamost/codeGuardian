import { API_PATH } from '../lib/api.constants'
import type { GithubAccountDto, GithubFileContentDto, GithubFileListDto, GithubImportDto, GithubRepoListDto } from '../models/dto'
import {
  isGithubAccountDto,
  isGithubFileContentDto,
  isGithubFileListDto,
  isGithubImportDto,
  isGithubRepoListDto
} from '../models/github.model'
import { parseDto } from '../models/review.model'
import { get, post, type DataSource } from './data-source'

export interface GithubService {
  // Connects the public GitHub account with this user name (contract 0.9.0).
  connect(username: string): Promise<GithubAccountDto>
  // Forgets the connected account (wizard "Switch account").
  disconnect(): Promise<void>
  // Repositories whose name contains the query (case-insensitive); all of them for an empty query.
  searchRepo(query: string): Promise<GithubRepoListDto>
  listFile(repoId: string): Promise<GithubFileListDto>
  // One file with its content (wizard "Import").
  getFile(repoId: string, fileId: string): Promise<GithubFileContentDto>
  // The code of a public GitHub file or pull-request link (POST /api/github/import, plan 023).
  importLink(url: string): Promise<GithubImportDto>
}

export function createGithubService(source: DataSource): GithubService {
  return {
    async connect(username) {
      return parseDto(await post<unknown>(source, API_PATH.githubConnect, { username }), isGithubAccountDto)
    },
    async disconnect() {
      await post(source, API_PATH.githubDisconnect)
    },
    async searchRepo(query) {
      const value = await get<unknown>(source, API_PATH.githubRepo, { query: { query: query.trim() || undefined } })
      return parseDto(value, isGithubRepoListDto)
    },
    async listFile(repoId) {
      return parseDto(await get<unknown>(source, API_PATH.githubFileList(repoId)), isGithubFileListDto)
    },
    async getFile(repoId, fileId) {
      return parseDto(await get<unknown>(source, API_PATH.githubFile(repoId, fileId)), isGithubFileContentDto)
    },
    async importLink(url) {
      return parseDto(await post<unknown>(source, API_PATH.githubImport, { url: url.trim() }), isGithubImportDto)
    }
  }
}
