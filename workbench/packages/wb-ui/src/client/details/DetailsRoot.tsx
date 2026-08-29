import type { DetailsOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './DetailsRoot.module.css'
import { useDocuments, useModels, useNavigation, useSovereignActivity } from '../live/hooks.ts'
import { useSovereignPolicy } from '../policy/use-sovereign-policy.ts'

export function DetailsRoot(_props: DetailsOwnerProps) {
  const { activityLog, isLoading } = useSovereignActivity()
  const { route, documentId } = useNavigation()
  const { documents } = useDocuments()
  const { capabilityRouting } = useModels()
  const { decision, isLocal } = useSovereignPolicy()

  let content = null

  switch (route) {
    case 'documents': {
      const doc = documentId ? documents.find((d) => d.id === documentId) : undefined
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Document Properties</div>
          {doc ? (
            <div className={styles.timeline}>
              <div className={styles.event}>
                <div className={styles.eventTime}>Title</div>
                <div className={styles.eventSummary}>{doc.title}</div>
              </div>
              <div className={styles.event}>
                <div className={styles.eventTime}>Classification</div>
                <div className={styles.eventSummary}>{doc.classification}</div>
              </div>
              <div className={styles.event}>
                <div className={styles.eventTime}>Chunks</div>
                <div className={styles.eventSummary}>{doc.chunks}</div>
              </div>
              <div className={styles.event}>
                <div className={styles.eventTime}>Ingested</div>
                <div className={styles.eventSummary}>{new Date(doc.ingestedAt).toLocaleDateString()}</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '0.75rem', color: 'var(--wb-text-secondary, #a1a1aa)', fontSize: '0.85rem' }}>
              No document currently opened. Select a document to view properties.
            </div>
          )}
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
              <div className={styles.eventSummary}>{isLocal ? 'Sovereign / Isolated' : 'External Active'}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Last Verdict</div>
              <div className={styles.eventSummary}>{decision}</div>
            </div>
          </div>
        </div>
      )
      break
    case 'vision':
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Vision Pipeline</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Model</div>
              <div className={styles.eventSummary}>{capabilityRouting.vision_reasoning.model}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Provider</div>
              <div className={styles.eventSummary}>{capabilityRouting.vision_reasoning.provider}</div>
            </div>
          </div>
        </div>
      )
      break
    case 'models':
      content = (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>Active Capabilities</div>
          <div className={styles.timeline}>
            <div className={styles.event}>
              <div className={styles.eventTime}>Chat</div>
              <div className={styles.eventSummary}>{capabilityRouting.main_chat.model}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Embedding</div>
              <div className={styles.eventSummary}>{capabilityRouting.embedding.model}</div>
            </div>
            <div className={styles.event}>
              <div className={styles.eventTime}>Rerank</div>
              <div className={styles.eventSummary}>{capabilityRouting.rerank.model}</div>
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
