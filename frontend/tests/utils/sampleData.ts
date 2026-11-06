import { fixtureData } from './fixtureData'

// Sample data for tests: tests/fixtures/*.json as the fake backend serves it (already checked
// with the model guards).
export const sampleReview = fixtureData.reviewTemplate
export const generatedTestFileList = fixtureData.reviewTemplate.generatedTest
export const recentReviewList = fixtureData.reviewSummaryList
export const dashboardStatList = fixtureData.dashboard.statList
export const severityCountList = fixtureData.dashboard.severityCountList
export const categoryCountList = fixtureData.dashboard.categoryCountList
export const activityByRange = fixtureData.dashboard.activityByRange
export const githubRepoList = fixtureData.githubRepoList
