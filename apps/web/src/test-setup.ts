import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom keeps one document across a file's tests; without this, a query in the
// second test can match the first test's markup and pass for the wrong reason.
afterEach(cleanup)
