import { autoLanguage } from '../lib/settings.constants'
import { languageList } from '../lib/review.constants'
import { useSettings } from '../lib/useSettings'
import RadioGroup from './RadioGroup'
import ToggleSwitch from './ToggleSwitch'

export default function AiPreferencesPanel() {
  const { settings, update } = useSettings()

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">AI preferences</h2>
      <RadioGroup
        legend="Review focus"
        name="reviewFocus"
        value={settings.reviewFocus}
        onChange={(reviewFocus) => update({ reviewFocus })}
        optionList={[
          { value: 'all', label: 'All categories' },
          { value: 'bugs', label: 'Bugs' },
          { value: 'security', label: 'Security' },
          { value: 'performance', label: 'Performance' },
          { value: 'readability', label: 'Readability' }
        ]}
      />
      <RadioGroup
        legend="Review strictness"
        name="strictness"
        value={settings.strictness}
        onChange={(strictness) => update({ strictness })}
        optionList={[
          { value: 'high_confidence', label: 'High-confidence only', description: 'Only high-confidence issues.' },
          { value: 'balanced', label: 'Balanced', description: 'A balanced review.' },
          { value: 'comprehensive', label: 'Comprehensive', description: 'More comprehensive suggestions.' }
        ]}
      />
      <RadioGroup
        legend="Explanation detail"
        name="explanation"
        value={settings.explanation}
        onChange={(explanation) => update({ explanation })}
        optionList={[
          { value: 'concise', label: 'Concise', description: 'Concise feedback.' },
          { value: 'detailed', label: 'Detailed', description: 'Detailed explanations.' }
        ]}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Generated tests</p>
          <p className="text-xs text-text-muted">Enable or disable suggested unit tests.</p>
        </div>
        <ToggleSwitch
          label="Generated tests"
          checked={settings.generatedTest}
          onChange={(generatedTest) => update({ generatedTest })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="default-language" className="text-sm font-semibold">
          Programming language
        </label>
        <select
          id="default-language"
          value={settings.language}
          onChange={(event) => update({ language: event.target.value })}
          className="max-w-xs rounded-md border border-input-border bg-surface px-3 py-2 text-sm"
        >
          <option value={autoLanguage}>Auto-detect</option>
          {languageList.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
