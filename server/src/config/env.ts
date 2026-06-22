import { config } from 'dotenv'
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const candidateEnvFiles = [
  process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : '',
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'server/.env'),
  resolve(process.cwd(), '../.env'),
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../../../../.env')
]

for (const envPath of [...new Set(candidateEnvFiles.filter(Boolean))]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false, quiet: true })
  }
}
