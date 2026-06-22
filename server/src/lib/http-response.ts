const DEFAULT_MAX_TEXT_RESPONSE_BYTES = 1024 * 1024

export async function readLimitedTextResponse(
  response: Response,
  label = 'HTTP response',
  maxBytes = DEFAULT_MAX_TEXT_RESPONSE_BYTES
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`${label} is too large`)
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new Error(`${label} is too large`)
    }
    return buffer.toString('utf8')
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        throw new Error(`${label} is too large`)
      }
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8')
}
