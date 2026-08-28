import styles from './MessageList.module.css'
import { Message } from './Message.tsx'
import { SourcesView } from '../components/SourcesView.tsx'
import { ArtifactView } from '../components/ArtifactView.tsx'

export function MessageList() {
  return (
    <div className={styles.messageList}>
      <Message role="user" content="Analyze the Pump P-101 inspection report and generate an approval note for maintenance." />
      
      <Message role="assistant">
        <p>I have analyzed the recent inspection report for Pump P-101. The findings indicate an anomaly in the primary seal mechanism, which correlates with the recent pressure drop incidents.</p>
        
        <h4>Key Findings</h4>
        <ul>
          <li><strong>Seal Integrity:</strong> 40% degradation detected.</li>
          <li><strong>Vibration Analysis:</strong> Exceeds normal operating parameters by 15%.</li>
          <li><strong>Maintenance Recommendation:</strong> Immediate replacement of the primary seal and inspection of V-204 valve connection.</li>
        </ul>
        
        <p>I have generated the requested approval note for the maintenance team.</p>

        <SourcesView />
        <ArtifactView />
      </Message>
    </div>
  )
}
