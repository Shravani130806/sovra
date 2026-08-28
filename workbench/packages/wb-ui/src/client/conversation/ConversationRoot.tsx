import type { ConvOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './ConversationRoot.module.css'
import { ChatComposer } from './ChatComposer.tsx'
import { ChatHomeView } from './ChatHomeView.tsx'
import { MessageList } from './MessageList.tsx'
import { ModelSelector } from './ModelSelector.tsx'
import { DocumentsView } from '../documents/DocumentsView.tsx'
import { DocumentViewer } from '../documents/DocumentViewer.tsx'
import { EngineeringVisionView } from '../vision/EngineeringVisionView.tsx'
import { ActivityView } from '../activity/ActivityView.tsx'
import { SecurityConsoleView } from '../security/SecurityConsoleView.tsx'
import { SettingsView } from '../settings/SettingsView.tsx'
import { SearchView } from '../search/SearchView.tsx'
import { useChat, useNavigation } from '../live/hooks.ts'
import { dispatchTurnToModel } from '../live/chat-store.ts'

const PRESET_META: Record<string, { title: string; desc: string }> = {
  'document-analyst': { title: 'Document Analyst', desc: 'Analyze reports and internal documents' },
  'engineering-vision': { title: 'Engineering Vision', desc: 'Inspect P&IDs, blueprints, and equipment schematics' },
  'code-analysis': { title: 'Code Analysis', desc: 'Run sandbox analysis and verification scripts' },
  research: { title: 'Research Agent', desc: 'Search and cross-reference verified sovereign sources' },
  artifact: { title: 'Artifact Generator', desc: 'Synthesize verified reports, notes, and tables' },
}

export function ConversationRoot(_props: ConvOwnerProps) {
  const { route, documentId } = useNavigation()
  const { turns, preset } = useChat()

  const meta = PRESET_META[preset] ?? {
    title: preset.replace('-', ' '),
    desc: 'Sovereign AI operations',
  }

  function handleSend(text: string, attachments?: string[]) {
    void dispatchTurnToModel(text, new AbortController(), attachments)
  }

  // Routing switch
  switch (route) {
    case 'documents':
      return documentId ? <DocumentViewer /> : <DocumentsView />
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
              <h2>{meta.title}</h2>
              <div className={styles.presetDesc}>{meta.desc}</div>
            </div>
            <div className={styles.modelIndicator}>
              <ModelSelector />
            </div>
          </div>

          <div className={styles.messageList}>
            {turns.length === 0 ? (
              <ChatHomeView onSelectPrompt={handleSend} />
            ) : (
              <MessageList />
            )}
          </div>

          <div className={styles.composerArea}>
            <ChatComposer onSend={handleSend} />
          </div>
        </div>
      )
  }
}
