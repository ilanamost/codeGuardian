import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { ConfigError, type Environment } from '../config.js'
import { CONFIG_KEY, ENV_FILE } from '../utils/constants.js'
import { ERROR_MESSAGE } from '../utils/error-messages.js'

// Plan 042: the environment the server starts with. The base file is read first, then the file
// named `<base>.<NODE_ENV>` on top of it, then the real process variables on top of both (as
// with Node's own env file option). NODE_ENV comes from the process, or else from the base file.
// A missing file is skipped. Nothing here logs or returns file content: an unreadable file is
// reported with a fixed message.

export type EnvFileOption = {
  directory: string
  environment: Environment
  baseName?: string
  // Returns the file text, or undefined when the file does not exist. Tests replace it.
  read?: (path: string) => string | undefined
}

function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ConfigError(ERROR_MESSAGE.envFileUnreadable)
  }
}

export function loadEnvironment(option: EnvFileOption): Environment {
  const baseName = option.baseName ?? ENV_FILE.baseName
  const read = option.read ?? readFile
  const parse = (name: string): Environment => {
    const text = read(join(option.directory, name))
    return text === undefined ? {} : parseEnv(text)
  }
  const base = parse(baseName)
  const nodeEnv = option.environment[CONFIG_KEY.nodeEnv] ?? base[CONFIG_KEY.nodeEnv]
  // The value becomes part of a file name, so anything with a path character is ignored.
  const specific = nodeEnv !== undefined && ENV_FILE.nodeEnvPattern.test(nodeEnv) ? parse(`${baseName}.${nodeEnv}`) : {}
  const processValue = Object.fromEntries(Object.entries(option.environment).filter(([, value]) => value !== undefined))
  return { ...base, ...specific, ...processValue }
}
