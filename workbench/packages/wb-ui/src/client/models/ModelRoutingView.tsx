/**
 * Model Routing & Capability Management View.
 *
 * Provides dedicated allocation and configuration for each AI pipeline capability:
 * Main Chat, Coding, Embedding, Reranking, OCR, and Vision Language.
 *
 * @module @mrpl/dsh-workbench-ui/client/models/ModelRoutingView
 */

import { useState } from 'react'
import styles from './ModelRoutingView.module.css'
import { useModels } from '../live/hooks.ts'
import {
  CAPABILITY_ROLES,
  CONTEXT_LENGTH_OPTIONS,
  DEFAULT_CONTEXT_LENGTH,
  fetchOllamaModels,
  setCapabilityModel,
  setOllamaEndpoint,
  setStrictLocalOnly,
  type ModelCapabilityRole,
  type ModelSelection,
} from '../live/models-store.ts'

export function ModelRoutingView() {
  const {
    groups,
    capabilityRouting,
    status,
    error,
    ollamaEndpoint,
    strictLocalOnly,
  } = useModels()

  const [endpointInput, setEndpointInput] = useState(ollamaEndpoint)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleEndpointBlur = () => {
    setOllamaEndpoint(endpointInput)
  }

  const handleRefreshModels = async () => {
    setTestResult(null)
    setOllamaEndpoint(endpointInput)
    await fetchOllamaModels(endpointInput)
    setTimeout(() => {
      setTestResult('Discovery and sync complete.')
    }, 200)
  }

  const handleModelChange = (
    role: ModelCapabilityRole,
    provider: string,
    model: string,
    reasoningEffort?: string | undefined,
    contextLength?: number | undefined,
  ) => {
    const existing = capabilityRouting[role]
    const selection: ModelSelection = {
      provider,
      model,
      reasoningEffort: reasoningEffort ?? existing?.reasoningEffort,
      contextLength: contextLength ?? existing?.contextLength ?? DEFAULT_CONTEXT_LENGTH,
    }
    setCapabilityModel(role, selection)
  }

  const handleContextLengthChange = (role: ModelCapabilityRole, contextLength: number) => {
    const existing = capabilityRouting[role] ?? { provider: 'ollama', model: 'qwen3.5:2b' }
    setCapabilityModel(role, {
      ...existing,
      contextLength,
    })
  }

  const allModels = groups.flatMap((g) =>
    g.models.map((m) => ({
      provider: g.id,
      providerName: g.name,
      model: m.id,
      name: m.name,
      capabilities: m.capabilities ?? [],
      reasoning: m.reasoning,
    })),
  )

  const ollamaGroup = groups.find((g) => g.id === 'ollama')

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Capability-Based Model Routing</h1>
          <p>
            Allocate dedicated sovereign models and air-gapped endpoints across
            reasoning, vision, embedding, coding, and extraction tasks.
          </p>
        </div>
      </div>

      <div className={styles.topBar}>
        <div className={styles.endpointGroup}>
          <label htmlFor="ollama-endpoint">Ollama Host</label>
          <input
            id="ollama-endpoint"
            type="text"
            className={styles.endpointInput}
            value={endpointInput}
            onChange={(e) => setEndpointInput(e.target.value)}
            onBlur={handleEndpointBlur}
            placeholder="http://127.0.0.1:11434/v1"
          />
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={handleRefreshModels}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Discovering…' : 'Discover Local Models'}
          </button>
        </div>

        <div className={styles.strictToggle}>
          <label htmlFor="strict-local">Strict Air-Gapped:</label>
          <input
            id="strict-local"
            type="checkbox"
            checked={strictLocalOnly}
            onChange={(e) => setStrictLocalOnly(e.target.checked)}
          />
        </div>
      </div>

      {error && <div className={`${styles.statusMsg} ${styles.statusError}`}>{error}</div>}
      {status === 'ready' && testResult && !error && (
        <div className={`${styles.statusMsg} ${styles.statusSuccess}`}>
          Connected to Ollama host. Discovered {ollamaGroup?.models.length ?? 0} sovereign models.
        </div>
      )}

      <div className={styles.grid}>
        {CAPABILITY_ROLES.map((roleMeta) => {
          const selected = capabilityRouting[roleMeta.id] ?? {
            provider: 'ollama',
            model: roleMeta.recommendedTag,
            contextLength: DEFAULT_CONTEXT_LENGTH,
          }

          const activeModelObj = allModels.find(
            (m) => m.provider === selected.provider && m.model === selected.model,
          )

          const hasReasoning = Boolean(activeModelObj?.reasoning)

          return (
            <div key={roleMeta.id} className={styles.card} data-testid={`capability-card-${roleMeta.id}`}>
              <div>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>{roleMeta.title}</div>
                  <span className={`${styles.badge} ${styles.badgeLocal}`}>Sovereign</span>
                </div>
                <div className={styles.cardDesc}>{roleMeta.description}</div>
              </div>

              <div className={styles.controls}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel} htmlFor={`select-model-${roleMeta.id}`}>
                    Assigned Model
                  </label>
                  <select
                    id={`select-model-${roleMeta.id}`}
                    className={styles.select}
                    value={`${selected.provider}/${selected.model}`}
                    onChange={(e) => {
                      const [p, m] = e.target.value.split('/')
                      if (p && m) {
                        handleModelChange(roleMeta.id, p, m, selected.reasoningEffort, selected.contextLength)
                      }
                    }}
                  >
                    {groups.map((group) => (
                      <optgroup key={group.id} label={group.name}>
                        {group.models.map((model) => (
                          <option key={`${group.id}/${model.id}`} value={`${group.id}/${model.id}`}>
                            {model.name} {model.capabilities?.includes(roleMeta.preferredCapability) ? '★' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className={styles.formRow}>
                  <label className={styles.formLabel} htmlFor={`ctx-${roleMeta.id}`}>
                    Context Window
                  </label>
                  <select
                    id={`ctx-${roleMeta.id}`}
                    className={styles.select}
                    value={selected.contextLength ?? DEFAULT_CONTEXT_LENGTH}
                    onChange={(e) => {
                      handleContextLengthChange(roleMeta.id, Number(e.target.value))
                    }}
                  >
                    {CONTEXT_LENGTH_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {hasReasoning && (
                  <div className={styles.formRow}>
                    <label className={styles.formLabel} htmlFor={`effort-${roleMeta.id}`}>
                      Reasoning Effort
                    </label>
                    <select
                      id={`effort-${roleMeta.id}`}
                      className={styles.select}
                      value={selected.reasoningEffort ?? 'medium'}
                      onChange={(e) => {
                        handleModelChange(
                          roleMeta.id,
                          selected.provider,
                          selected.model,
                          e.target.value,
                          selected.contextLength,
                        )
                      }}
                    >
                      <option value="low">Low (Fast)</option>
                      <option value="medium">Medium (Balanced)</option>
                      <option value="high">High (Deep Analysis)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
