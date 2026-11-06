type Props = {
  actionLabel: string
  actionDisabled: boolean
  onCancel: () => void
  onAction: () => void
}

export default function WizardFooter({ actionLabel, actionDisabled, onCancel, onAction }: Props) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 xs:flex-row xs:justify-end">
      <button type="button" onClick={onCancel} className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-page-bg">
        Cancel
      </button>
      <button
        type="button"
        disabled={actionDisabled}
        onClick={onAction}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {actionLabel}
      </button>
    </div>
  )
}
