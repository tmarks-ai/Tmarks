/** chrome.runtime.sendMessage 的 Promise 包装:出错或无响应时返回 null,不抛。
 *  复用于设置页各段(同步/重试/接受远端)与缓存卡的 background 消息收发。 */
export function sendMsg<T>(msg: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : (r as T)))
  })
}
