import { useRef, useState } from 'react'
import styles from './EngineeringVisionView.module.css'
import { useVision } from '../live/hooks.ts'
import { boxToPixels, setImage, setQuestion, startAnalysis } from '../live/vision-store.ts'

/** Rendered size the overlay is computed against. */
const VIEW = { width: 720, height: 480 }

export interface EngineeringVisionViewProps {
  /** Run `wb_vision_analyze` against the loaded image; supplied by the container. */
  onAnalyze?: (question: string) => void
}

export function EngineeringVisionView({ onAnalyze }: EngineeringVisionViewProps) {
  const { imageUrl, imageName, question, findings, analyzing, noFindingReason, error } = useVision()
  const [hovered, setHovered] = useState<string | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)

  function accept(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setImage(URL.createObjectURL(file), file.name)
  }

  function analyze() {
    if (!imageUrl || question.trim() === '') return
    startAnalysis()
    onAnalyze?.(question.trim())
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.uploadButton} onClick={() => input.current?.click()}>
          {imageUrl ? 'Replace drawing' : 'Load drawing'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf"
          aria-label="Load drawing"
          className={styles.hiddenInput}
          onChange={(e) => accept(e.target.files)}
        />
        {imageName ? <span className={styles.filename}>{imageName}</span> : null}
      </div>

      <div className={styles.queryBar}>
        <input
          className={styles.query}
          aria-label="Question"
          placeholder="Inspect pump P-101 and check valve V-204"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') analyze() }}
        />
        <button
          type="button"
          className={styles.analyzeButton}
          disabled={!imageUrl || question.trim() === '' || analyzing}
          onClick={analyze}
        >
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {!imageUrl ? (
        <div
          className={styles.dropzone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); accept(e.dataTransfer.files) }}
        >
          Drop a P&amp;ID, blueprint or scanned schematic here
        </div>
      ) : (
        <div className={styles.canvas} style={{ width: VIEW.width, height: VIEW.height }}>
          <img src={imageUrl} alt={imageName ?? 'drawing'} className={styles.image} />
          {/* Boxes are fractions of the image, so the overlay is computed
              against the rendered size rather than baked at any one scale. */}
          <svg
            className={styles.overlay}
            viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
            aria-label="Findings overlay"
          >
            {findings.map((finding) => {
              const rect = boxToPixels(finding.box, VIEW.width, VIEW.height)
              return (
                <rect
                  key={finding.id}
                  x={rect.x} y={rect.y} width={rect.width} height={rect.height}
                  className={`${styles.box} ${hovered === finding.id ? styles.boxActive : ''}`}
                  onMouseEnter={() => setHovered(finding.id)}
                  onMouseLeave={() => setHovered(undefined)}
                />
              )
            })}
          </svg>
        </div>
      )}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {noFindingReason ? (
        // A refusal is a successful, honest answer — not an error state.
        <p className={styles.noFinding}>{noFindingReason}</p>
      ) : null}

      {findings.length > 0 ? (
        <ul className={styles.findings}>
          {findings.map((finding) => (
            <li
              key={finding.id}
              className={`${styles.finding} ${hovered === finding.id ? styles.findingActive : ''}`}
              onMouseEnter={() => setHovered(finding.id)}
              onMouseLeave={() => setHovered(undefined)}
            >
              <span className={styles.findingSummary}>{finding.summary}</span>
              {finding.tag ? <span className={styles.tag}>{finding.tag}</span> : null}
              <span className={styles.confidence}>{Math.round(finding.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
