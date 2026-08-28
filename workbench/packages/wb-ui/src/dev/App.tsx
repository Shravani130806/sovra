import { useState } from 'react'
import '../client/styles/variables.css'
import { useNavigation, type PageRoute } from '../client/mock/navigation.ts'
import { ChatHomeView } from '../client/conversation/ChatHomeView.tsx'
import { ChatComposer } from '../client/conversation/ChatComposer.tsx'
import { DocumentsView } from '../client/documents/DocumentsView.tsx'
import { DocumentViewer } from '../client/documents/DocumentViewer.tsx'
import { EngineeringVisionView } from '../client/vision/EngineeringVisionView.tsx'
import { ActivityView } from '../client/activity/ActivityView.tsx'
import { SecurityConsoleView } from '../client/security/SecurityConsoleView.tsx'
import { SettingsView } from '../client/settings/SettingsView.tsx'
import { SearchView } from '../client/search/SearchView.tsx'
import { SecurityIndicator } from '../client/components/SecurityIndicator.tsx'
import styles from './App.module.css'

function Sidebar() {
  const { page, navigate } = useNavigation()

  const NavItem = ({ label, target }: { label: string; target: PageRoute }) => (
    <div
      className={`${styles.navItem} ${page === target ? styles.navItemActive : ''}`}
      onClick={() => navigate(target)}
    >
      {label}
    </div>
  )

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.brand}>Sovereign AI Workbench</div>
      </div>

      <div className={styles.sidebarNav}>
        <button className={styles.newChatBtn} onClick={() => navigate('chat')}>
          + New Chat
        </button>

        <NavItem label="💬  Chat" target="chat" />
        <NavItem label="🔍  Search" target="search" />
        <NavItem label="📄  Documents" target="documents" />
        <NavItem label="🔧  Engineering Vision" target="vision" />
        <NavItem label="📊  Activity" target="activity" />
        <NavItem label="🛡️  Security" target="security" />

        <div className={styles.sectionTitle}>Today</div>
        <div className={styles.navItem} style={{ fontSize: '0.8rem' }}>Pump P-101 inspection</div>
        <div className={styles.navItem} style={{ fontSize: '0.8rem' }}>SOP compliance review</div>

        <div className={styles.sectionTitle}>Yesterday</div>
        <div className={styles.navItem} style={{ fontSize: '0.8rem' }}>Compressor maintenance</div>
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

function MainContent() {
  const { page } = useNavigation()

  switch (page) {
    case 'documents': return <DocumentsView />
    case 'document_viewer': return <DocumentViewer />
    case 'vision': return <EngineeringVisionView />
    case 'activity': return <ActivityView />
    case 'security': return <SecurityConsoleView />
    case 'settings': return <SettingsView />
    case 'search': return <SearchView />
    case 'chat':
    default:
      return (
        <div className={styles.chatArea}>
          <div className={styles.chatHeader}>
            <h2>Document Analyst</h2>
            <span className={styles.headerMeta}>Model: Auto-selected</span>
          </div>
          <div className={styles.chatMessages}>
            <ChatHomeView />
          </div>
          <div className={styles.composerWrap}>
            <ChatComposer />
          </div>
        </div>
      )
  }
}

function DetailsPanel() {
  const { page } = useNavigation()

  let title = 'Context'
  let content: React.ReactNode = null

  switch (page) {
    case 'documents':
    case 'document_viewer':
      title = 'Document Properties'
      content = (
        <>
          <div className={styles.detailRow}><span>Classification</span><strong>RESTRICTED</strong></div>
          <div className={styles.detailRow}><span>Owner</span><strong>Engineering Dept</strong></div>
          <div className={styles.detailRow}><span>Pages</span><strong>128</strong></div>
        </>
      )
      break
    case 'security':
      title = 'Policy Engine'
      content = (
        <>
          <div className={styles.detailRow}><span>Status</span><strong style={{ color: 'var(--wb-color-sovereign)' }}>Active</strong></div>
          <div className={styles.detailRow}><span>Last updated</span><strong>Today, 08:00 AM</strong></div>
        </>
      )
      break
    case 'vision':
      title = 'Drawing Info'
      content = (
        <>
          <div className={styles.detailRow}><span>Model</span><strong>Vision-Eng-v2</strong></div>
          <div className={styles.detailRow}><span>Entities</span><strong>3 detected</strong></div>
        </>
      )
      break
    default:
      content = (
        <>
          <div className={styles.detailRow}><span>Policy</span><strong style={{ color: 'var(--wb-color-sovereign)' }}>Active (Local & Sovereign)</strong></div>
          <div className={styles.detailRow}><span>Network</span><strong>Isolated</strong></div>
          <div className={styles.detailRow}><span>Agent</span><strong>Document Analyst</strong></div>
        </>
      )
  }

  return (
    <div className={styles.details}>
      <div className={styles.detailsHeader}>{title}</div>
      <div className={styles.detailsContent}>{content}</div>
    </div>
  )
}

export function App() {
  const [detailsOpen] = useState(true)

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <MainContent />
      </div>
      {detailsOpen && <DetailsPanel />}
    </div>
  )
}
