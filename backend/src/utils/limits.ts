// Size and length limits. The request field limits match .orchestrate/api-contract.yaml.
export const LIMIT = {
  // Request body: the main cap counts Unicode code points of the raw JSON text; the byte cap is
  // an outer safety net, large enough for 100 000 four-byte characters (plan 018, QA round 1, D2).
  bodyChar: 200_000,
  bodyByte: '700kb',

  id: { min: 1, max: 64 },
  reviewTitleMax: 120,
  reviewName: { min: 1, max: 80 },
  language: { min: 1, max: 40 },
  content: { min: 1, max: 100_000 },
  repoQueryMax: 100,
  password: { currentMin: 1, min: 8, max: 200 },
  // Plan 028: registration and sign in (the same rules in the frontend).
  username: { min: 3, max: 32 },
  signInUsername: { min: 1, max: 64 },
  signInPassword: { min: 1, max: 200 },
  // The profile photo, in bytes (2 MB).
  avatarByte: 2 * 1024 * 1024,
  email: { max: 254 },
  supportReviewIdMax: 64,
  supportDescription: { min: 10, max: 2000 },

  // GitHub link import (plan 023, Open Question 3). Characters are UTF-16 code units, as the
  // review content limit (`content.max`) counts them, so an import always fits a review.
  github: {
    urlMax: 2000,
    fileChar: 50_000,
    totalChar: 100_000,
    fileCount: 20,
    callTimeoutMs: 10_000,
    totalTimeoutMs: 30_000,
    // One UTF-16 unit is at most 3 UTF-8 bytes (a surrogate pair is 2 units and 4 bytes), so a
    // declared `size` over this is over `fileChar` for certain, and is refused before decoding.
    fileByte: 150_000,
    // A contents response carries the file as base64 (4/3 of `fileByte`), a line break every
    // 60 characters (escaped as two bytes) and the metadata; anything longer is over `fileChar`.
    fileResponseByte: 256_000,
    // PR metadata and the file list (at most `fileCount` entries, each with its patch). A list
    // longer than this holds changes far over `totalChar`.
    pullResponseByte: 4_000_000,
    // Validated parts of a link (GitHub's own owner and repo rules).
    ownerMax: 39,
    repoMax: 100,
    refMax: 100,
    pathMax: 1000,
    pullNumberDigitMax: 10,

    // The wizard's repository routes (plan 030). One GitHub page of repositories, a capped file
    // list, and the body caps of the calls (anything longer is a 502, never half-read).
    usernameMax: 39,
    repoListMax: 100,
    fileListMax: 500,
    // A listed file's declared size, in bytes. Bytes are never fewer than UTF-16 units, so a
    // listed file always fits `fileChar`.
    listedFileByte: 50_000,
    // base64url of at most `pathMax` characters of at most 3 UTF-8 bytes each.
    fileIdMax: 4000,
    displayNameMax: 255,
    repoDescriptionMax: 1000,
    userResponseByte: 100_000,
    // 100 repositories with every URL field GitHub sends.
    repoListResponseByte: 2_000_000,
    // GitHub cuts a recursive tree at about 7 MB itself.
    treeResponseByte: 10_000_000
  },

  // Brute-force protection (plan 028, Scope 8). In memory, one backend instance.
  rateLimit: {
    signInUserFailure: { limit: 5, windowMs: 15 * 60 * 1000 },
    signInIp: { limit: 20, windowMs: 15 * 60 * 1000 },
    signUpIp: { limit: 5, windowMs: 60 * 60 * 1000 },
    // Plan 031 (Open Question 5, kept by plan 032): support requests per account (org).
    supportRequestOrg: { limit: 5, windowMs: 60 * 60 * 1000 },
    // Keys kept per limiter before old ones are swept, so the maps stay bounded.
    sweepKeyCount: 10_000,
    // Plan 040: GitHub sign-in start, callback and link, per client IP (a sign-in is two hits).
    githubSignInIp: { limit: 30, windowMs: 15 * 60 * 1000 }
  },

  // The Claude analyzer (plan 039, Open Question 3, answer A). Times are milliseconds.
  analyzer: {
    // Output tokens of one provider call.
    maxToken: 16_000,
    effort: 'medium',
    // SDK timeout of one provider call, and retries of transient errors (429, 5xx, connection).
    callTimeoutMs: 90_000,
    maxRetry: 2,
    // Overall deadline of one analysis (all retries included) and of one regenerate.
    analysisDeadlineMs: 180_000,
    regenerateDeadlineMs: 60_000,
    // Provider calls running at once across the backend; the rest wait in a FIFO.
    concurrentCall: 3,
    // Analyses (and regenerates) per account (org) per hour.
    quotaOrg: { limit: 20, windowMs: 60 * 60 * 1000 },
    // What the model may send back: counts and lengths, checked again by the server.
    findingMax: 50,
    suggestionMax: 20,
    messageMax: 200,
    detailMax: 2000,
    testCodeMax: 30_000,
    // The title and language put in the prompt are cut to this many characters.
    promptFieldMax: 120
  },

  // Stub analyzer.
  maxFinding: 50,
  longLine: 120,
  fullQualityScore: 100,
  minQualityScore: 0
} as const
