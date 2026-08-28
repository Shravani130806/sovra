import { useState } from 'react'
import styles from './ChatHomeView.module.css'

export function ChatHomeView() {
  const [activeAgent, setActiveAgent] = useState('analyst')

  const agents = [
    { id: 'analyst', icon: '📄', name: 'Document Analyst', desc: 'Files ✓ RAG ✓ Vision ○' },
    { id: 'vision', icon: '🔍', name: 'Engineering Vision', desc: 'Files ✓ RAG ✓ Vision ✓' },
    { id: 'code', icon: '💻', name: 'Code Analysis', desc: 'Files ✓ RAG ✓ Python ✓' },
    { id: 'research', icon: '🌐', name: 'Research', desc: 'RAG ✓ Web ✓ External API ✕' },
    { id: 'artifact', icon: '📝', name: 'Artifact', desc: 'Files ✓ RAG ✓ Artifacts ✓' },
  ]

  const prompts = [
    { category: 'Analyze', text: 'Analyze an inspection report' },
    { category: 'Search', text: 'Find relevant SOPs for compressor maintenance' },
    { category: 'Vision', text: 'Inspect a P&ID for valve configurations' },
    { category: 'Generate', text: 'Generate an approval note' },
  ]

  return (
    <div className={styles.container}>
      <div className={styles.greeting}>
        <h1>Good morning.</h1>
        <p>How can I help you today?</p>
      </div>

      <div className={styles.agentGrid}>
        {agents.map(agent => (
          <div 
            key={agent.id}
            className={`${styles.agentCard} ${activeAgent === agent.id ? styles.agentCardActive : ''}`}
            onClick={() => setActiveAgent(agent.id)}
          >
            <div className={styles.agentIcon}>{agent.icon}</div>
            <div className={styles.agentName}>{agent.name}</div>
            <div className={styles.agentDesc}>{agent.desc}</div>
          </div>
        ))}
      </div>

      <div className={styles.promptsGrid}>
        {prompts.map((prompt, i) => (
          <div key={i} className={styles.promptCard}>
            <span>{prompt.category}</span>
            {prompt.text}
          </div>
        ))}
      </div>
    </div>
  )
}
