import { useState } from 'react'
import styles from './SearchView.module.css'
import { useChat, useDocuments, useSovereignActivity } from '../live/hooks.ts'
import { navigate, openDocument } from '../live/navigation-store.ts'

export function SearchView() {
  const [query, setQuery] = useState('')
  const { documents } = useDocuments()
  const { turns } = useChat()
  const { activityLog } = useSovereignActivity()

  const q = query.trim().toLowerCase()
  const hasQuery = q.length > 0

  const matchedDocs = hasQuery
    ? documents.filter((d) => d.title.toLowerCase().includes(q) || d.classification.toLowerCase().includes(q))
    : []

  const matchedTurns = hasQuery
    ? turns.filter((t) => t.text.toLowerCase().includes(q))
    : []

  const matchedActivity = hasQuery
    ? activityLog.filter((a) => a.summary.toLowerCase().includes(q) || a.kind.toLowerCase().includes(q))
    : []

  const totalResults = matchedDocs.length + matchedTurns.length + matchedActivity.length

  return (
    <div className={styles.container}>
      <div className={styles.searchHeader}>
        <div className={styles.searchInputWrapper}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search documents, conversations, and activity..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className={styles.shortcut}>Ctrl + K</div>
        </div>
      </div>

      {!hasQuery && (
        <div className={styles.emptyState}>
          <p>Type to start searching your Sovereign Workspace.</p>
        </div>
      )}

      {hasQuery && totalResults === 0 && (
        <div className={styles.emptyState}>
          <p>No results found for &quot;{query}&quot;</p>
        </div>
      )}

      {matchedDocs.length > 0 && (
        <div className={styles.resultsGroup}>
          <h3>Documents</h3>
          <div className={styles.resultList}>
            {matchedDocs.map((doc) => (
              <div
                key={doc.id}
                className={styles.resultCard}
                onClick={() => openDocument(doc.id)}
                role="button"
                tabIndex={0}
              >
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>{doc.title}</div>
                  <div className={styles.resultMeta}>
                    <span className={styles.resultBadge}>{doc.classification}</span>
                    <span>{doc.chunks} chunks • {new Date(doc.ingestedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {matchedTurns.length > 0 && (
        <div className={styles.resultsGroup}>
          <h3>Conversations</h3>
          <div className={styles.resultList}>
            {matchedTurns.map((turn) => (
              <div
                key={turn.id}
                className={styles.resultCard}
                onClick={() => navigate('chat')}
                role="button"
                tabIndex={0}
              >
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>
                    {turn.text.length > 80 ? `${turn.text.slice(0, 80)}…` : turn.text}
                  </div>
                  <div className={styles.resultMeta}>
                    <span>Role: {turn.role}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {matchedActivity.length > 0 && (
        <div className={styles.resultsGroup}>
          <h3>Activity</h3>
          <div className={styles.resultList}>
            {matchedActivity.map((act) => (
              <div
                key={act.id}
                className={styles.resultCard}
                onClick={() => navigate('activity')}
                role="button"
                tabIndex={0}
              >
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>{act.summary}</div>
                  <div className={styles.resultMeta}>
                    <span>{act.kind} • {new Date(act.at).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
