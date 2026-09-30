const isDev = import.meta.env.DEV

type LogValue = string | number | boolean | null | undefined | Error | Record<string, unknown> | unknown[] | unknown

export const logger = {
  log: (...args: LogValue[]) => {
    if (isDev) console.log(...args)
  },
  error: (...args: LogValue[]) => {
    if (isDev) console.error(...args)
  },
  warn: (...args: LogValue[]) => {
    if (isDev) console.warn(...args)
  },
  debug: (...args: LogValue[]) => {
    if (isDev) console.debug(...args)
  },
  info: (...args: LogValue[]) => {
    if (isDev) console.info(...args)
  },
}

export default logger
