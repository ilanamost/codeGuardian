import type { ReviewStatus } from '../types'

export const statusMeta: Record<ReviewStatus, { label: string; meaning: string; style: string }> = {
  pending: {
    label: 'Pending',
    meaning: 'Review has been created and is waiting to start.',
    style: 'bg-neutral-soft text-neutral'
  },
  queued: {
    label: 'Queued',
    meaning: 'Review is waiting in the processing queue.',
    style: 'bg-queued-soft text-queued'
  },
  in_progress: {
    label: 'In progress',
    meaning: 'The AI agent is analyzing the code.',
    style: 'bg-primary-soft text-primary'
  },
  completed: {
    label: 'Completed',
    meaning: 'Review finished successfully, whether or not issues were found.',
    style: 'bg-success-soft text-success'
  },
  failed: {
    label: 'Failed',
    meaning: 'Review could not finish due to an error.',
    style: 'bg-danger-soft text-danger'
  },
  cancelled: {
    label: 'Cancelled',
    meaning: 'User cancelled the review before it finished.',
    style: 'bg-warning-soft text-warning'
  }
}
