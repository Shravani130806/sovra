import { useNavigation } from '../mock/index.ts'
import styles from './DocumentsView.module.css'

export function DocumentsView() {
  const { navigate } = useNavigation()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <h1>Knowledge Repository</h1>
          <p>Securely manage internal documents and engineering files</p>
        </div>
        <div className={styles.controls}>
          <input type="text" className={styles.search} placeholder="Search documents..." />
          <button className={styles.uploadBtn}>+ Upload Document</button>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Classification</th>
              <th>Department</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr onClick={() => navigate('document_viewer')}>
              <td style={{ fontWeight: 500, color: 'var(--wb-text-primary)' }}>Engineering Safety Manual.pdf</td>
              <td>PDF</td>
              <td><span className={`${styles.badge} ${styles.badgeRestricted}`}>Restricted</span></td>
              <td>Engineering</td>
              <td>28 Aug 2026</td>
              <td><span className={`${styles.badge} ${styles.badgeStatus}`}>Indexed</span></td>
            </tr>
            <tr onClick={() => navigate('document_viewer')}>
              <td style={{ fontWeight: 500, color: 'var(--wb-text-primary)' }}>Pump_P101_Specs.xlsx</td>
              <td>XLSX</td>
              <td><span className={`${styles.badge} ${styles.badgeInternal}`}>Internal</span></td>
              <td>Maintenance</td>
              <td>25 Aug 2026</td>
              <td><span className={`${styles.badge} ${styles.badgeStatus}`}>Indexed</span></td>
            </tr>
            <tr onClick={() => navigate('document_viewer')}>
              <td style={{ fontWeight: 500, color: 'var(--wb-text-primary)' }}>Q3_Operations_Report.docx</td>
              <td>DOCX</td>
              <td><span className={`${styles.badge} ${styles.badgeInternal}`}>Internal</span></td>
              <td>Operations</td>
              <td>15 Aug 2026</td>
              <td><span className={`${styles.badge} ${styles.badgeStatus}`}>Indexed</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
