import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  asWbAuditEntryId,
  type WbAuditEntry,
  type WbAuditEntryId,
  type WbIdentityService,
  type WbPolicyDecisionEvent,
  type WbRagRetrievedEvent,
  type WbIngestionCompletedEvent,
  type WbUserId,
  type WbSessionId,
} from '@mrpl/dsh-workbench-types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

export const name = 'wb-audit'

export const inject = ['wbIdentity'] as const

export interface Config {
  /** The audit directory path where JSONL files are stored. */
  root: string
}

export const Config: z<Config> = z.object({
  root: z.string().default('$DSH_HOME/workbench/audit'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbAudit: WbAuditService
    /** Identity service provided by wb-identity plugin. */
    wbIdentity: WbIdentityService
  }

  interface Events {
    /** A policy decision was made. */
    'wb/policy/decision'(event: WbPolicyDecisionEvent): void
    /** RAG retrieval completed. */
    'wb/rag/retrieved'(event: WbRagRetrievedEvent): void
    /** Document ingestion completed. */
    'wb/ingestion/completed'(event: WbIngestionCompletedEvent): void
  }
}

/**
 * Append-only provenance log of every decision + tool call.
 * Subscribes to workbench and harness events and writes one WbAuditEntry per
 * meaningful operation to JSONL files rotated daily.
 */
export class WbAuditService extends Service {
  static inject = ['wbIdentity'] as const

  private readonly root: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wbAudit')
    this.root = config.root.replace('$DSH_HOME', process.env.DSH_HOME ?? '.')

    // Ensure root directory exists
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true })
    }

    // Subscribe to workbench events
    ctx.effect(() => {
      const unsubPolicy = ctx.on('wb/policy/decision', (_event) => {
        // Gap: policy decision events lack sessionId and userId in payload.
        // Skip recording until gap is resolved (see README.md Deviations).
        // For now, we cannot produce a valid WbAuditEntry.
        // TODO: implement when DESIGN.md §12 gap is resolved.
      })

      const unsubRag = ctx.on('wb/rag/retrieved', (event) => {
        const sessionId = event.sessionId
        const userId = this.getIdentity(sessionId)
        this.record({
          sessionId,
          userId: userId ?? ('unknown' as WbUserId),
          kind: 'rag_retrieval',
          summary: `RAG retrieval for session ${sessionId}`,
          payload: event as unknown as Record<string, unknown>,
        })
      })

      const unsubIngestion = ctx.on('wb/ingestion/completed', (_event) => {
        // Gap: ingestion completed events lack sessionId and userId.
        // Skip recording until gap is resolved.
        // TODO: implement when DESIGN.md §12 gap is resolved.
      })

      const unsubSession = ctx.on('session/event', (session: Session, event: SessionEvent) => {
        const sessionId = session.id as unknown as WbSessionId
        const userId = this.getIdentity(sessionId)
        if (event.type === 'tool/result') {
          this.record({
            sessionId,
            userId: userId ?? ('unknown' as WbUserId),
            kind: 'tool_result',
            summary: `Tool result for call in step ${event.data.step}`,
            payload: event.data as unknown as Record<string, unknown>,
          })
        } else {
          // Skip high-volume/no-value types to avoid flooding audit log
          const skipTypes = new Set([
            'assistant/chunk',
            'request/header',
            'request/context',
            'session/end-seed',
          ])
          if (!skipTypes.has(event.type)) {
            this.record({
              sessionId,
              userId: userId ?? ('unknown' as WbUserId),
              kind: 'session_event',
              summary: `Session event ${event.type}`,
              payload: event.data as unknown as Record<string, unknown>,
            })
          }
        }
      })

      return () => {
        unsubPolicy()
        unsubRag()
        unsubIngestion()
        unsubSession()
      }
    }, 'wb-audit')
  }

  private getAuditFilePath(dateStr: string): string {
    return path.join(this.root, `audit-${dateStr}.jsonl`)
  }

  private appendToAudit(entry: WbAuditEntry): void {
    const dateStr = entry.at.slice(0, 10)
    const filePath = this.getAuditFilePath(dateStr)
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(filePath, line, 'utf8')
  }

  private generateId(): WbAuditEntryId {
    return asWbAuditEntryId(crypto.randomUUID())
  }

  /** Get the user ID for a session from the identity service. */
  getIdentity(sessionId: WbSessionId): WbUserId | undefined {
    const identityService = this.ctx.get('wbIdentity') as WbIdentityService | undefined
    if (!identityService) return undefined
    const user = identityService.current(sessionId)
    return user?.id
  }

  /** Record an audit entry. */
  record(entry: Omit<WbAuditEntry, 'id' | 'at'>): void {
    const id = this.generateId()
    const at = new Date().toISOString()
    const fullEntry: WbAuditEntry = { id, at, ...entry }
    this.appendToAudit(fullEntry)
  }

  /** Query audit entries by filter criteria. */
  query(filter: { sessionId?: WbSessionId; userId?: WbUserId; kind?: WbAuditEntry['kind'] }): WbAuditEntry[] {
    // Read all JSONL files from root directory
    if (!fs.existsSync(this.root)) return []
    const files = fs.readdirSync(this.root).filter(f => f.startsWith('audit-') && f.endsWith('.jsonl'))
    const allEntries: WbAuditEntry[] = []
    for (const file of files) {
      const filePath = path.join(this.root, file)
      const content = fs.readFileSync(filePath, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as WbAuditEntry
          allEntries.push(parsed)
        } catch {
          // Skip malformed lines, log warning
          this.ctx.logger.warn(`wb-audit: skipping malformed line in ${file}`)
        }
      }
    }
    // Apply filter
    return allEntries.filter(entry => {
      if (filter.sessionId && entry.sessionId !== filter.sessionId) return false
      if (filter.userId && entry.userId !== filter.userId) return false
      if (filter.kind && entry.kind !== filter.kind) return false
      return true
    })
  }
}

export default WbAuditService