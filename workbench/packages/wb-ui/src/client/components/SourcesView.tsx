import { useSourceCitations } from '../live/hooks.ts'
import { openDocument } from '../live/navigation-store.ts'
import type { WbCitation } from '@mrpl/dsh-workbench-types'
import styles from './SourcesView.module.css'

/** Where in a document a citation points, in words. */
function locatorOf(cite: { page?: number; section?: string }): string {
  if (cite.page !== undefined) return `Page ${cite.page}`
  if (cite.section !== undefined) return `Section ${cite.section}`
  return 'Full document'
}

export interface SourcesViewProps {
  citations?: readonly WbCitation[] | undefined
}

export function SourcesView({ citations: propCitations }: SourcesViewProps = {}) {
  const hookCitations = useSourceCitations()
  const citations = propCitations ?? hookCitations

  // An answer with no retrieval has no sources panel at all, rather than an
  // empty one implying retrieval ran and found nothing.
  if (citations.length === 0) return null

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Sources</h3>
      <div className={styles.list}>
        {citations.map((cite, i) => (
          <button
            key={`${cite.documentId}-${i}`}
            type="button"
            className={styles.item}
            // The path from a claim to the passage behind it: without this a
            // citation is a label, not something an engineer can check.
            onClick={() => openDocument(cite.documentId, {
              ...(cite.page !== undefined ? { page: cite.page } : {}),
              ...(cite.section !== undefined ? { section: cite.section } : {}),
            })}
          >
            <div className={styles.index}>{i + 1}</div>
            <div className={styles.details}>
              <div className={styles.docTitle}>{cite.title}</div>
              <div className={styles.locator}>{locatorOf(cite)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
