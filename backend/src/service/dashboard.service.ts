import type { CountedSeverity, Dashboard } from '../model/dto.js'
import type { StatusCount, Store } from '../store/store.js'
import {
  ACTIVITY_RANGE_DAY, DASHBOARD_LABEL, DATE_LABEL, PERCENT, TIME, TREND_RANGE
} from '../utils/constants.js'
import { ActivityRange, FindingCategory, Severity, StatId } from '../utils/domain.js'

export type DashboardService = ReturnType<typeof createDashboardService>

// Computed from the store on every request (plan 019 addendum); the counting itself is done by
// the store (SQL aggregates in `PgStore`, plan 022). Deleted reviews never count.
// - Stat values are all-time: total, completed and failed counts, and the average quality score
//   of completed reviews, rounded with Math.round to an integer (0 when none is completed).
// - Stat trends compare the last TREND_RANGE (30 UTC calendar days, today included) with the 30
//   days before it, by `createdAt`: Math.round((current - previous) / previous * 100). The
//   trend is 0 when the previous window has nothing (no reviews of that kind, or, for the
//   quality score, no completed review).
// - Severity counts sum each review's finding counts: always the four counted severities.
// - Category counts count findings by `category`: only categories with at least one finding,
//   most first, ties in `FindingCategory` order.
// - Activity counts reviews by the UTC calendar day of `createdAt`: one entry per day of each
//   range, oldest first, ending today by the injected clock, labelled like 'Apr 26'.

const countedSeverityList: CountedSeverity[] = [Severity.Critical, Severity.High, Severity.Medium, Severity.Low]
const categoryList = Object.values(FindingCategory)
const msPerDay = TIME.msPerSecond * TIME.secondsPerDay
const dateFormat = new Intl.DateTimeFormat(DATE_LABEL.locale, DATE_LABEL.option)
const longestRangeDay = Math.max(...Object.values(ACTIVITY_RANGE_DAY))

function averageQuality(count: StatusCount): number | undefined {
  return count.completed === 0 ? undefined : count.qualitySum / count.completed
}

function trendOf(current: number | undefined, previous: number | undefined): number {
  if (previous === undefined || previous === 0) return 0
  return Math.round(((current ?? 0) - previous) / previous * PERCENT)
}

export function createDashboardService(store: Store, now: () => number) {
  return {
    async get(orgId: string): Promise<Dashboard> {
      const today = Math.floor(now() / msPerDay)
      const trendDay = ACTIVITY_RANGE_DAY[TREND_RANGE]
      const count = await store.getDashboardCount(orgId, {
        currentFirstDay: today - trendDay + 1,
        previousFirstDay: today - 2 * trendDay + 1,
        trendDay,
        activityFirstDay: today - longestRangeDay + 1,
        today
      })

      const countStat = (id: `${StatId}`, key: 'total' | 'completed' | 'failed') => ({
        id,
        label: DASHBOARD_LABEL.stat[id],
        value: count.all[key],
        trend: trendOf(count.current[key], count.previous[key])
      })

      const activityByDay = new Map(count.activityCount.map((item) => [item.day, item.count]))
      const activityOf = (range: ActivityRange) => {
        const dayCount = ACTIVITY_RANGE_DAY[range]
        return Array.from({ length: dayCount }, (_unused, index) => {
          const day = today - dayCount + 1 + index
          return { date: dateFormat.format(day * msPerDay), count: activityByDay.get(day) ?? 0 }
        })
      }

      return {
        statList: [
          countStat(StatId.Total, 'total'),
          countStat(StatId.Completed, 'completed'),
          countStat(StatId.Failed, 'failed'),
          {
            id: StatId.Quality,
            label: DASHBOARD_LABEL.stat.quality,
            value: Math.round(averageQuality(count.all) ?? 0),
            suffix: DASHBOARD_LABEL.qualitySuffix,
            trend: trendOf(averageQuality(count.current), averageQuality(count.previous))
          }
        ],
        severityCountList: countedSeverityList.map((severity) => ({
          severity,
          label: DASHBOARD_LABEL.severity[severity],
          count: count.severityCount[severity]
        })),
        categoryCountList: categoryList
          .filter((category) => (count.categoryCount[category] ?? 0) > 0)
          .map((category) => ({ id: category, label: DASHBOARD_LABEL.category[category], count: count.categoryCount[category] ?? 0 }))
          .sort((first, second) => second.count - first.count),
        activityByRange: {
          [ActivityRange.Week]: activityOf(ActivityRange.Week),
          [ActivityRange.TwoWeek]: activityOf(ActivityRange.TwoWeek),
          [ActivityRange.Month]: activityOf(ActivityRange.Month)
        }
      }
    }
  }
}
