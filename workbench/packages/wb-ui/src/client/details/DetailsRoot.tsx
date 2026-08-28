import type { DetailsOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './DetailsRoot.module.css'
import { useSovereignActivity } from '../live/hooks.ts'
import { useNavigation } from '../mock/index.ts'

export function DetailsRoot(_props: DetailsOwnerProps) {
  const { activityLog, isLoading } = useSovereignActivity()
  const { page } = useNavigation()

  let content = null

  switch (page) {
    case 'documents':
    case 'document_viewer':
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Document Properties</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Classification</div>
              <div className={styles.eventSummary}>RESTRICTED</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Owner</div>
              <div className={styles.eventSummary}>Engineering Dept</div>
            </div>
          </div>
        </div>
      )
      break
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
              <div className={styles.eventTime}>Last updated</div>
              <div className={styles.eventSummary}>Today, 08:00 AM</div>
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
              {activityLog.map((event, idx) => {
                const d = new Date(event.at)
                const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
                
                return (
                  <div key={idx} className={styles.event}>
                    <div className={styles.eventTime}>{timeStr}</div>
                    <div className={styles.eventSummary}>{event.summary}</div>
                  </div>
                )
              })}
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
