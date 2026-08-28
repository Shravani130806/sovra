import { useState } from 'react'
import styles from './SettingsView.module.css'
import { useModels } from '../live/hooks.ts'
import {
  CAPABILITY_ROLES,
  CONTEXT_LENGTH_OPTIONS,
  DEFAULT_CONTEXT_LENGTH,
  fetchOllamaModels,
  selectModel,
  setContextLength,
  setOllamaEndpoint,
  setStrictLocalOnly,
} from '../live/models-store.ts'
import { navigate } from '../live/navigation-store.ts'

export function SettingsView() {
  const [activeTab, setActiveTab] = useState('Models & Ollama')
  const { groups, current, capabilityRouting, status, error, ollamaEndpoint, strictLocalOnly } = useModels()
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
              {tab}
            </div>
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
                  <div className={styles.settingTitle}>Active Chat Model</div>
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
                          {g.name}: {m.name}
                        </option>
                      )),
                    )}
                  </select>
                </div>
              </div>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Context Window (Tokens)</div>
                  <div className={styles.settingDesc}>
                    Maximum context length allocated during local model inference (Ollama num_ctx).
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <select
                    value={current?.contextLength ?? DEFAULT_CONTEXT_LENGTH}
                    onChange={(e) => setContextLength(Number(e.target.value))}
                  >
                    {CONTEXT_LENGTH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Strict Air-Gapped Mode</div>
                  <div className={styles.settingDesc}>
                    Prohibit non-local inference providers. Every turn executes strictly on-premise.
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <label>
                    <input
                      type="checkbox"
                      checked={strictLocalOnly}
                      onChange={(e) => setStrictLocalOnly(e.target.checked)}
                    />
                    Enforce local-only execution
                  </label>
                </div>
              </div>

              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Capability-Based Model Matrix</div>
                  <div className={styles.settingDesc}>
                    Fine-grained model allocation for Coding, Embedding, Reranking, OCR, and Vision.
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    {CAPABILITY_ROLES.map((r) => {
                      const sel = capabilityRouting[r.id]
                      return (
                        <div key={r.id} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                          <span style={{ color: 'var(--wb-text-secondary, #a1a1aa)' }}>{r.title}:</span>
                          <strong>{sel ? `${sel.provider}/${sel.model}` : 'Default'}</strong>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => navigate('models')}
                  >
                    Open Model Routing Matrix →
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Security' && (
            <div className={styles.settingGroup}>
              <div className={styles.settingRow}>
                <div className={styles.settingInfo}>
                  <div className={styles.settingTitle}>Sovereign Security Boundary</div>
                  <div className={styles.settingDesc}>
                    State of egress gating and local container isolation.
                  </div>
                </div>
                <div className={styles.settingControl}>
                  <span style={{ color: '#22c55e', fontWeight: 600 }}>Active (Enforcing Air-Gap)</span>
                </div>
              </div>
            </div>
          )}

          {activeTab !== 'Models & Ollama' && activeTab !== 'Security' && (
            <p className={styles.stubNotice}>
              Configure {activeTab.toLowerCase()} options for sovereign operation.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
