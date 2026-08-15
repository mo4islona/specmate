/**
 * Caps are announced, never silent: an agent that is told its input was cut can
 * say so in its result, and a human reading a bad run can see why it was bad.
 */
export function truncate(text: string, limitBytes: number, what: string): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= limitBytes) return text

  const kept = bytes.subarray(0, limitBytes).toString('utf8')

  return `${kept}\n\n[truncated: ${what} exceeded ${limitBytes} bytes and was cut here]\n`
}
