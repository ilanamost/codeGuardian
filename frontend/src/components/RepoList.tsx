import { GITHUB_LIST_LIMIT, GITHUB_TEXT } from '../lib/github.constants'
import type { GithubRepo } from '../types'
import ListNote from './ListNote'
import Loader from './Loader'

type Props = {
  repoList: GithubRepo[]
  selectedId: string | null
  onSelect: (id: string) => void
  // The current search: an empty list then means "no match" rather than "no repositories".
  query?: string
  // GitHub has more repositories than the first page (contract 0.9.0).
  truncated?: boolean
  // Plan 037: a load (connect or search) is in flight; with no rows yet the Loader is shown.
  loading?: boolean
}

export default function RepoList({ repoList, selectedId, onSelect, query = '', truncated = false, loading = false }: Props) {
  const note = truncated && <ListNote>{GITHUB_TEXT.repoTruncated(GITHUB_LIST_LIMIT.repo)}</ListNote>

  if (repoList.length === 0 && loading) return <Loader label={GITHUB_TEXT.loadingRepo} className="py-6" />

  if (repoList.length === 0) {
    return (
      <>
        {note}
        <p className="py-6 text-center text-sm text-text-muted">{query.trim() ? GITHUB_TEXT.noRepoMatch : GITHUB_TEXT.noRepo}</p>
      </>
    )
  }

  return (
    <>
      {note}
      <ul aria-label="Repositories" className="flex flex-col gap-2">
        {repoList.map((repo) => (
          <li key={repo.id}>
            <label
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-left ${
                selectedId === repo.id ? 'border-primary bg-primary-soft' : 'border-border hover:bg-page-bg'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{repo.name}</p>
                <p className="truncate text-xs text-text-muted">{repo.description}</p>
              </div>
              <input
                type="radio"
                name="repo"
                value={repo.id}
                checked={selectedId === repo.id}
                onChange={() => onSelect(repo.id)}
                aria-label={repo.name}
                className="size-4 shrink-0 accent-primary"
              />
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}
