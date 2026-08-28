import styles from './ChatHomeView.module.css'
import { useChat } from '../live/hooks.ts'
import { setPreset } from '../live/chat-store.ts'

export interface ChatHomeViewProps {
  onSelectPrompt?: (text: string) => void
}

const AGENTS = [
  { id: 'document-analyst', icon: '📄', name: 'Document Analyst', desc: 'Files ✓ RAG ✓ Vision ○' },
  { id: 'engineering-vision', icon: '🔍', name: 'Engineering Vision', desc: 'Files ✓ RAG ✓ Vision ✓' },
  { id: 'code-analysis', icon: '💻', name: 'Code Analysis', desc: 'Files ✓ RAG ✓ Python ✓' },
  { id: 'research', icon: '🌐', name: 'Research', desc: 'RAG ✓ Web ✓ External API ✕' },
  { id: 'artifact', icon: '📝', name: 'Artifact', desc: 'Files ✓ RAG ✓ Artifacts ✓' },
]

const PROMPTS = [
  { category: 'Analyze', text: 'Analyze an inspection report' },
  { category: 'Search', text: 'Find relevant SOPs for compressor maintenance' },
  { category: 'Vision', text: 'Inspect a P&ID for valve configurations' },
  { category: 'Generate', text: 'Generate an approval note' },
]

export function ChatHomeView({ onSelectPrompt }: ChatHomeViewProps) {
  const { preset } = useChat()

  const currentPresetId = AGENTS.some((a) => a.id === preset)
    ? preset
    : AGENTS.find((a) => a.id.startsWith(preset) || preset.startsWith(a.id))?.id ?? 'document-analyst'

  return (
    <div className={styles.container}>
      <div className={styles.greeting}>
        <h1>Good morning.</h1>
        <p>How can I help you today?</p>
      </div>

      <div className={styles.agentGrid}>
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className={`${styles.agentCard} ${currentPresetId === agent.id ? styles.agentCardActive : ''}`}
            onClick={() => setPreset(agent.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setPreset(agent.id)
              }
            }}
          >
            <div className={styles.agentIcon}>{agent.icon}</div>
            <div className={styles.agentName}>{agent.name}</div>
            <div className={styles.agentDesc}>{agent.desc}</div>
          </div>
        ))}
      </div>

      <div className={styles.promptsGrid}>
        {PROMPTS.map((prompt, i) => (
          <div
            key={i}
            className={styles.promptCard}
            onClick={() => onSelectPrompt?.(prompt.text)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectPrompt?.(prompt.text)
              }
            }}
          >
            <span>{prompt.category}</span>
            {prompt.text}
          </div>
        ))}
      </div>
    </div>
  )
}
