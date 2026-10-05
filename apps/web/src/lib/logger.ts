const isDev = import.meta.env.DEV

type LogValue = string | number | boolean | null | undefined | Error | Record<string, unknown> | unknown[] | unknown

export const logger = {
  log: (...args: LogValue[]) => {
    if (isDev) console.log(...args)
  },
  // R8 WS-6: error stays audible in production — failures on the auth/refresh/
  // cache paths used to vanish with zero trace, leaving nothing to debug.
  error: (...args: LogValue[]) => {
    console.error(...args)
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
