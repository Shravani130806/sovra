import { useState } from 'react'
import '../client/styles/variables.css'
import { useChat, useNavigation } from '../client/live/hooks.ts'
import { navigate, type Route } from '../client/live/navigation-store.ts'
import { newChat, switchSession } from '../client/live/chat-store.ts'
import { ConversationRoot } from '../client/conversation/ConversationRoot.tsx'
import { SecurityIndicator } from '../client/components/SecurityIndicator.tsx'
import { DetailsRoot } from '../client/details/DetailsRoot.tsx'
import styles from './App.module.css'

function Sidebar() {
  const { route } = useNavigation()
  const { sessions, activeSessionId } = useChat()

  const NavItem = ({ label, target }: { label: string; target: Route }) => (
    <div
      className={`${styles.navItem} ${route === target ? styles.navItemActive : ''}`}
      onClick={() => navigate(target)}
    >
      {label}
    </div>
  )

  const handleNewChat = () => {
    newChat()
    navigate('chat')
  }

  const handleSelectSession = (sessionId: string) => {
    switchSession(sessionId)
    navigate('chat')
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.brand}>Sovereign AI Workbench</div>
      </div>

      <div className={styles.sidebarNav}>
        <button className={styles.newChatBtn} onClick={handleNewChat}>
          + New Chat
        </button>

        <NavItem label="💬  Chat" target="chat" />
        <NavItem label="🔍  Search" target="search" />
        <NavItem label="📄  Documents" target="documents" />
        <NavItem label="🔧  Engineering Vision" target="vision" />
        <NavItem label="📊  Activity" target="activity" />
        <NavItem label="🛡️  Security" target="security" />

        {sessions.length > 0 ? (
          <>
            <div className={styles.sectionTitle}>Recent Chats</div>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`${styles.sessionItem} ${
                  route === 'chat' && activeSessionId === session.id ? styles.sessionItemActive : ''
                }`}
                onClick={() => handleSelectSession(session.id)}
                title={session.title}
              >
                {session.title}
              </div>
            ))}
          </>
        ) : null}
      </div>

      <div className={styles.sidebarFooter}>
        <SecurityIndicator />
        <div className={styles.userArea} onClick={() => navigate('settings')}>
          <div className={styles.userName}>Sakshi</div>
          <div className={styles.userRole}>Engineering / Analyst</div>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const [detailsOpen] = useState(true)

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <ConversationRoot />
      </div>
      {detailsOpen && <DetailsRoot />}
    </div>
  )
}
