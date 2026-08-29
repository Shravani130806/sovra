import { useState } from 'react'
import type { SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './SidebarRoot.module.css'
import { SecurityIndicator } from '../components/SecurityIndicator.tsx'
import { useChat, useCurrentUser, useNavigation, useUsers } from '../live/hooks.ts'
import { navigate, type Route } from '../live/navigation-store.ts'
import { newChat, switchSession } from '../live/chat-store.ts'
import { switchUser } from '../live/user-store.ts'

export function SidebarRoot(props: SidebarOwnerProps) {
  const { route } = useNavigation()
  const { sessions, activeSessionId } = useChat()
  const currentUser = useCurrentUser()
  const { users } = useUsers()
  const [showUserMenu, setShowUserMenu] = useState(false)

  if (props.collapsed) {
    return (
      <div className={styles.rail}>
        <div className={styles.brandCompact}>MRPL</div>
      </div>
    )
  }

  const handleNav = (target: Route) => () => {
    setShowUserMenu(false)
    navigate(target)
  }

  const handleNewChat = () => {
    setShowUserMenu(false)
    newChat()
    navigate('chat')
  }

  const handleSelectSession = (sessionId: string) => {
    setShowUserMenu(false)
    switchSession(sessionId)
    navigate('chat')
  }

  const handleSelectUser = (userId: string) => {
    switchUser(userId)
    setShowUserMenu(false)
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

  const clearanceClass =
    styles[`clearance${currentUser.clearance}`] ?? styles.clearanceINTERNAL

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
        <NavItem label="Model Routing" target="models" />
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

        {showUserMenu && (
          <div className={styles.userMenuPopover} role="menu" aria-label="Switch User">
            <div className={styles.userMenuTitle}>Switch Active Identity</div>
            {users.map((u) => {
              const uClearanceClass =
                styles[`clearance${u.clearance}`] ?? styles.clearanceINTERNAL
              const isSelected = u.id === currentUser.id
              return (
                <div
                  key={u.id}
                  className={`${styles.userMenuItem} ${isSelected ? styles.userMenuItemActive : ''}`}
                  onClick={() => handleSelectUser(u.id)}
                  role="menuitem"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleSelectUser(u.id)
                    }
                  }}
                >
                  <div className={styles.userMenuDetails}>
                    <div className={styles.userMenuName}>{u.displayName}</div>
                    <div className={styles.userMenuRole}>{u.role}</div>
                  </div>
                  <span className={`${styles.clearanceBadge} ${uClearanceClass}`}>
                    {u.clearance}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div
          className={styles.userCard}
          onClick={() => setShowUserMenu((prev) => !prev)}
          title={`Active User: ${currentUser.displayName} (${currentUser.clearance}) — Click to switch user`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setShowUserMenu((prev) => !prev)
            }
          }}
        >
          <div className={styles.userMeta}>
            <div className={styles.userNameRow}>
              <span className={styles.userName}>{currentUser.displayName}</span>
              <span className={`${styles.clearanceBadge} ${clearanceClass}`}>
                {currentUser.clearance}
              </span>
            </div>
            <div className={styles.userRole}>{currentUser.role}</div>
          </div>
          <span className={styles.switchIcon} title="Switch User">⇅</span>
        </div>

        <NavItem label="Settings" target="settings" />
      </div>
    </div>
  )
}
