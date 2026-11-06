import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { TEST_CONFIG_TEXT } from '../../src/lib/review.constants'
import type { ReviewDetailDto, TestConfigDto } from '../../src/models/dto'
import { DEFAULT_TEST_CONFIG, isTestConfigDto, Review } from '../../src/models/review.model'
import { createReviewService } from '../../src/services/review.service'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { fixtureData } from '../utils/fixtureData'
import { selectTestConfig } from '../../src/store/review.slice'
import { createFakeServices, detailOf } from '../utils/fakeServices'
import { generatedTestFileList, sampleReview } from '../utils/sampleData'
import { renderWithStore } from '../utils/renderWithStore'

// Plan 034, Workstream C: Framework and Test Type are kept per review in the store (stored on the
// review by Regenerate), so switching tabs, reloading and reopening keep them; Copy all is an
// icon button beside the "Test Configuration" title.

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco">{value}</div>
}))

const stored: TestConfigDto = { framework: 'Vitest', testTypeIdList: ['edge'] }

function servicesWith(testConfig?: TestConfigDto) {
  const fake = createFakeServices()
  fake.services.review.get.mockImplementation(async (id: string): Promise<ReviewDetailDto> => detailOf(id, { ...structuredClone(sampleReview), ...(testConfig ? { testConfig } : {}) }))
  return fake
}

async function openGeneratedTests(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: /Generated tests/ }))
}

const framework = () => screen.getByRole('combobox', { name: TEST_CONFIG_TEXT.framework }) as HTMLSelectElement
const typeBox = (name: string) => screen.getByRole('checkbox', { name })

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.clear()
  writeText = vi.fn().mockResolvedValue(undefined)
})

describe('Test configuration (plan 034)', () => {
  it('starts from the review stored configuration', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/review/r1', services: servicesWith(stored).services })
    await openGeneratedTests(user)

    expect(framework().value).toBe('Vitest')
    expect(typeBox('Unit Tests')).not.toBeChecked()
    expect(typeBox('Edge Cases')).toBeChecked()
    expect(typeBox('Error Cases')).not.toBeChecked()
  })

  it('reads a review without one as the default (Jest, every kind)', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/review/r1', services: servicesWith().services })
    await openGeneratedTests(user)

    expect(framework().value).toBe('Jest')
    for (const name of ['Unit Tests', 'Edge Cases', 'Error Cases']) expect(typeBox(name)).toBeChecked()
  })

  it('keeps an unsent choice when switching tabs and back', async () => {
    const user = userEvent.setup()
    const { store } = renderWithStore(<App />, { route: '/review/r1', services: servicesWith().services })
    await openGeneratedTests(user)

    await user.selectOptions(framework(), 'Mocha')
    await user.click(typeBox('Unit Tests'))
    await user.click(screen.getByRole('tab', { name: 'Summary' }))
    await openGeneratedTests(user)

    expect(framework().value).toBe('Mocha')
    expect(typeBox('Unit Tests')).not.toBeChecked()
    expect(selectTestConfig(store.getState(), 'r1')).toEqual({ framework: 'Mocha', testTypeIdList: ['edge', 'error'] })
  })

  it('sends the choice with Regenerate and keeps it as the review stored configuration', async () => {
    const user = userEvent.setup()
    const { services } = servicesWith()
    const { store } = renderWithStore(<App />, { route: '/review/r1', services })
    await openGeneratedTests(user)

    await user.selectOptions(framework(), 'Vitest')
    await user.click(typeBox('Unit Tests'))
    await user.click(typeBox('Error Cases'))
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))

    expect(services.review.regenerateTest).toHaveBeenCalledWith('r1', stored)
    await vi.waitFor(() => expect(store.getState().review.current?.review?.testConfig).toEqual(stored))
    expect(store.getState().review.testConfigById).toEqual({})
    expect(framework().value).toBe('Vitest')
  })

  it('needs at least one test type: Regenerate is off and a hint says why', async () => {
    const user = userEvent.setup()
    const { services } = servicesWith(stored)
    renderWithStore(<App />, { route: '/review/r1', services })
    await openGeneratedTests(user)

    await user.click(typeBox('Edge Cases'))

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    expect(screen.getByText(TEST_CONFIG_TEXT.testTypeRequired)).toBeInTheDocument()
    await user.click(typeBox('Error Cases'))
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(screen.queryByText(TEST_CONFIG_TEXT.testTypeRequired)).not.toBeInTheDocument()
  })

  it('fake backend: the stored choice survives leaving and reopening the review', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/review/r1' })
    await openGeneratedTests(user)
    await user.selectOptions(framework(), 'Mocha')
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(await screen.findByText('Tests regenerated')).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /Review History/ })[0])
    await user.click((await screen.findAllByRole('link', { name: /Authentication Service/ }))[0])
    await openGeneratedTests(user)

    expect(framework().value).toBe('Mocha')
  })
})

