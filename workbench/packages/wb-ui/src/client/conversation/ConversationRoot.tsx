import type { ConvOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './ConversationRoot.module.css'
import { ChatComposer } from './ChatComposer.tsx'
import { ChatHomeView } from './ChatHomeView.tsx'
import { DocumentsView } from '../documents/DocumentsView.tsx'
import { DocumentViewer } from '../documents/DocumentViewer.tsx'
import { EngineeringVisionView } from '../vision/EngineeringVisionView.tsx'
import { ActivityView } from '../activity/ActivityView.tsx'
import { SecurityConsoleView } from '../security/SecurityConsoleView.tsx'
import { SettingsView } from '../settings/SettingsView.tsx'
import { SearchView } from '../search/SearchView.tsx'
import { useNavigation } from '../mock/index.ts'

export function ConversationRoot(_props: ConvOwnerProps) {
  const { page } = useNavigation()

  // Routing switch
  switch (page) {
    case 'documents':
      return <DocumentsView />
    case 'document_viewer':
      return <DocumentViewer />
    case 'vision':
      return <EngineeringVisionView />
    case 'activity':
      return <ActivityView />
    case 'security':
      return <SecurityConsoleView />
    case 'settings':
      return <SettingsView />
    case 'search':
      return <SearchView />
    case 'chat':
    default:
      return (
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.agentInfo}>
              <h2>Document Analyst</h2>
              <div className={styles.presetDesc}>Analyze reports and internal documents</div>
            </div>
            <div className={styles.modelIndicator}>
              <span>Model: Auto-selected</span>
            </div>
          </div>
          
          <div className={styles.messageList}>
            <ChatHomeView />
            
            {/* The actual messages would go here in a populated state */}
          </div>

          <div className={styles.composerArea}>
            <ChatComposer />
          </div>
        </div>
      )
  }
}
