import { Search } from 'lucide-react'

type Props = {
  value: string
  onChange: (value: string) => void
}

export default function RepoSearch({ value, onChange }: Props) {
  return (
    <div className="relative">
      <label htmlFor="repo-search" className="sr-only">
        Search repositories
      </label>
      <Search size={16} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-text-muted" />
      <input
        id="repo-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search repositories..."
        className="w-full rounded-md border border-input-border bg-surface py-2 pr-3 pl-9 text-base sm:text-sm"
      />
    </div>
  )
}
