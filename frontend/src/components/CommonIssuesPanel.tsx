import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { issueList } from '../lib/help.constants'
import type { HelpTopicId } from '../types'

type Props = { onTopicChange: (topic: HelpTopicId) => void }

export default function CommonIssuesPanel({ onTopicChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div>
      <h2 className="text-lg font-semibold">Common Issues</h2>
      <p className="mb-6 text-sm text-text-muted">Problems you can usually fix yourself, without technical error codes.</p>
      <ul className="flex flex-col gap-2">
        {issueList.map((issue) => {
          const open = openId === issue.id
          return (
            <li key={issue.id} className="rounded-md border border-border">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`issue-${issue.id}`}
                onClick={() => setOpenId(open ? null : issue.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{issue.title}</span>
                  <span className="block text-xs text-text-muted">{issue.summary}</span>
                </span>
                <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-text-muted ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <div id={`issue-${issue.id}`} className="flex flex-col gap-4 border-t border-border p-3 text-sm">
                  <section>
                    <h3 className="font-semibold">What happened</h3>
                    <p className="text-text-muted">{issue.whatHappened}</p>
                  </section>
                  <section>
                    <h3 className="font-semibold">Possible causes</h3>
                    <ul className="list-disc pl-5 text-text-muted">
                      {issue.cause.map((cause) => (
                        <li key={cause}>{cause}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3 className="font-semibold">How to fix it</h3>
                    <ol className="list-decimal pl-5 text-text-muted">
                      {issue.fix.map((fix) => (
                        <li key={fix}>{fix}</li>
                      ))}
                    </ol>
                  </section>
                  <section>
                    <h3 className="font-semibold">Still stuck?</h3>
                    <button type="button" onClick={() => onTopicChange('contact')} className="text-primary underline">
                      Contact Support
                    </button>
                  </section>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
