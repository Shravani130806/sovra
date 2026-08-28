/**
 * ModelSelector: Interactive UI for selecting Ollama and Sovereign LLM models.
 *
 * Replaces the static indicator with a provider-grouped model picker
 * allowing live switching of local Ollama models, reasoning levels,
 * and endpoint refresh.
 *
 * @module @mrpl/dsh-workbench-ui/client/conversation/ModelSelector
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import styles from './ModelSelector.module.css'
import {
  fetchOllamaModels,
  selectModel,
  type ModelEntry,
  type ModelGroup,
  type ModelSelection,
} from '../live/models-store.ts'
import { useModels } from '../live/hooks.ts'

export interface ModelSelectorProps {
  /** Optional callback fired when model changes */
  onSelect?: (selection: ModelSelection) => void
}

export function ModelSelector({ onSelect }: ModelSelectorProps) {
  const { groups, current, status, error, strictLocalOnly } = useModels()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const id = useId()

  // On mount, auto-probe the local Ollama endpoint to refresh available models
  useEffect(() => {
    void fetchOllamaModels()
  }, [])

  // Find currently active model metadata
  const currentGroup = groups.find((g) => g.id === current?.provider)
  const currentModel = currentGroup?.models.find((m) => m.id === current?.model)

  const activeModelLabel = currentModel?.name ?? current?.model ?? 'Auto-selected'
  const activeEffortLabel = current?.reasoningEffort
    ? currentModel?.reasoning?.efforts.find((e) => e.id === current.reasoningEffort)?.name ?? current.reasoningEffort
    : undefined

  // Close when clicking outside
  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  const handleToggle = () => {
    setOpen((prev) => !prev)
  }

  const handleSelectModel = async (group: ModelGroup, model: ModelEntry) => {
    const nextSelection: ModelSelection = {
      provider: group.id,
      model: model.id,
      ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}),
    }

    const success = await selectModel(nextSelection)
    if (success) {
      onSelect?.(nextSelection)
      setOpen(false)
    }
  }

  const handleSelectEffort = async (effortId: string) => {
    if (!current) return
    const nextSelection: ModelSelection = {
      ...current,
      reasoningEffort: effortId,
    }
    const success = await selectModel(nextSelection)
    if (success) {
      onSelect?.(nextSelection)
    }
  }

  const handleRefresh = async () => {
    await fetchOllamaModels()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div ref={rootRef} className={styles.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerActive : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current model: ${activeModelLabel}`}
        title={`Model: ${activeModelLabel}${activeEffortLabel ? ` (${activeEffortLabel})` : ''}`}
        onClick={handleToggle}
      >
        <span className={styles.triggerLabel}>
          <span>Model: {activeModelLabel}</span>
          {strictLocalOnly && <span className={styles.localBadge}>Local</span>}
          {activeEffortLabel && <span className={styles.effortBadge}>{activeEffortLabel}</span>}
        </span>
        <svg
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={styles.menu}
          role="listbox"
          aria-label="Model Selection"
        >
          <div className={styles.menuHeader}>
            <span className={styles.menuTitle}>Sovereign AI Models</span>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={handleRefresh}
              disabled={status === 'loading'}
              title="Refresh Ollama Models"
            >
              {status === 'loading' ? 'Refreshing…' : '↻ Refresh Ollama'}
            </button>
          </div>

          {error && (
            <div className={styles.errorBanner} role="alert">
              <span>{error}</span>
              <button
                type="button"
                className={styles.errorAction}
                onClick={handleRefresh}
              >
                Retry
              </button>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.id} className={styles.group}>
              <div className={styles.groupHeader}>
                <span>{group.name}</span>
                {group.isLocal && <span className={styles.localBadge}>Air-gapped</span>}
              </div>

              {group.models.map((model) => {
                const isSelected =
                  current?.provider === group.id && current?.model === model.id
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`${styles.option} ${isSelected ? styles.optionSelected : ''}`}
                    onClick={() => handleSelectModel(group, model)}
                  >
                    <div className={styles.optionContent}>
                      <div className={styles.modelNameRow}>
                        <span>{model.name}</span>
                      </div>
                      {model.description && (
                        <span className={styles.modelDesc}>{model.description}</span>
                      )}
                      {model.capabilities && model.capabilities.length > 0 && (
                        <div className={styles.capBadges}>
                          {model.capabilities.map((cap) => (
                            <span key={cap} className={styles.capBadge}>
                              {cap}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <svg
                        className={styles.checkIcon}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-label="Selected"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          {currentModel?.reasoning && (
            <div className={styles.effortSection}>
              <div className={styles.effortTitle}>Reasoning Effort</div>
              <div className={styles.effortButtons}>
                {currentModel.reasoning.efforts.map((effort) => {
                  const isActive =
                    (current?.reasoningEffort ?? currentModel.reasoning?.defaultEffort) ===
                    effort.id
                  return (
                    <button
                      key={effort.id}
                      type="button"
                      className={`${styles.effortButton} ${isActive ? styles.effortButtonActive : ''}`}
                      title={effort.description}
                      onClick={() => handleSelectEffort(effort.id)}
                    >
                      {effort.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
