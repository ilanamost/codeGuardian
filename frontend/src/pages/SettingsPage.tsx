import type { ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import AccountPanel from '../components/AccountPanel'
import AiPreferencesPanel from '../components/AiPreferencesPanel'
import AppearancePanel from '../components/AppearancePanel'
import NotificationsPanel from '../components/NotificationsPanel'
import SecurityPanel from '../components/SecurityPanel'
import { SETTINGS_SECTION_PARAM } from '../lib/route.constants'
import { sectionList } from '../lib/settings.constants'
import type { SettingsSectionId } from '../types'

const panelOf: Record<SettingsSectionId, ComponentType> = {
  account: AccountPanel,
  security: SecurityPanel,
  notifications: NotificationsPanel,
  appearance: AppearancePanel,
  ai: AiPreferencesPanel
}

const defaultSection: SettingsSectionId = 'account'

function isSectionId(value: string | null): value is SettingsSectionId {
  return value !== null && Object.hasOwn(panelOf, value)
}

// The active section is in the URL (`/settings?section=security`, plan 028), so a refresh keeps it.
// A missing or unknown value shows Account.
export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(SETTINGS_SECTION_PARAM)
  const active: SettingsSectionId = isSectionId(value) ? value : defaultSection
  const Panel = panelOf[active]

  function select(id: SettingsSectionId) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set(SETTINGS_SECTION_PARAM, id)
        return next
      },
      { replace: true }
    )
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-(--page-padding)">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-text-muted">Manage your account and application preferences.</p>
      </header>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto rounded-md border border-border bg-card p-2 shadow-card lg:w-60 lg:flex-col lg:overflow-visible"
        >
          {sectionList.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={active === id}
              aria-controls="settings-panel"
              onClick={() => select(id)}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm ${
                active === id ? 'bg-primary-soft font-semibold text-primary' : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <section
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${active}`}
          className="min-w-0 flex-1 rounded-md border border-border bg-card p-4 shadow-card md:p-6"
        >
          <Panel />
        </section>
      </div>
    </main>
  )
}
