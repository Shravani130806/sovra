import styles from './MessageList.module.css'
import { Message } from './Message.tsx'
import { ToolCard } from './ToolCard.tsx'
import { SourcesView } from '../components/SourcesView.tsx'
import { ArtifactView } from '../components/ArtifactView.tsx'
import { useChat } from '../live/hooks.ts'

/**
 * Render assistant text with inline citation markers.
 *
 * `[1]`-style markers are turned into superscripts that point at the Sources
 * panel's ordering, so a claim in the answer can be traced to the passage it
 * came from. Text is rendered as text — never as HTML — because it is model
 * output and must not be able to inject markup into the page.
 */
function withCitations(text: string): React.ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part)
    return match
      ? <sup key={i} className={styles.citation}>{match[1]}</sup>
      : <span key={i}>{part}</span>
  })
}

export function MessageList() {
  const { turns } = useChat()

  return (
    <div className={styles.messageList}>
      {turns.map((turn) => (
        <Message key={turn.id} role={turn.role}>
          {turn.text ? <p className={styles.text}>{withCitations(turn.text)}</p> : null}

          {turn.tools.map((node) => (
            <ToolCard key={node.callId} node={node} />
          ))}

          {turn.streaming && turn.text === '' && turn.tools.length === 0 ? (
            <p className={styles.thinking} aria-live="polite">Working…</p>
          ) : null}

          {/* Sources and artifacts belong to the settled answer, not to a
              turn still forming — showing them early implies the answer is
              already grounded when it may yet change. */}
          {turn.role === 'assistant' && !turn.streaming ? (
            <>
              <SourcesView />
              <ArtifactView />
            </>
          ) : null}
        </Message>
      ))}
    </div>
  )
}
