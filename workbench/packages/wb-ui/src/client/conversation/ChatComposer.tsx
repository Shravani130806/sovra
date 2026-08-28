import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import styles from './ChatComposer.module.css'
import { useChat, useChatState } from '../live/hooks.ts'
import { abortTurn, registerChatAttachmentContent } from '../live/chat-store.ts'
import { completeUpload, markUploading, queueUpload } from '../live/documents-store.ts'

/** Rows the textarea may grow to before it scrolls internally. */
const MAX_ROWS = 8
const ACCEPTED_ATTACHMENTS = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.txt,.md'

export interface ChatComposerProps {
  /**
   * Send one message.
   *
   * Supplied by the container that owns the transport: the composer knows when
   * a message should be sent, not how to send it, so nothing here can become a
   * second path into the workbench.
   */
  onSend?: (text: string, attachments?: string[]) => void
}

export function ChatComposer({ onSend }: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const { generating } = useChat()
  const { isPolicyBlocked, isApprovalRequired, blockReason } = useChatState()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Grow with the content rather than scrolling a single line: an operator
  // pasting a multi-line P&ID query should be able to see what they typed.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS)}px`
  }, [draft])

  const handleAttach = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next = Array.from(files)
    for (const file of next) {
      if (
        file.type?.startsWith('text/') ||
        file.name.match(/\.(txt|md|json|csv|py|js|ts|tsx|jsx|html|css|yaml|yml|log|xml|sh|env)$/i)
      ) {
        if (typeof file.text === 'function') {
          file.text().then((content) => {
            registerChatAttachmentContent(file.name, content)
          }).catch(() => {})
        }
      }
    }
    setAttachments((prev) => [...prev, ...next])
    if (fileInput.current) {
      fileInput.current.value = ''
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const send = useCallback(() => {
    const text = draft.trim()
    // A blank or whitespace-only draft without attachments is not a message
    if (text === '' && attachments.length === 0) return
    if (generating) return

    const attachmentNames = attachments.map((f) => f.name)

    // Ingest any attachments into documents store so they are registered in the workbench
    for (const file of attachments) {
      const jobId = queueUpload(file.name, 'INTERNAL')
      markUploading(jobId)
      setTimeout(() => {
        completeUpload(jobId, {
          id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          title: file.name,
          classification: 'INTERNAL',
          declaredClassification: 'INTERNAL',
          chunks: Math.max(1, Math.ceil(file.size / 1024)),
          ingestedAt: new Date().toISOString(),
        })
      }, 100)
    }

    if (attachmentNames.length > 0) {
      onSend?.(text, attachmentNames)
    } else {
      onSend?.(text)
    }
    setDraft('')
    setAttachments([])
  }, [draft, attachments, generating, onSend])

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

      {attachments.length > 0 ? (
        <div className={styles.attachmentsList}>
          {attachments.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className={styles.attachmentChip}>
              <span className={styles.attachmentName}>📎 {file.name}</span>
              <button
                type="button"
                className={styles.removeAttachmentBtn}
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${file.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.composerInner}>
        <div className={styles.composerControls}>
          <button
            className={styles.iconButton}
            title="Attach Document/Image"
            aria-label="Attach Document/Image"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_ATTACHMENTS}
            className={styles.hiddenInput}
            aria-label="Attach files"
            onChange={(e) => handleAttach(e.target.files)}
          />
        </div>

        <textarea
          ref={textarea}
          className={styles.input}
          value={draft}
          placeholder={generating ? 'Waiting for response…' : 'Message Sovereign AI…'}
          aria-label="Message"
          disabled={generating}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
        />

        {generating ? (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonStop}`}
            onClick={abortTurn}
            aria-label="Stop generating"
            title="Stop generating"
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSend}`}
            onClick={send}
            disabled={draft.trim() === '' && attachments.length === 0}
            aria-label="Send Message"
            title="Send Message"
          >
            ▲
          </button>
        )}
      </div>
    </div>
  )
}
