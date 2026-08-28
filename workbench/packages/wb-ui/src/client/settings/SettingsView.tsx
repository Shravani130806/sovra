import { useState } from 'react'
import styles from './SettingsView.module.css'
import { useModels } from '../live/hooks.ts'
import {
  fetchOllamaModels,
  selectModel,
  setOllamaEndpoint,
  setStrictLocalOnly,
} from '../live/models-store.ts'

export function SettingsView() {
  const [activeTab, setActiveTab] = useState('Models & Ollama')
  const { groups, current, status, error, ollamaEndpoint, strictLocalOnly } = useModels()
  const [endpointInput, setEndpointInput] = useState(ollamaEndpoint)
  const [testResult, setTestResult] = useState<string | null>(null)

  const tabs = [
    'Models & Ollama',
    'Appearance',
    'Workspace',
    'Agent Preferences',
    'Security',
    'Notifications',
    'About',
  ]

  const handleEndpointBlur = () => {
    setOllamaEndpoint(endpointInput)
  }

  const handleTestConnection = async () => {
    setTestResult(null)
    setOllamaEndpoint(endpointInput)
    await fetchOllamaModels(endpointInput)
    setTimeout(() => {
      setTestResult('Discovery query complete.')
    }, 200)
  }

  const ollamaGroup = groups.find((g) => g.id === 'ollama')

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Settings</h1>
        <p>Manage your Sovereign AI Workbench preferences</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.sidebar}>
          {tabs.map((tab) => (
            <div
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab
            }</div>
          ))}
        </div>

        <div className={styles.content}>
          <h2>{activeTab}</h2>

          {activeTab === 'Models & Ollama' && (
            <div className={styles.settingGroup}>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Ollama Base Endpoint</div>
                  <div className={styles.settingDesc}>
                    Local URL for Ollama OpenAI-compatible inference API (e.g. http://127.0.0.1:11434/v1).
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <input
                    type="text"
                    value={endpointInput}
                    onChange={(e) => setEndpointInput(e.target.value)}
                    onBlur={handleEndpointBlur}
                    placeholder="http://127.0.0.1:11434/v1"
                  />
                  <br />
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleTestConnection}
                    disabled={status === 'loading'}
                  >
                    {status === 'loading' ? 'Testing…' : 'Discover Local Models'}
                  </button>
                  {error && <div className={styles.statusError}>{error}</div>}
                  {status === 'ready' && testResult && !error && (
                    <div className={styles.statusSuccess}>
                      Connected! Discovered {ollamaGroup?.models.length ?? 0} local Ollama models.
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Active Model</div>
                  <div className={styles.settingDesc}>
                    Current sovereign model used across sessions and chat turns.
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <select
                    value={current ? `${current.provider}/${current.model}` : ''}
                    onChange={(e) => {
                      const [provider, model] = e.target.value.split('/')
                      if (provider && model) {
                        void selectModel({ provider, model })
                      }
                    }}
                  >
                    {groups.flatMap((g) =>
                      g.models.map((m) => (
                        <option key={`${g.id}/${m.id}`} value={`${g.id}/${m.id}`}>
                          [{g.name}] {m.name}
                        </option>
                      )),
                    )}
                  </select>
                </div>
              </div>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Strict Local-Only Enforcement</div>
                  <div className={styles.settingDesc}>
                    Prohibit fallback to cloud providers. Guarantees 100% on-premise execution.
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <select
                    value={strictLocalOnly ? 'on' : 'off'}
                    onChange={(e) => setStrictLocalOnly(e.target.value === 'on')}
                  >
                    <option value="on">Enabled (Strict Air-Gapped)</option>
                    <option value="off">Disabled</option>
                  </select>
                </div>
              </div>

              <div className={styles.settingGroup}>
                <div className={styles.settingTitle}>Available Ollama Models</div>
                <div className={styles.modelCardList}>
                  {ollamaGroup?.models.map((model) => (
                    <div key={model.id} className={styles.modelCard}>
                      <div>
                        <div className={styles.modelName}>{model.name}</div>
                        <div className={styles.modelDetail}>{model.description}</div>
                      </div>
                      <span className={styles.badge}>Air-gapped</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

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
