import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function ArtifactMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
}
