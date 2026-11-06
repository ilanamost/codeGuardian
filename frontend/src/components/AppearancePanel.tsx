import { useSettings } from '../lib/useSettings'
import RadioGroup from './RadioGroup'

export default function AppearancePanel() {
  const { settings, update } = useSettings()

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Appearance</h2>
      <RadioGroup
        legend="Theme"
        name="theme"
        value={settings.theme}
        onChange={(theme) => update({ theme })}
        optionList={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System default', description: "Follow the operating system's appearance setting." }
        ]}
      />
      <RadioGroup
        legend="Editor font size"
        name="editorFontSize"
        value={settings.editorFontSize}
        onChange={(editorFontSize) => update({ editorFontSize })}
        optionList={[
          { value: 'small', label: 'Small (12px)' },
          { value: 'medium', label: 'Medium (14px)' },
          { value: 'large', label: 'Large (16px)' }
        ]}
      />
      <RadioGroup
        legend="Review history density"
        name="historyDensity"
        value={settings.historyDensity}
        onChange={(historyDensity) => update({ historyDensity })}
        optionList={[
          { value: 'comfortable', label: 'Comfortable', description: 'More spacing.' },
          { value: 'compact', label: 'Compact', description: 'Show more reviews per screen.' }
        ]}
      />
    </div>
  )
}
