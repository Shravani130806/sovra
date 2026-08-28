import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Write binary content to a file using node:fs/promises.
 *
 * Deviation from `ctx.fs` (text-only): wb-artifacts produces binary artifacts
 * (.docx, .xlsx, .pptx) that `ctx.fs.writeText` cannot handle. We use
 * `ctx.fs.resolve()` for path normalization, then `node:fs/promises` for the
 * actual write, and emit `fs/observed` for telemetry. See DESIGN.md §6.9.
 */
export async function writeArtifact(
  filePath: string,
  buffer: Buffer,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, buffer)
}
