import { afterAll, describe, expect, test } from 'bun:test'
import { detectToolchains } from '../src/toolchains.ts'
import { cleanupTempDirs, tempDir, writeFiles } from './fixtures.ts'

afterAll(cleanupTempDirs)

async function detect(files: Record<string, string>) {
  const tree = await tempDir('toolchains')
  await writeFiles(tree, files)

  return detectToolchains(tree)
}

describe('toolchain detection', () => {
  test.each([
    {
      manifest: '.mise.toml',
      contents: '[tools]\nnode = "22.14.0"\npython = { version = "3.12.9" }\n',
      expected: [
        { name: 'node', version: '22.14.0' },
        { name: 'python', version: '3.12.9' },
      ],
    },
    {
      manifest: '.tool-versions',
      contents: 'nodejs 20.18.3\npython 3.11.11\n',
      expected: [
        { name: 'node', version: '20.18.3' },
        { name: 'python', version: '3.11.11' },
      ],
    },
    {
      manifest: '.nvmrc',
      contents: 'v22.13.1\n',
      expected: [{ name: 'node', version: 'v22.13.1' }],
    },
    {
      manifest: '.node-version',
      contents: '21.7.3\n',
      expected: [{ name: 'node', version: '21.7.3' }],
    },
    {
      manifest: '.python-version',
      contents: '3.13.1\n',
      expected: [{ name: 'python', version: '3.13.1' }],
    },
    {
      manifest: 'rust-toolchain.toml',
      contents: '[toolchain]\nchannel = "1.84.0"\n',
      expected: [{ name: 'rust', version: '1.84.0' }],
    },
    { manifest: 'bun.lock', contents: '', expected: [{ name: 'bun' }] },
    {
      manifest: 'Cargo.toml',
      contents: '[package]\nname = "demo"\nrust-version = "1.82"\n',
      expected: [{ name: 'rust', version: '>=1.82' }],
    },
    {
      manifest: 'pyproject.toml',
      contents: '[project]\nrequires-python = ">=3.12"\n',
      expected: [{ name: 'python', version: '>=3.12' }],
    },
    {
      manifest: 'package.json',
      contents: '{"engines":{"node":">=22"},"packageManager":"bun@1.2.2"}',
      expected: [
        { name: 'bun', version: '1.2.2' },
        { name: 'node', version: '>=22' },
      ],
    },
  ])('reads $manifest', async ({ manifest, contents, expected }) => {
    expect(await detect({ [manifest]: contents })).toEqual(expected)
  })

  test('returns the baseline environment for an empty repository', async () => {
    expect(await detect({})).toEqual([])
  })

  test('ignores an empty tool name instead of recording an invalid declaration', async () => {
    expect(await detect({ '.mise.toml': '[tools]\n"" = "1.0.0"\n' })).toEqual([])
  })

  test('prefers an explicit declaration over a manifest presence check', async () => {
    expect(await detect({ '.nvmrc': '22.14.0\n', 'package.json': '{}' })).toEqual([
      { name: 'node', version: '22.14.0' },
    ])
  })

  test('reads the Node devEngines declaration used by mise', async () => {
    expect(
      await detect({
        'package.json': JSON.stringify({
          devEngines: { runtime: { name: 'node', version: '^22.14.0' } },
        }),
      }),
    ).toEqual([{ name: 'node', version: '^22.14.0' }])
  })

  test('returns the same sorted environment on repeated detection', async () => {
    const tree = await tempDir('toolchains-repeat')
    await writeFiles(tree, {
      '.python-version': '3.12.9\n',
      'Cargo.toml': '[package]\nname = "demo"\n',
      'bun.lock': '',
    })

    const first = await detectToolchains(tree)
    const second = await detectToolchains(tree)

    expect(first).toEqual([
      { name: 'bun' },
      { name: 'python', version: '3.12.9' },
      { name: 'rust' },
    ])
    expect(second).toEqual(first)
  })
})
