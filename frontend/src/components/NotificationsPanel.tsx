import { notificationList } from '../lib/settings.constants'
import { notify, useSettings } from '../lib/useSettings'
import ToggleSwitch from './ToggleSwitch'

export default function NotificationsPanel() {
  const { settings, setNotification } = useSettings()

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <ul className="flex flex-col divide-y divide-border">
        {notificationList.map((item) => (
          <li key={item.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0">
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-text-muted">{item.description}</p>
              {item.note && <p className="mt-1 text-xs font-medium text-text-muted">{item.note}</p>}
            </div>
            <button
              type="button"
              aria-label={`Send test ${item.label}`}
              onClick={() => notify(settings, item.type, `${item.message} (test)`)}
              className="text-xs font-medium text-primary hover:text-primary-hover"
            >
              Send test
            </button>
            <ToggleSwitch
              label={item.label}
              checked={settings.notification[item.type]}
              onChange={(enabled) => setNotification(item.type, enabled)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
