import type { FailureReason } from '../utils/domain.js'

// A failed analysis, with the reason the review shows (contract 0.14.0). The message is a fixed
// text: it never holds the code, the prompt, the model's answer, the key or a provider error body.
export class AnalyzerError extends Error {
  readonly reason: `${FailureReason}`

  constructor(reason: `${FailureReason}`, message: string = reason) {
    super(message)
    this.name = 'AnalyzerError'
    this.reason = reason
  }
}
