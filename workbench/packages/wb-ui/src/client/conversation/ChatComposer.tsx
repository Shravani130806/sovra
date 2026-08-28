import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { asWbDocumentId } from '@mrpl/dsh-workbench-types'
import styles from './ChatComposer.module.css'
import { useChat, useChatState } from '../live/hooks.ts'
import { abortTurn } from '../live/chat-store.ts'
import {
  completeUpload,
  createChunksFromText,
  getChatAttachmentContent,
  markUploading,
  queueUpload,
  registerChatAttachmentContent,
} from '../live/documents-store.ts'

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
      const existingContent = getChatAttachmentContent(file.name)
      if (existingContent) {
        const chunksData = createChunksFromText(existingContent)
        completeUpload(jobId, {
          id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          title: file.name,
          classification: 'INTERNAL',
          declaredClassification: 'INTERNAL',
          chunks: Math.max(1, chunksData.length),
          content: existingContent,
          chunksData,
          ingestedAt: new Date().toISOString(),
        })
      } else if (typeof file.text === 'function') {
        file.text().then((textContent) => {
          registerChatAttachmentContent(file.name, textContent)
          const chunksData = createChunksFromText(textContent)
          completeUpload(jobId, {
            id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
            title: file.name,
            classification: 'INTERNAL',
            declaredClassification: 'INTERNAL',
            chunks: Math.max(1, chunksData.length),
            content: textContent,
            chunksData,
            ingestedAt: new Date().toISOString(),
          })
        }).catch(() => {
          completeUpload(jobId, {
            id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
            title: file.name,
            classification: 'INTERNAL',
            declaredClassification: 'INTERNAL',
            chunks: Math.max(1, Math.ceil(file.size / 1024)),
            ingestedAt: new Date().toISOString(),
          })
        })
      } else {
        completeUpload(jobId, {
          id: asWbDocumentId(`doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          title: file.name,
          classification: 'INTERNAL',
          declaredClassification: 'INTERNAL',
          chunks: Math.max(1, Math.ceil(file.size / 1024)),
          ingestedAt: new Date().toISOString(),
        })
      }
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
            aria-label="Attach files"
            multiple
            accept={ACCEPTED_ATTACHMENTS}
            className={styles.hiddenFileInput}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => handleAttach(e.target.files)}
          />
        </div>

        <textarea
          ref={textarea}
          className={styles.textarea}
          rows={1}
          value={draft}
          placeholder={generating ? 'SOVRA is formulating an evidence-grounded response...' : 'Ask about engineering drawings, SOPs, or inspection reports...'}
          disabled={generating}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message"
        />

        {generating ? (
          <button
            className={`${styles.sendButton} ${styles.abortButton}`}
            onClick={abortTurn}
            type="button"
            aria-label="Stop generating"
            title="Stop generating"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            className={styles.sendButton}
            disabled={draft.trim() === '' && attachments.length === 0}
            onClick={send}
            type="button"
            aria-label="Send Message"
            title="Send Message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