describe('Copy all (plan 034)', () => {
  it('is an icon button beside the title with a tooltip, an accessible name and a border; it copies every file', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWithStore(<App />, { route: '/review/r1', services: servicesWith().services })
    await openGeneratedTests(user)

    const button = screen.getByRole('button', { name: TEST_CONFIG_TEXT.copyAll })
    expect(button).toHaveAttribute('title', TEST_CONFIG_TEXT.copyAll)
    expect(button).toHaveTextContent('')
    expect(button).toHaveClass('border', 'hover:bg-primary-soft')
    // On the same row as the "Test Configuration" title.
    expect(button.parentElement).toContainElement(screen.getByRole('heading', { name: TEST_CONFIG_TEXT.title }))

    await user.click(button)
    expect(writeText).toHaveBeenCalledWith(generatedTestFileList.map((file) => `// ---- ${file.testFile} ----\n${file.code}`).join('\n'))
    expect(await screen.findByText(TEST_CONFIG_TEXT.copiedAll)).toBeInTheDocument()
  })

  it('shows every "Tests generated for" file in its own scroll area, names wrapped, never truncated', async () => {
    const user = userEvent.setup()
    renderWithStore(<App />, { route: '/review/r1', services: servicesWith().services })
    await openGeneratedTests(user)

    const list = screen.getByRole('list', { name: TEST_CONFIG_TEXT.generatedFor })
    expect(list).toHaveClass('overflow-auto')
    for (const file of generatedTestFileList) {
      const name = screen.getByText(file.sourceFile, { selector: 'span' })
      expect(name).toHaveClass('break-all')
      expect(name).not.toHaveClass('truncate')
    }
  })
})

describe('TestConfig model and the fake backend', () => {
  it('accepts one to three distinct kinds of a known framework only', () => {
    expect(isTestConfigDto(DEFAULT_TEST_CONFIG)).toBe(true)
    expect(isTestConfigDto({ framework: 'Vitest', testTypeIdList: ['edge'] })).toBe(true)
    expect(isTestConfigDto({ framework: 'Vitest', testTypeIdList: [] })).toBe(false)
    expect(isTestConfigDto({ framework: 'Jasmine', testTypeIdList: ['unit'] })).toBe(false)
    expect(isTestConfigDto({ framework: 'Jest', testTypeIdList: ['unit', 'unit'] })).toBe(false)
    expect(isTestConfigDto({ framework: 'Jest', testTypeIdList: ['unit'], extra: 1 })).toBe(false)
    expect(new Review(sampleReview).testConfig).toEqual(DEFAULT_TEST_CONFIG)
  })

  it('stores a sent configuration with the review and refuses an invalid one (422)', async () => {
    const service = createReviewService(createFixtureDataSource({ data: structuredClone(fixtureData) }))

    await service.regenerateTest('r1', { framework: 'Mocha', testTypeIdList: ['error', 'unit'] })
    expect((await service.get('r1'))?.review.testConfig).toEqual({ framework: 'Mocha', testTypeIdList: ['unit', 'error'] })
    await expect(service.regenerateTest('r1', { framework: 'Jest', testTypeIdList: [] })).rejects.toMatchObject({ status: 422 })
    expect((await service.get('r1'))?.review.testConfig?.framework).toBe('Mocha')
  })
})
