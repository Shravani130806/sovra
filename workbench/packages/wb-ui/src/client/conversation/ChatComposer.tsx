import styles from './ChatComposer.module.css'

export function ChatComposer() {
  return (
    <div className={styles.composerWrapper}>
      <div className={styles.composerInner}>
        <div className={styles.composerControls}>
          <button className={styles.iconButton} title="Attach Document/Image">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
        </div>
        
        <textarea 
          className={styles.textarea} 
          placeholder="Ask the Sovereign AI Workbench..." 
          rows={1}
        />
        
        <div className={styles.composerActions}>
          <button className={styles.sendButton} title="Send Message">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.footerText}>
        AI-generated content may be incorrect. Confidential data remains sovereign.
      </div>
    </div>
  )
}
