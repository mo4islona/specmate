import { BRIEF_ACCENT_HEADING, normalizeBriefHeading, splitBriefSections } from '@specmate/core'
import { ArtifactMarkdown } from './artifact-markdown.tsx'

/**
 * REQ-913: the brief rendered where the gate actions are, its key-points
 * block visually accented. Falls back to the raw document when it does not
 * parse into the brief's own sections — never hides content the owner needs
 * to decide on.
 */
export function KickoffBrief({ content }: { content: string }) {
  const sections = splitBriefSections(content)
  if (sections.length === 0) {
    return (
      <div className="artifact-document mt-4 text-sm">
        <ArtifactMarkdown content={content} />
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      {sections.map((section, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: sections are recomputed fresh from `content` every render; the index only disambiguates a heading a brief repeats.
          key={`${section.heading}-${index}`}
          className={
            normalizeBriefHeading(section.heading) === normalizeBriefHeading(BRIEF_ACCENT_HEADING)
              ? 'border-l-2 border-l-amber bg-amber/5 p-4'
              : ''
          }
        >
          <div className="artifact-document text-sm">
            <ArtifactMarkdown
              content={section.heading ? `## ${section.heading}\n\n${section.body}` : section.body}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
