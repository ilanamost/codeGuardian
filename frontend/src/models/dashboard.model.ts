import type { ActivityPointDto, ActivityRange, CategoryCountDto, DashboardDto, DashboardStatDto, SeverityCountDto } from './dto'
import { hasFields, isArrayOf, isNumber, isOneOf, isOptional, isRecord, isString, type Guard } from './guard'
import { countedSeverityList, findingCategoryList, parseDto } from './review.model'

export const activityRangeIdList: readonly ActivityRange[] = ['7d', '14d', '30d']

const isStatDto: Guard<DashboardStatDto> = (value): value is DashboardStatDto =>
  hasFields(value, {
    id: isOneOf(['total', 'completed', 'failed', 'quality'] as const),
    label: isString,
    value: isNumber,
    suffix: isOptional(isString),
    trend: isNumber
  })

const isSeverityCountDto: Guard<SeverityCountDto> = (value): value is SeverityCountDto =>
  hasFields(value, { severity: isOneOf(countedSeverityList), label: isString, count: isNumber })

// Always the four counted severities, each once (the counts may all be 0).
const isSeverityCountList = (value: unknown): value is SeverityCountDto[] =>
  isArrayOf(isSeverityCountDto)(value) &&
  value.length === countedSeverityList.length &&
  countedSeverityList.every((severity) => value.some((item) => item.severity === severity))

// Only the contract's categories; the list is empty when there is no finding.
const isCategoryCountDto: Guard<CategoryCountDto> = (value): value is CategoryCountDto =>
  hasFields(value, { id: isOneOf(findingCategoryList), label: isString, count: isNumber })

const isActivityPointDto: Guard<ActivityPointDto> = (value): value is ActivityPointDto =>
  hasFields(value, { date: isString, count: isNumber })

export const isDashboardDto: Guard<DashboardDto> = (value): value is DashboardDto =>
  hasFields(value, {
    statList: isArrayOf(isStatDto),
    severityCountList: isSeverityCountList,
    categoryCountList: isArrayOf(isCategoryCountDto),
    activityByRange: (range: unknown) =>
      isRecord(range) && activityRangeIdList.every((id) => isArrayOf(isActivityPointDto)(range[id]))
  })

export class Dashboard {
  readonly statList: DashboardStatDto[]
  readonly severityCountList: SeverityCountDto[]
  readonly categoryCountList: CategoryCountDto[]
  readonly activityByRange: Record<ActivityRange, ActivityPointDto[]>

  constructor(dto: DashboardDto) {
    this.statList = dto.statList
    this.severityCountList = dto.severityCountList
    this.categoryCountList = dto.categoryCountList
    this.activityByRange = dto.activityByRange
  }

  static fromDto(value: unknown): Dashboard {
    return new Dashboard(parseDto(value, isDashboardDto))
  }

  static empty(): Dashboard {
    return new Dashboard({
      statList: [],
      severityCountList: [],
      categoryCountList: [],
      activityByRange: { '7d': [], '14d': [], '30d': [] }
    })
  }

  get findingTotal(): number {
    return this.severityCountList.reduce((total, item) => total + item.count, 0)
  }

  stat(id: DashboardStatDto['id']): DashboardStatDto | undefined {
    return this.statList.find((item) => item.id === id)
  }

  activityFor(range: ActivityRange): ActivityPointDto[] {
    return this.activityByRange[range] ?? []
  }
}
