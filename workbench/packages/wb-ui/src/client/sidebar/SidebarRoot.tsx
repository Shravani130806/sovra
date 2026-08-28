import type { SidebarOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import styles from './SidebarRoot.module.css'
import { SecurityIndicator } from '../components/SecurityIndicator.tsx'
import { useNavigation, type PageRoute } from '../mock/index.ts'

export function SidebarRoot(props: SidebarOwnerProps) {
  const { page, navigate } = useNavigation()

  if (props.collapsed) {
    return (
      <div className={styles.rail}>
        <div className={styles.brandCompact}>MRPL</div>
      </div>
    )
  }

  const handleNav = (target: PageRoute) => () => navigate(target)

  const NavItem = ({ label, target }: { label: string, target: PageRoute }) => (
    <div 
      className={`${styles.navItem} ${page === target ? styles.navItemActive : ''}`}
      onClick={handleNav(target)}
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
        <button className={styles.newChatBtn} onClick={handleNav('chat')}>
          <span>+</span> New Chat
        </button>

        <NavItem label="Chat" target="chat" />
        <NavItem label="Search" target="search" />
        <NavItem label="Documents" target="documents" />
        <NavItem label="Engineering Vision" target="vision" />
        <NavItem label="Activity" target="activity" />
        <NavItem label="Security" target="security" />
        
        <div className={styles.sectionTitle}>Today</div>
        <div className={styles.navItem}>Pump P-101 inspection</div>
        <div className={styles.navItem}>SOP compliance review</div>

        <div className={styles.sectionTitle}>Yesterday</div>
        <div className={styles.navItem}>Compressor maintenance</div>
        
        <div className={styles.sectionTitle}>Previous 7 Days</div>
        <div className={styles.navItem}>Monthly refinery safety</div>
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
