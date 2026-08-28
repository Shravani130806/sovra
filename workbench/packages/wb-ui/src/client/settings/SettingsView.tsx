import { useState } from 'react'
import styles from './SettingsView.module.css'

export function SettingsView() {
  const [activeTab, setActiveTab] = useState('Appearance')

  const tabs = [
    'Appearance',
    'Workspace',
    'Agent Preferences',
    'Security',
    'Notifications',
    'About'
  ]

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Settings</h1>
        <p>Manage your Sovereign AI Workbench preferences</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.sidebar}>
          {tabs.map(tab => (
            <div
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </div>
          ))}
        </div>

        <div className={styles.content}>
          <h2>{activeTab}</h2>
          
          {activeTab === 'Appearance' && (
            <div className={styles.settingGroup}>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Theme</div>
                  <div className={styles.settingDesc}>Choose how the workbench looks.</div>
                </div>
                <div className={styles.settingControl}>
                  <select defaultValue="dark">
                    <option value="dark">Dark (Default)</option>
                    <option value="light">Light</option>
                    <option value="system">System Settings</option>
                  </select>
                </div>
              </div>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Information Density</div>
                  <div className={styles.settingDesc}>Control how compact the interface is.</div>
                </div>
                <div className={styles.settingControl}>
                  <select defaultValue="compact">
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Agent Preferences' && (
            <div className={styles.settingGroup}>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Default Agent</div>
                  <div className={styles.settingDesc}>The preset selected when opening a new chat.</div>
                </div>
                <div className={styles.settingControl}>
                  <select defaultValue="analyst">
                    <option value="analyst">Document Analyst</option>
                    <option value="vision">Engineering Vision</option>
                    <option value="code">Code Analysis</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Security' && (
            <div className={styles.settingGroup}>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Strict Enforcement Mode</div>
                  <div className={styles.settingDesc}>Globally block all external actions regardless of clearance.</div>
                </div>
                <div className={styles.settingControl}>
                  <select defaultValue="on">
                    <option value="on">Enabled</option>
                    <option value="off">Disabled</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {['Workspace', 'Notifications', 'About'].includes(activeTab) && (
            <p style={{ color: 'var(--wb-text-secondary)' }}>
              Configuration for {activeTab.toLowerCase()} will appear here.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
