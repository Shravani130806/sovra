import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import styles from './ChatComposer.module.css'
import { useChat, useChatState } from '../live/hooks.ts'
import { abortTurn } from '../live/chat-store.ts'

/** Rows the textarea may grow to before it scrolls internally. */
const MAX_ROWS = 8

export interface ChatComposerProps {
  /**
   * Send one message.
   *
   * Supplied by the container that owns the transport: the composer knows when
   * a message should be sent, not how to send it, so nothing here can become a
   * second path into the workbench.
   */
  onSend?: (text: string) => void
}

export function ChatComposer({ onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const { generating } = useChat()
  const { isPolicyBlocked, isApprovalRequired, blockReason } = useChatState()
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Grow with the content rather than scrolling a single line: an operator
  // pasting a multi-line P&ID query should be able to see what they typed.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS)}px`
  }, [draft])

  const send = useCallback(() => {
    const text = draft.trim()
    // A blank or whitespace-only draft is not a message; sending one would
    // open a turn the model has nothing to answer.
    if (text === '' || generating) return
    onSend?.(text)
    setDraft('')
  }, [draft, generating, onSend])

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a newline. IME composition must not
    // send: a Japanese or Devanagari input method fires Enter to commit a
    // candidate, and treating that as submit truncates the word being typed.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className={styles.composerWrapper}>
      {isPolicyBlocked || isApprovalRequired ? (
        <div
          className={`${styles.policyBanner} ${isPolicyBlocked ? styles.policyBlocked : styles.policyApproval}`}
          role="status"
        >
          {isPolicyBlocked ? 'Blocked by policy' : 'Approval required'}
          {blockReason ? `: ${blockReason}` : ''}
        </div>
      ) : null}

      <div className={styles.composerInner}>
        <div className={styles.composerControls}>
          <button className={styles.iconButton} title="Attach Document/Image" type="button">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
        </div>

        <textarea
          ref={textarea}
          className={styles.textarea}
          placeholder="Ask the Sovereign AI Workbench..."
          aria-label="Message"
          rows={1}
          value={draft}
          disabled={generating}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className={styles.composerActions}>
          {generating ? (
            <button
              className={`${styles.sendButton} ${styles.stopButton}`}
              title="Stop generating"
              aria-label="Stop generating"
              type="button"
              onClick={() => abortTurn()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className={styles.sendButton}
              title="Send Message"
              aria-label="Send Message"
              type="button"
              disabled={draft.trim() === ''}
              onClick={send}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className={styles.footerText}>
        AI-generated content may be incorrect. Confidential data remains sovereign.
      </div>
    </div>
  )
}
