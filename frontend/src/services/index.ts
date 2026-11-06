import { createAccountService, type AccountService } from './account.service'
import { createApiService } from './api.service'
import { createDashboardService, type DashboardService } from './dashboard.service'
import type { DataSource } from './data-source'
import { createGithubService, type GithubService } from './github.service'
import { createNotificationService, type NotificationService, type NotificationServiceOption } from './notification.service'
import { createReportService, type ReportService } from './report.service'
import { createReviewService, type ReviewService } from './review.service'
import { createSessionService, type SessionService } from './session.service'
import { createSettingsService, type SettingsService } from './settings.service'
import { createStorageService, type StorageService } from './storage.service'
import { createSupportService, type SupportService } from './support.service'

// Everything the store needs, injected as the thunk `extra` argument (tests pass fakes).
export interface Services {
  review: ReviewService
  dashboard: DashboardService
  github: GithubService
  settings: SettingsService
  support: SupportService
  account: AccountService
  session: SessionService
  report: ReportService
  notification: NotificationService
}

export interface ServicesOption {
  // The data source every domain service talks to: the HTTP API by default; tests pass a fake.
  dataSource?: DataSource
  storage?: StorageService
  notification?: NotificationServiceOption
  override?: Partial<Services>
}

// Builds every domain service on one data source (plan 035: the HTTP API, unless a test passes
// its own). Browser storage only keeps the settings cache (settings.service), never app data.
export function createServices(option: ServicesOption = {}): Services {
  const storage = option.storage ?? createStorageService()
  const source = option.dataSource ?? createApiService()
  const base: Services = {
    review: createReviewService(source),
    dashboard: createDashboardService(source),
    github: createGithubService(source),
    settings: createSettingsService(source, storage),
    support: createSupportService(source),
    account: createAccountService(source),
    session: createSessionService(source),
    report: createReportService(),
    notification: createNotificationService(option.notification)
  }
  return { ...base, ...option.override }
}
