import { Lightbulb } from 'lucide-react'
import type { HelpGuide } from '../types'

export default function GuidePanel({ guide }: { guide: HelpGuide }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{guide.title}</h2>
      <p className="mb-6 text-sm text-text-muted">{guide.subtitle}</p>
      <ol className="flex flex-col gap-5">
        {guide.step.map((step, index) => (
          <li key={step.title} className="flex items-center gap-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{step.title}</p>
              <p className="text-sm text-text-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {guide.tip.length > 0 && (
        <aside className="mt-6 rounded-md bg-primary-soft p-4" aria-label="Tips">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
            <Lightbulb size={16} aria-hidden="true" />
            Tips
          </p>
          <ul className="list-disc pl-5 text-sm text-text-muted">
            {guide.tip.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  )
}
