import type { WizardStep } from '../types'

type Props = {
  stepList: { id: WizardStep; label: string }[]
  current: WizardStep
  onSelect: (id: WizardStep) => void
}

export default function WizardStepper({ stepList, current, onSelect }: Props) {
  const currentIndex = stepList.findIndex((step) => step.id === current)

  return (
    <ol aria-label="Wizard steps" className="flex flex-wrap items-center gap-3">
      {stepList.map((step, index) => {
        const isCurrent = index === currentIndex
        const isDone = index < currentIndex
        const circle = (
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              isCurrent || isDone ? 'bg-primary text-white' : 'bg-neutral-soft text-text-muted'
            }`}
          >
            {index + 1}
          </span>
        )
        // Labels of non-current steps stay in the DOM for screen readers but are visually hidden below xs.
        const labelVisibility = isCurrent ? '' : 'max-xs:sr-only'
        return (
          <li key={step.id} aria-current={isCurrent ? 'step' : undefined} className="flex items-center gap-3">
            {isDone ? (
              <button type="button" aria-label={step.label} onClick={() => onSelect(step.id)} className="flex items-center gap-3 text-sm text-primary hover:underline max-md:min-h-11 max-md:min-w-11">
                {circle}
                <span className={labelVisibility}>{step.label}</span>
              </button>
            ) : (
              <>
                {circle}
                <span className={`text-sm ${isCurrent ? 'font-semibold' : 'text-text-muted'} ${labelVisibility}`}>{step.label}</span>
              </>
            )}
            {index < stepList.length - 1 && <span aria-hidden="true" className="h-px w-6 bg-border xs:w-10" />}
          </li>
        )
      })}
    </ol>
  )
}
