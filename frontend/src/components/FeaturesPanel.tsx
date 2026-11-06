import { featureList } from '../lib/help.constants'

export default function FeaturesPanel() {
  return (
    <div>
      <h2 className="text-lg font-semibold">Main Features</h2>
      <p className="mb-6 text-sm text-text-muted">What CodeGuardian gives you with every review.</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {featureList.map((feature) => (
          <li key={feature.title} className="rounded-md border border-border p-4">
            <p className="text-sm font-semibold">{feature.title}</p>
            <p className="text-sm text-text-muted">{feature.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
