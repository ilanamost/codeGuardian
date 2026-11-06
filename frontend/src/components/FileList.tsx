import { GITHUB_LIST_LIMIT, GITHUB_TEXT } from '../lib/github.constants'
import type { GithubFile } from '../types'
import ListNote from './ListNote'
import Loader from './Loader'

type Props = {
  fileList: GithubFile[]
  selectedIdList: string[]
  onToggle: (id: string) => void
  // The repository has more files than the wizard lists (contract 0.9.0).
  truncated?: boolean
  // The list has loaded, so an empty list means the repository has no supported file.
  loaded?: boolean
  // Plan 037: the repository's files are loading; with no rows yet the Loader is shown.
  loading?: boolean
}

export default function FileList({ fileList, selectedIdList, onToggle, truncated = false, loaded = false, loading = false }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {truncated && <ListNote>{GITHUB_TEXT.fileTruncated(GITHUB_LIST_LIMIT.file)}</ListNote>}
      {loading && fileList.length === 0 ? (
        <Loader label={GITHUB_TEXT.loadingFile} className="py-6" />
      ) : loaded && fileList.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">{GITHUB_TEXT.noFile}</p>
      ) : (
        <ul aria-label="Files" className="flex flex-col gap-2">
          {fileList.map((file) => {
            const selected = selectedIdList.includes(file.id)
            return (
              <li key={file.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-left ${
                    selected ? 'border-primary bg-primary-soft' : 'border-border hover:bg-page-bg'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm font-medium">{file.path}</p>
                    <p className="text-xs text-text-muted">{file.language}</p>
                  </div>
                  <input
                    type="checkbox"
                    name="file"
                    value={file.id}
                    checked={selected}
                    onChange={() => onToggle(file.id)}
                    aria-label={file.path}
                    className="size-4 shrink-0 accent-primary"
                  />
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
