import { useState } from 'react'
import styles from './DocumentViewer.module.css'
import { useDocuments, useNavigation, useSourceCitations } from '../live/hooks.ts'
import { navigate } from '../live/navigation-store.ts'

export function DocumentViewer() {
  const { documentId, locator } = useNavigation()
  const { documents } = useDocuments()
  const citations = useSourceCitations()

  const doc = documentId ? documents.find((d) => d.id === documentId) : undefined
  const [currentPage, setCurrentPage] = useState(locator?.page ?? 1)

  if (!doc) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <button
              type="button"
              className={styles.controlBtn}
              onClick={() => navigate('documents')}
              aria-label="Back to documents"
            >
              ← Back to documents
            </button>
            <h1 className={styles.title}>Document Not Found</h1>
          </div>
        </div>
        <div className={styles.notFound}>
          <p>The requested document was not found in the sovereign corpus.</p>
        </div>
      </div>
    )
  }

  const title = doc.title
  const classification = doc.classification
  const chunks = doc.chunksData && doc.chunksData.length > 0
    ? doc.chunksData
    : doc.content
      ? [{ id: 'c1', text: doc.content, page: 1, section: 'Full Document' }]
      : []

  const totalPages = Math.max(1, Math.max(...chunks.map((c) => c.page ?? 1), doc.chunks))
  const displayedChunks = chunks.filter((c) => (c.page ?? 1) === currentPage || chunks.length <= 3)

  const relatedCitations = citations.filter((c) => c.documentId === documentId)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => navigate('documents')}
            aria-label="Back to documents"
          >
            ← Back
          </button>
          <h1 className={styles.title}>{title}</h1>
          <span className={styles.badge}>{classification}</span>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            ←
          </button>
          <span style={{ fontSize: '0.85rem', padding: '0 0.5rem', color: 'var(--wb-text-primary, #fff)' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className={styles.controlBtn}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
          >
            →
          </button>
        </div>
      </div>

      <div className={styles.contentArea}>
        <div className={styles.viewerPane}>
          <div className={styles.documentDoc}>
            <div className={styles.docSectionHeader}>
              <span>{locator?.section ? `Target: ${locator.section}` : `Viewing ${title}`}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--wb-text-secondary, #a1a1aa)' }}>
                {chunks.length > 0 ? `${chunks.length} extracted chunks` : 'Raw metadata'}
              </span>
            </div>

            <div className={styles.docBody}>
              {displayedChunks.length > 0 ? (
                displayedChunks.map((chunk) => {
                  const isHighlighted = Boolean(
                    (locator?.section && chunk.section?.includes(locator.section)) ||
                    (locator?.page && chunk.page === locator.page),
                  )
                  return (
                    <div
                      key={chunk.id}
                      className={`${styles.chunkCard} ${isHighlighted ? styles.chunkCardHighlighted : ''}`}
                    >
                      <div className={styles.chunkMeta}>
                        <span>{chunk.section ?? `Chunk #${chunk.id}`}</span>
                        {chunk.page ? <span>Page {chunk.page}</span> : null}
                      </div>
                      <div className={styles.chunkText}>
                        {isHighlighted ? (
                          <span className={styles.highlight}>{chunk.text}</span>
                        ) : (
                          chunk.text
                        )}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ color: 'var(--wb-text-secondary, #a1a1aa)', padding: '2rem 0' }}>
                  {doc.content ? doc.content : 'Document content indexed for semantic retrieval.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.citationPane}>
          <div className={styles.citationHeader}>Evidence &amp; Highlights</div>
          <div className={styles.citationList}>
            <div className={styles.citationCard}>
              <h4>Document Metadata</h4>
              <div className={styles.metaItem}>
                <span className={styles.metaKey}>Document ID:</span>
                <span className={styles.metaVal}>{doc.id}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaKey}>Classification:</span>
                <span className={styles.metaVal}>{doc.classification}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaKey}>Chunks:</span>
                <span className={styles.metaVal}>{doc.chunks}</span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaKey}>Ingested:</span>
                <span className={styles.metaVal}>{new Date(doc.ingestedAt).toLocaleDateString()}</span>
              </div>
            </div>

            {locator ? (
              <div className={styles.citationCard}>
                <h4>Active Citation Reference</h4>
                <p>
                  {locator.page ? `Page ${locator.page}` : ''}
                  {locator.page && locator.section ? ' • ' : ''}
                  {locator.section ? `Section ${locator.section}` : ''}
                </p>
              </div>
            ) : null}

            {relatedCitations.map((cit, idx) => (
              <div key={idx} className={styles.citationCard}>
                <h4>Citation #{idx + 1}</h4>
                <p>{cit.title}</p>
                {cit.page ? <p>Page {cit.page}</p> : null}
                {cit.section ? <p>Section: {cit.section}</p> : null}
              </div>
            ))}

            {relatedCitations.length === 0 && !locator ? (
              <div className={styles.citationCard}>
                <h4>Grounding Citations</h4>
                <p>No active chat citations currently reference this document.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
