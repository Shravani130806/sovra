import styles from './Message.module.css'
import type { ReactNode } from 'react'

export interface MessageProps {
  role: 'user' | 'assistant'
  content?: string
  children?: ReactNode
}

export function Message({ role, content, children }: MessageProps) {
  const isUser = role === 'user'

  return (
    <div className={styles.message}>
      <div className={`${styles.avatar} ${isUser ? styles.avatarUser : styles.avatarAssistant}`}>
        {isUser ? 'US' : 'AI'}
      </div>
      
      <div className={styles.content}>
        {content && <p>{content}</p>}
        {children}
        
        {!isUser && (
          <div className={styles.actions}>
            <button className={styles.actionBtn}>📋 Copy</button>
            <button className={styles.actionBtn}>🔄 Regenerate</button>
            <button className={styles.actionBtn}>👍 Good</button>
            <button className={styles.actionBtn}>👎 Bad</button>
          </div>
        )}
      </div>
    </div>
  )
}
