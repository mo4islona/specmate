import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** One list for every call, rather than one per render. */
const PLUGINS = [remarkGfm]

/**
 * Memoized against the words it was given, because it is drawn a few hundred at
 * a time down a thread and every one of them parses its own markdown.
 */
export const ArtifactMarkdown = memo(function ArtifactMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={PLUGINS}>{content}</ReactMarkdown>
})
