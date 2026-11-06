import { LANGUAGE_EXTENSION, STUB_ANALYZER_DEFAULT } from '../utils/constants.js'

// The names of a review's generated test file, the same for the stub and the Claude analyzer.

function slug(value: string): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return result || STUB_ANALYZER_DEFAULT.fileName
}

export function testFileNameOf(input: { reviewId: string, title: string, language: string }) {
  const extension = LANGUAGE_EXTENSION[input.language.toLowerCase()] ?? STUB_ANALYZER_DEFAULT.extension
  const name = slug(input.title)
  return {
    name,
    extension,
    id: `${input.reviewId}-t1`,
    sourceFile: `${name}.${extension}`,
    testFile: `${name}.test.${extension}`,
    language: input.language
  }
}
