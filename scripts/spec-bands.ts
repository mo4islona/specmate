/**
 * The band registry, and the two questions asked of it: does this ID belong to
 * this capability, and what is the next one free.
 *
 * Separate from the lint because these are the rules — openspec-standard rule 7 —
 * and a rule nothing can exercise on its own is a rule nobody notices breaking.
 */

export interface BandRegistry {
  readonly bandSize: number
  /** Capability to the blocks it holds, oldest first. */
  readonly bands: ReadonlyMap<string, readonly number[]>
}

/**
 * `capability: 900` or `capability: [900, 1900]`. Two spellings because a
 * capability that fills a block claims another rather than renumbering: an ID
 * is immutable, so growth has to be additive.
 */
export function parseRegistry(text: string): BandRegistry {
  const bands = new Map<string, number[]>()
  let bandSize = 100

  for (const line of text.split('\n')) {
    const size = line.match(/^bandSize:\s*(\d+)/)
    if (size?.[1]) {
      bandSize = Number(size[1])
      continue
    }

    const entry = line.match(/^ {2}([a-z0-9-]+):\s*(.+)$/)
    if (!entry?.[1] || !entry[2]) continue

    const starts = [...entry[2].matchAll(/\d+/g)].map((match) => Number(match[0]))
    if (starts.length === 0) continue

    bands.set(
      entry[1],
      starts.sort((a, b) => a - b),
    )
  }

  return { bandSize, bands }
}

/** The block `n` falls in for this capability, or undefined when it falls in none. */
export function bandOf(registry: BandRegistry, capability: string, n: number): number | undefined {
  return registry.bands
    .get(capability)
    ?.find((start) => n >= start && n < start + registry.bandSize)
}

/**
 * The next number to allocate, from the capability's newest block only. Earlier
 * blocks are closed rather than backfilled: "the lowest free number" splits one
 * requirement's scenarios across two blocks every time a block runs low, and a
 * spec that reads properly is worth more than eight reclaimed integers.
 *
 * Null when the newest block is full too — the capability needs another one.
 */
export function nextFree(
  registry: BandRegistry,
  capability: string,
  maxUsedInBand: ReadonlyMap<number, number>,
): number | null {
  const starts = registry.bands.get(capability)
  const newest = starts?.[starts.length - 1]
  if (newest === undefined) return null

  const candidate = (maxUsedInBand.get(newest) ?? newest - 1) + 1

  return candidate < newest + registry.bandSize ? candidate : null
}
