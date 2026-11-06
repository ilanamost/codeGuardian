import { useState } from 'react'
import { Search } from 'lucide-react'
import { errorList } from '../lib/help.constants'

export default function ErrorMessagesPanel() {
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const rowList = errorList.filter(({ message, meaning, action }) =>
    [message, meaning, action].some((text) => text.toLowerCase().includes(term))
  )

  return (
    <div>
      <h2 className="text-lg font-semibold">Error Messages</h2>
      <p className="mb-4 text-sm text-text-muted">Find what an error means and what to do about it.</p>
      <label className="mb-4 flex items-center gap-2 rounded-md border border-input-border bg-surface px-3 focus-within:outline-2 focus-within:outline-primary">
        <Search size={16} aria-hidden="true" className="text-text-muted" />
        <input
          type="search"
          aria-label="Search error messages"
          placeholder="Search error messages..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
        />
      </label>
      {rowList.length === 0 ? (
        <p className="text-sm text-text-muted">No matching errors</p>
      ) : (
        <table className="w-full text-left text-sm max-md:block">
          <thead className="max-md:sr-only">
            <tr className="border-b border-border text-text-muted">
              <th className="py-2 pr-4 font-medium">Error message</th>
              <th className="py-2 pr-4 font-medium">Meaning</th>
              <th className="py-2 font-medium">Recommended action</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rowList.map((row) => (
              <tr key={row.message} className="border-b border-border align-top max-md:mb-3 max-md:block max-md:rounded-md max-md:border max-md:p-3">
                <td className="py-3 pr-4 font-semibold max-md:block max-md:py-0">{row.message}</td>
                <td className="py-3 pr-4 text-text-muted max-md:block max-md:py-1">{row.meaning}</td>
                <td className="py-3 text-text-muted max-md:block max-md:py-0">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
