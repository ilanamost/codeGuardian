// Domain values from .orchestrate/api-contract.yaml. The DTO types in `model/dto.ts` and the
// zod schemas are derived from these enums, so each value is written once.

export enum Severity {
  Info = 'info',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical'
}

export enum ReviewStatus {
  Pending = 'pending',
  Queued = 'queued',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled'
}

export enum SourceType {
  Snippet = 'snippet'
}

// GitHub link import (plan 023, contract 0.7.0).
export enum ImportLanguage {
  TypeScript = 'TypeScript',
  JavaScript = 'JavaScript',
  Python = 'Python',
  Go = 'Go',
  Java = 'Java'
}

export enum SkipReason {
  Removed = 'removed',
  Renamed = 'renamed',
  Binary = 'binary',
  Symlink = 'symlink',
  Submodule = 'submodule',
  Folder = 'folder',
  UnsupportedType = 'unsupported_type',
  InvalidPath = 'invalid_path'
}

// `details.limit` of a 413 and a 504 from the import.
export enum ImportLimit {
  FileChar = 'fileChar',
  TotalChar = 'totalChar',
  FileCount = 'fileCount',
  CallTimeout = 'callTimeout',
  TotalTimeout = 'totalTimeout'
}

export enum GithubLinkKind {
  File = 'file',
  Pull = 'pull'
}

export enum StatId {
  Total = 'total',
  Completed = 'completed',
  Failed = 'failed',
  Quality = 'quality'
}

export enum ActivityRange {
  Week = '7d',
  TwoWeek = '14d',
  Month = '30d'
}

export enum Theme {
  Light = 'light',
  Dark = 'dark',
  System = 'system'
}

export enum EditorFontSize {
  Small = 'small',
  Medium = 'medium',
  Large = 'large'
}

export enum HistoryDensity {
  Comfortable = 'comfortable',
  Compact = 'compact'
}

export enum ReviewFocus {
  All = 'all',
  Bugs = 'bugs',
  Security = 'security',
  Performance = 'performance',
  Readability = 'readability'
}

export enum Strictness {
  HighConfidence = 'high_confidence',
  Balanced = 'balanced',
  Comprehensive = 'comprehensive'
}

export enum Explanation {
  Concise = 'concise',
  Detailed = 'detailed'
}

export enum IssueType {
  ReviewFailed = 'review_failed',
  Upload = 'upload',
  Github = 'github',
  Account = 'account',
  Other = 'other'
}

export enum SupportPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high'
}

// `Finding.category` (contract 0.5.0). The Dashboard counts findings by it.
export enum FindingCategory {
  Security = 'security',
  Bug = 'bug',
  Performance = 'performance',
  Readability = 'readability',
  Maintainability = 'maintainability'
}

// The test configuration of a review (contract 0.13.0, plan 034).
export enum TestFramework {
  Jest = 'Jest',
  Vitest = 'Vitest',
  Mocha = 'Mocha'
}

// Unit tests, edge cases and error cases, in this order.
export enum TestType {
  Unit = 'unit',
  Edge = 'edge',
  Error = 'error'
}

// Why a review is failed (contract 0.14.0, plan 039). `AiNotConfigured` is reserved: while the
// stub analyzer is the fallback without a key, nothing sends it.
export enum FailureReason {
  AiNotConfigured = 'ai_not_configured',
  AiUnavailable = 'ai_unavailable',
  AiRateLimited = 'ai_rate_limited',
  AiTimeout = 'ai_timeout',
  AiInvalidOutput = 'ai_invalid_output',
  AiRefused = 'ai_refused',
  AiQuotaExceeded = 'ai_quota_exceeded',
  Internal = 'internal'
}

// Which analyzer reviews use (`GET /api/health`, contract 0.14.0).
export enum AnalyzerKind {
  Claude = 'claude',
  Stub = 'stub'
}

// How an account signs in (contract 0.15.0, plan 040): `github` has no password.
export enum SignInMethod {
  Password = 'password',
  Github = 'github',
  Both = 'both'
}

// The closed list of the `auth_error` query value on the redirect after a failed GitHub sign-in
// or link (contract 0.15.0). Nothing from GitHub is ever put in one. `RateLimited` is part of the
// list the frontend understands; the backend answers a rate limit with a 429 instead.
export enum AuthErrorCode {
  InvalidState = 'invalid_state',
  AccessDenied = 'access_denied',
  ProviderError = 'provider_error',
  EmailUnverified = 'email_unverified',
  EmailInUse = 'email_in_use',
  IdentityInUse = 'identity_in_use',
  RateLimited = 'rate_limited'
}

// Identity providers of `account_identity` (only GitHub today).
export enum IdentityProvider {
  Github = 'github'
}
