import type { DetailsOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './DetailsRoot.module.css'
import { useDocuments, useNavigation, useSovereignActivity } from '../live/hooks.ts'

export function DetailsRoot(_props: DetailsOwnerProps) {
  const { activityLog, isLoading } = useSovereignActivity()
  const { route, documentId } = useNavigation()
  const { documents } = useDocuments()

  let content = null

  switch (route) {
    case 'documents': {
      const doc = documentId ? documents.find((d) => d.id === documentId) : undefined
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Document Properties</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Title</div>
              <div className={styles.eventSummary}>{doc?.title ?? 'Engineering Safety Manual.pdf'}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Classification</div>
              <div className={styles.eventSummary}>{doc?.classification ?? 'RESTRICTED'}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Chunks</div>
              <div className={styles.eventSummary}>{doc?.chunks ?? 128}</div>
            </div>
          </div>
        </div>
      )
      break
    }
    case 'security':
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Current Policy</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Engine</div>
              <div className={styles.eventSummary}>Active (Enforcing)</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Boundary</div>
              <div className={styles.eventSummary}>Sovereign / Isolated</div>
            </div>
          </div>
        </div>
      )
      break
    case 'vision':
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Drawing Info</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Model</div>
              <div className={styles.eventSummary}>Vision-Eng-v2</div>
            </div>
          </div>
        </div>
      )
      break
    case 'chat':
    default:
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Current Context</div>
          {isLoading ? (
            <div className={styles.loading}>Loading activity...</div>
          ) : (
            <div className={styles.timeline}>
              {activityLog.length === 0 ? (
                <div className={styles.event}>
                  <div className={styles.eventSummary}>No recent activity</div>
                </div>
              ) : (
                activityLog.map((event, idx) => {
                  const d = new Date(event.at)
                  const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`

                  return (
                    <div key={idx} className={styles.event}>
                      <div className={styles.eventTime}>{timeStr}</div>
                      <div className={styles.eventSummary}>{event.summary}</div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      )
      break
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3>Context</h3>
      </div>
      {content}
    </div>
  )
}
