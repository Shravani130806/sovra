import { useState } from 'react'
import styles from './SearchView.module.css'

export function SearchView() {
  const [query, setQuery] = useState('')

  const hasResults = query.length > 2

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

      {!hasResults && query.length > 0 && (
        <div className={styles.emptyState}>
          <p>No results found for "{query}"</p>
        </div>
      )}

      {hasResults && (
        <>
          <div className={styles.resultsGroup}>
            <h3>Documents</h3>
            <div className={styles.resultList}>
              <div className={styles.resultCard}>
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>Engineering Safety Manual.pdf</div>
                  <div className={styles.resultMeta}>
                    <span className={styles.resultBadge}>Restricted</span>
                    <span>PDF • Engineering • 28 Aug 2026</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.resultsGroup}>
            <h3>Conversations</h3>
            <div className={styles.resultList}>
              <div className={styles.resultCard}>
                <div className={styles.resultInfo}>
                  <div className={styles.resultTitle}>Pump P-101 inspection analysis</div>
                  <div className={styles.resultMeta}>
                    <span>Document Analyst • Yesterday</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!hasResults && query.length === 0 && (
        <div className={styles.emptyState}>
          <p>Type to start searching your Sovereign Workspace.</p>
        </div>
      )}
    </div>
  )
}
