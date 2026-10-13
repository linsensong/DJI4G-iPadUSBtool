import 'vitest'
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

// Vitest 5 uses Matchers<R, T> for third-party assertion declarations.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Module augmentation requires an interface.
  interface Matchers<R, T> extends TestingLibraryMatchers<T, R> {}
}
