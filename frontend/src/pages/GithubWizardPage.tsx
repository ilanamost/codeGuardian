import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import FileList from '../components/FileList'
import GithubConnectCard from '../components/GithubConnectCard'
import GithubLinkImport from '../components/GithubLinkImport'
import RepoList from '../components/RepoList'
import RepoSearch from '../components/RepoSearch'
import WizardFooter from '../components/WizardFooter'
import WizardStepper from '../components/WizardStepper'
import { GITHUB_IMPORT_LIMIT, GITHUB_TEXT, wizardStepList } from '../lib/github.constants'
import { ROUTE_PATH } from '../lib/route.constants'
import { useMounted } from '../lib/useMounted'
import { toggleItem } from '../services/util.service'
import {
  connectGithub,
  disconnectGithub,
  githubReset,
  importGithubFile,
  importGithubFileList,
  repoCleared,
  searchRepo,
  selectGithub,
  selectRepo as selectRepoThunk
} from '../store/github.slice'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { errorReported } from '../store/listener'
import type { WizardStep } from '../types'
import { FORM_ERROR_MESSAGE } from '../utils/error-messages'

export default function GithubWizardPage() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const mounted = useMounted()
  const {
    account,
    repoList,
    repoTruncated,
    selectedRepoId: repoId,
    fileList,
    fileTruncated,
    fileStatus,
    repoStatus,
    status: connectStatus,
    disconnectStatus,
    importStatus,
    importProgress
  } = useAppSelector(selectGithub)
  // Wizard UI state stays local; account, repositories and files come from the store.
  const [step, setStep] = useState<WizardStep>('repo')
  const [search, setSearch] = useState('')
  const [fileIdList, setFileIdList] = useState<string[]>([])
  const [shownAccount, setShownAccount] = useState(account)
  // The multi-file import in flight, cancelled when the user leaves the wizard.
  const importRequest = useRef<{ abort: () => void } | null>(null)

  // Whenever the account goes away (Switch account, or a 409 from any repository route, QA F2)
  // the wizard starts again at the first step with the connect card. Adjusted while rendering,
  // so no blank "Select File" step is ever painted.
  if (account !== shownAccount) {
    setShownAccount(account)
    if (!account) {
      setStep('repo')
      setFileIdList([])
    }
  }

  const selectedFileList = fileList.filter((item) => fileIdList.includes(item.id))
  // Plan 034: at most 20 files at a time (GitHub's 60 calls an hour without sign-in).
  const overLimit = selectedFileList.length > GITHUB_IMPORT_LIMIT.fileCount
  const importing = importStatus === 'loading'

  // The wizard starts over every time the page is opened, as before.
  useEffect(() => {
    dispatch(githubReset())
    return () => {
      importRequest.current?.abort()
      dispatch(githubReset())
    }
  }, [dispatch])

  function changeSearch(value: string) {
    setSearch(value)
    dispatch(searchRepo(value))
  }

  function reset() {
    setStep('repo')
    setSearch('')
    setFileIdList([])
    dispatch(repoCleared())
    if (account) dispatch(searchRepo(''))
  }

  // The server forgets the account first; on failure the account stays and a toast says why.
  async function switchAccount() {
    await dispatch(disconnectGithub())
  }

  function selectRepo(id: string) {
    dispatch(selectRepoThunk(id))
    setFileIdList([])
  }

  function toggleFile(id: string) {
    setFileIdList((list) => toggleItem(list, id))
  }

  // Import: one selected file opens in the editor as a new, unsaved review (plan 019). Plan 034
  // (Open Question 2): several files are downloaded one after the other and open as a list of
  // drafts; a failed file is listed with its error and reported once, the others are kept. A
  // failure of every file keeps the wizard as it is and shows a toast (store).
  async function approve() {
    const [first] = selectedFileList
    if (!first || !repoId || overLimit) return
    if (selectedFileList.length > 1) {
      await approveList(repoId)
      return
    }
    const result = await dispatch(importGithubFile({ repoId, fileId: first.id }))
    // On a 409 the store clears the account, and the wizard goes back to the connect card (above).
    if (!importGithubFile.fulfilled.match(result)) return
    toast.success(GITHUB_TEXT.imported(first.path, repoId))
    // A user who left the wizard while the file loaded stays where they went.
    if (mounted.current) navigate(ROUTE_PATH.newReview)
  }

  async function approveList(repoId: string) {
    const request = dispatch(importGithubFileList({ repoId, fileList: selectedFileList }))
    importRequest.current = request
    const result = await request
    importRequest.current = null
    // On a 409 the store clears the account, and the wizard goes back to the connect card (above).
    if (!importGithubFileList.fulfilled.match(result)) return
    const { itemList } = result.payload
    const failure = itemList.find((item) => item.error)?.error
    toast.success(GITHUB_TEXT.importedCount(itemList.filter((item) => !item.error).length, itemList.length, repoId))
    if (failure) dispatch(errorReported(failure))
    if (mounted.current) navigate(ROUTE_PATH.newReview)
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-(--page-padding)">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">GitHub Integration</h1>
        <p className="text-sm text-text-muted">Connect your GitHub account and import files for review.</p>
      </header>
      <GithubLinkImport />
      <div className="mb-6">
        <WizardStepper stepList={wizardStepList} current={step} onSelect={setStep} />
      </div>
      <section aria-labelledby="wizard-title" className="rounded-md border border-border bg-card p-4 shadow-card md:p-6">
        {step === 'repo' ? (
          <>
            <h2 id="wizard-title" className="text-base font-bold">
              Select Repository
            </h2>
            <p className="mb-4 text-sm text-text-muted">Choose a repository to import from.</p>
            <div className="flex flex-col gap-4">
              {/* A new card per account, so Switch account shows an empty user-name field again. */}
              <GithubConnectCard
                key={account?.login ?? ''}
                account={account}
                connecting={connectStatus === 'loading'}
                switching={disconnectStatus === 'loading'}
                onConnect={(username) => dispatch(connectGithub({ username, query: search }))}
                onSwitch={switchAccount}
              />
              {account && (
                <>
                  <RepoSearch value={search} onChange={changeSearch} />
                  <RepoList
                    repoList={repoList}
                    selectedId={repoId}
                    onSelect={selectRepo}
                    query={search}
                    truncated={repoTruncated}
                    loading={repoStatus === 'loading'}
                  />
                </>
              )}
            </div>
            <WizardFooter actionLabel="Next" actionDisabled={!repoId} onCancel={reset} onAction={() => setStep('file')} />
          </>
        ) : (
          <>
            <h2 id="wizard-title" className="text-base font-bold">
              Select File
            </h2>
            <p className="mb-4 text-sm text-text-muted">
              Repository: <span className="font-medium text-text">{repoId}</span>
            </p>
            <FileList
              fileList={fileList}
              selectedIdList={fileIdList}
              onToggle={toggleFile}
              truncated={fileTruncated}
              loaded={fileStatus === 'succeeded'}
              loading={fileStatus === 'loading'}
            />
            {overLimit && (
              <p role="alert" className="mt-4 text-sm text-error-text">
                {FORM_ERROR_MESSAGE.githubFileLimit(GITHUB_IMPORT_LIMIT.fileCount)}
              </p>
            )}
            {importing && importProgress && (
              <p role="status" className="mt-4 text-sm text-text-muted">
                {GITHUB_TEXT.importingCount(importProgress.done, importProgress.total)}
              </p>
            )}
            <WizardFooter
              actionLabel={importing ? GITHUB_TEXT.importing : GITHUB_TEXT.approve}
              actionDisabled={fileIdList.length === 0 || importing || overLimit}
              onCancel={reset}
              onAction={approve}
            />
          </>
        )}
      </section>
    </main>
  )
}
