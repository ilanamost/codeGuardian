import { API_PATH } from '../lib/api.constants'
import { isDashboardDto } from '../models/dashboard.model'
import type { DashboardDto } from '../models/dto'
import { parseDto } from '../models/review.model'
import { get, type DataSource } from './data-source'

// Aggregates for the Dashboard page. Recent Reviews come from review.service (same list as History).
export interface DashboardService {
  get(): Promise<DashboardDto>
}

export function createDashboardService(source: DataSource): DashboardService {
  return {
    async get() {
      return parseDto(await get<unknown>(source, API_PATH.dashboard), isDashboardDto)
    }
  }
}
