import type { Context } from '@deepseek-ai/cordis'
import type { WbToolGatewayService } from '@mrpl/dsh-workbench-types'
import Schema from '@deepseek-ai/schemastery'

import { registerArtifactTools } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wbToolGateway: WbToolGatewayService
  }
}

export const name = 'wb-artifacts'

export const inject = ['tools', 'wbToolGateway'] as const

export interface Config {
  outputDir: string
}

export const Config: Schema<Config> = Schema.object({
  outputDir: Schema.string().default('/tmp/wb-artifacts'),
})

const TOOL_MANIFESTS = [
  {
    toolId: 'wb_generate_report',
    riskLevel: 'local' as const,
    requiredPermissions: [],
    dataClassificationCeiling: 'PUBLIC' as const,
    networkAccess: 'none' as const,
  },
  {
    toolId: 'wb_generate_approval_note',
    riskLevel: 'local' as const,
    requiredPermissions: [],
    dataClassificationCeiling: 'PUBLIC' as const,
    networkAccess: 'none' as const,
  },
  {
    toolId: 'wb_generate_spreadsheet',
    riskLevel: 'local' as const,
    requiredPermissions: [],
    dataClassificationCeiling: 'PUBLIC' as const,
    networkAccess: 'none' as const,
  },
  {
    toolId: 'wb_generate_presentation',
    riskLevel: 'local' as const,
    requiredPermissions: [],
    dataClassificationCeiling: 'PUBLIC' as const,
    networkAccess: 'none' as const,
  },
]

export function apply(ctx: Context, config: Config) {
  const outputDir = config.outputDir

  ctx.effect(() => {
    registerArtifactTools(ctx, outputDir)

    for (const manifest of TOOL_MANIFESTS) {
      ctx.wbToolGateway.registerManifest(manifest)
    }

    return () => {
      // WbToolGatewayService has no unregisterManifest method; manifests
      // persist until the gateway itself is disposed. Tool unregistration
      // is handled by the ToolRuntime effect lifecycle.
    }
  }, 'wb-artifacts.tools()')
}
