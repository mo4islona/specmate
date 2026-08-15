import { describe, expect, test } from 'bun:test'
import {
  exactVersion,
  isVersionRange,
  parseRemoteVersions,
  resolvedToolchain,
  selectVersion,
  UnsupportedToolchainError,
} from '../src/toolchains.ts'

describe('toolchain resolution', () => {
  test('keeps exact versions exact and removes the Node v prefix', () => {
    expect(exactVersion('22.14.0')).toBe('22.14.0')
    expect(exactVersion('v22.14.0')).toBe('22.14.0')
    expect(exactVersion('>=22')).toBeNull()
  })

  test('recognises range requests without treating version prefixes as ranges', () => {
    expect(isVersionRange('>=3.12,<4')).toBe(true)
    expect(isVersionRange('^22')).toBe(true)
    expect(isVersionRange('22.14')).toBe(false)
  })

  test('selects the newest exact version satisfying a declared range', () => {
    expect(
      selectVersion({ name: 'python', version: '>=3.12,<3.14' }, [
        '3.11.11',
        '3.12.9',
        '3.13.2',
        '3.14.0',
      ]),
    ).toEqual({ name: 'python', version: '3.13.2' })
  })

  test('reads both supported Mise JSON version-list shapes', () => {
    expect(parseRemoteVersions('[{"version":"22.14.0"},"22.13.1",{}]')).toEqual([
      '22.14.0',
      '22.13.1',
    ])
  })

  test('turns the version returned for a versionless declaration into an exact pin', () => {
    expect(resolvedToolchain({ name: 'node' }, '22.14.0\n')).toEqual({
      name: 'node',
      version: '22.14.0',
    })
    expect(() => resolvedToolchain({ name: 'node' }, 'latest')).toThrow(/non-exact/)
  })

  test('rejects arbitrary tools before they can write the shared install store', () => {
    expect(() => resolvedToolchain({ name: 'npm:untrusted' }, '1.0.0')).toThrow(
      UnsupportedToolchainError,
    )
  })
})
