import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import CommonIssuesPanel from '../components/CommonIssuesPanel'
import ContactSupportForm from '../components/ContactSupportForm'
import ErrorMessagesPanel from '../components/ErrorMessagesPanel'
import FeaturesPanel from '../components/FeaturesPanel'
import GuidePanel from '../components/GuidePanel'
import { guideOf, topicGroupList } from '../lib/help.constants'
import type { HelpTopicId } from '../types'

const defaultTopic: HelpTopicId = 'create-review'
const topicIdList = topicGroupList.flatMap((group) => group.topic.map((topic) => topic.id))

function Panel({ topic, onTopicChange }: { topic: HelpTopicId; onTopicChange: (topic: HelpTopicId) => void }) {
  if (topic === 'features') return <FeaturesPanel />
  if (topic === 'common-issues') return <CommonIssuesPanel onTopicChange={onTopicChange} />
  if (topic === 'error-messages') return <ErrorMessagesPanel />
  if (topic === 'contact') return <ContactSupportForm />
  const guide = guideOf[topic]
  return guide ? <GuidePanel guide={guide} /> : null
}

export default function HelpPage() {
  const [params, setParams] = useSearchParams()
  const [menuOpen, setMenuOpen] = useState(false)
  const requested = params.get('topic') as HelpTopicId | null
  const active = requested && topicIdList.includes(requested) ? requested : defaultTopic
  const activeLabel = topicGroupList.flatMap((group) => group.topic).find((topic) => topic.id === active)?.label

  function select(topic: HelpTopicId) {
    setParams({ topic })
    setMenuOpen(false)
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-(--page-padding)">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Help & Support</h1>
        <p className="text-sm text-text-muted">Find answers, learn how to use CodeGuardian, or get in touch with our team.</p>
      </header>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="shrink-0 lg:w-64">
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="help-topics"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold shadow-card lg:hidden"
          >
            <span className="truncate">{activeLabel}</span>
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            <span className="sr-only">Help topics menu</span>
          </button>
          <div
            id="help-topics"
            role="tablist"
            aria-label="Help topics"
            aria-orientation="vertical"
            className={`mt-2 max-h-[60dvh] flex-col gap-1 overflow-y-auto rounded-md border border-border bg-card p-2 shadow-card lg:mt-0 lg:flex lg:max-h-none lg:overflow-visible ${
              menuOpen ? 'flex' : 'hidden'
            }`}
          >
            {topicGroupList.map((group) => (
              <div key={group.title} role="presentation" className="flex flex-col gap-1">
                <p className="px-3 pt-2 text-xs font-semibold text-text-muted">{group.title}</p>
                {group.topic.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`help-tab-${id}`}
                    aria-selected={active === id}
                    aria-controls="help-panel"
                    onClick={() => select(id)}
                    className={`cursor-pointer rounded-md px-3 py-2 text-left text-sm ${
                      active === id ? 'bg-primary-soft font-semibold text-primary' : 'text-text-muted hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <section
          role="tabpanel"
          id="help-panel"
          aria-labelledby={`help-tab-${active}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-card p-4 shadow-card md:p-6"
        >
          <Panel topic={active} onTopicChange={select} />
        </section>
      </div>
    </main>
  )
}
