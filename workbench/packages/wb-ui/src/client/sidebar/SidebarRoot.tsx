import type { SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './SidebarRoot.module.css'
import { SecurityIndicator } from '../components/SecurityIndicator.tsx'
import { useChat, useNavigation } from '../live/hooks.ts'
import { navigate, type Route } from '../live/navigation-store.ts'
import { newChat, switchSession } from '../live/chat-store.ts'

export function SidebarRoot(props: SidebarOwnerProps) {
  const { route } = useNavigation()
  const { sessions, activeSessionId } = useChat()

  if (props.collapsed) {
    return (
      <div className={styles.rail}>
        <div className={styles.brandCompact}>MRPL</div>
      </div>
    )
  }

  const handleNav = (target: Route) => () => navigate(target)

  const handleNewChat = () => {
    newChat()
    navigate('chat')
  }

  const handleSelectSession = (sessionId: string) => {
    switchSession(sessionId)
    navigate('chat')
  }

  const NavItem = ({ label, target }: { label: string; target: Route }) => (
    <div
      className={`${styles.navItem} ${route === target ? styles.navItemActive : ''}`}
      onClick={handleNav(target)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleNav(target)()
        }
      }}
    >
      {label}
    </div>
  )

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.brandFull}>Sovereign AI Workbench</div>
      </div>

      <div className={styles.navigation}>
        <button type="button" className={styles.newChatBtn} onClick={handleNewChat}>
          <span>+</span> New Chat
        </button>

        <NavItem label="Chat" target="chat" />
        <NavItem label="Search" target="search" />
        <NavItem label="Documents" target="documents" />
        <NavItem label="Engineering Vision" target="vision" />
        <NavItem label="Activity" target="activity" />
        <NavItem label="Security" target="security" />

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
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleSelectSession(session.id)
                  }
                }}
              >
                {session.title}
              </div>
            ))}
          </>
        ) : null}
      </div>

      <div className={styles.footer}>
        <SecurityIndicator />
        <div className={styles.userArea} onClick={handleNav('settings')}>
          <div className={styles.userName}>Sakshi</div>
          <div className={styles.userRole}>Engineering / Analyst</div>
        </div>
        <NavItem label="Settings" target="settings" />
      </div>
    </div>
  )
}
