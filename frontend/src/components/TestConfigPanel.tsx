import { Info } from 'lucide-react'
import { TEST_CONFIG_TEXT } from '../lib/review.constants'
import type { GeneratedTestFile, TestFramework, TestType, TestTypeId } from '../types'
import CopyButton from './CopyButton'

type Props = {
  frameworkList: TestFramework[]
  framework: TestFramework
  onFrameworkChange: (framework: TestFramework) => void
  testTypeList: TestType[]
  selectedTypeIdList: TestTypeId[]
  onTypeToggle: (id: TestTypeId) => void
  fileList: GeneratedTestFile[]
  activeFileId: string
  onFileSelect: (id: string) => void
  copyAllText: string
}

// Plan 034: Copy all is an icon button beside the title (border, hover, tooltip and accessible
// name), and "Tests generated for" has its own scroll area whose names wrap, so no file is ever
// cut off, at any width.
export default function TestConfigPanel({
  frameworkList,
  framework,
  onFrameworkChange,
  testTypeList,
  selectedTypeIdList,
  onTypeToggle,
  fileList,
  activeFileId,
  onFileSelect,
  copyAllText
}: Props) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 rounded-md border border-border bg-card p-4 text-left shadow-card lg:min-h-0 lg:w-72 lg:overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{TEST_CONFIG_TEXT.title}</h3>
        <CopyButton text={copyAllText} label={TEST_CONFIG_TEXT.copyAll} variant="icon" successMessage={TEST_CONFIG_TEXT.copiedAll} />
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <label htmlFor="test-framework" className="text-xs text-text-muted">
          {TEST_CONFIG_TEXT.framework}
        </label>
        <select
          id="test-framework"
          value={framework}
          onChange={(event) => onFrameworkChange(event.target.value as TestFramework)}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          {frameworkList.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex shrink-0 flex-col gap-2">
        <legend className="mb-2 text-xs text-text-muted">{TEST_CONFIG_TEXT.testType}</legend>
        {testTypeList.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedTypeIdList.includes(item.id)}
              onChange={() => onTypeToggle(item.id)}
              className="size-4 accent-primary"
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <div data-testid="tests-generated-for" className="flex shrink-0 flex-col gap-2 rounded-md bg-primary-soft p-3 lg:min-h-32 lg:flex-1 lg:shrink">
        <h4 className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <Info size={14} aria-hidden="true" />
          {TEST_CONFIG_TEXT.generatedFor}
        </h4>
        <ul aria-label={TEST_CONFIG_TEXT.generatedFor} className="flex max-h-60 min-h-0 flex-col gap-1 overflow-auto lg:max-h-none lg:flex-1">
          {fileList.map((file) => (
            <li key={file.id} className="shrink-0">
              <button
                type="button"
                aria-pressed={file.id === activeFileId}
                onClick={() => onFileSelect(file.id)}
                className={`w-full min-w-0 rounded-sm border px-2 py-1.5 text-left ${
                  file.id === activeFileId ? 'border-primary bg-card' : 'border-transparent hover:bg-card'
                }`}
              >
                <span className="block text-sm font-bold break-all">{file.sourceFile}</span>
                <span className="block text-xs text-text-muted">{file.language}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
