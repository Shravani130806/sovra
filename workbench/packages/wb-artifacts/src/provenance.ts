import type { WbCitation } from '@mrpl/dsh-workbench-types'

export interface ProvenanceBlock {
  sources: WbCitation[]
  toolsUsed: string[]
  generatedAt: string
}

export function buildProvenance(
  citations: readonly WbCitation[],
  tools: readonly string[],
): ProvenanceBlock {
  return {
    sources: [...citations],
    toolsUsed: [...tools],
    generatedAt: new Date().toISOString(),
  }
}
