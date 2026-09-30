export type AIProviderName = 'openai' | 'claude' | 'deepseek' | 'zhipu' | 'modelscope' | 'siliconflow' | 'iflow' | 'custom'

/** 服务商请求协议:7 家 OpenAI 兼容 + Claude 原生,远程预设清单也只允许这两种。 */
export type AIProtocol = 'openai-compatible' | 'claude'

/**
 * 服务商预设:连接编辑器下拉的来源。内置 7 家随扩展发布;
 * Web 下发的 ai-presets.json 可同 id 覆盖或追加新服务商,无需扩展发版。
 */
export interface ProviderPreset {
  id: string
  label: string
  protocol: AIProtocol
  baseUrl: string
  defaultModel: string
  /** 该端点是否支持 GET /models 拉取模型列表。 */
  canFetchModels: boolean
}

/** 远程预设清单的运行时形态(见 apps/web/public/ai-presets.json)。 */
export interface PresetManifest {
  schema_version: 1
  providers: ProviderPreset[]
}

export interface AIConnectionInfo {
  id?: string
  label?: string
  /** 预设 id(内置 provider 名或远程清单下发的新服务商)。 */
  provider: string
  /** 调用协议快照:保存时从预设抄录,调用不依赖清单仍在场。 */
  protocol: AIProtocol
  apiKey: string
  /** 解析后的 base URL(预设 baseUrl 快照或 custom 手输地址)。 */
  baseUrl: string
  model?: string
  lastUsedAt?: number
  lastTestedAt?: number
  lastTestStatus?: 'success' | 'failed'
  lastTestError?: string
}

export interface SourceBookmark {
  url: string
  title?: string
  description?: string
  content?: string
  tags?: string[]
  folder?: string
  folderPath?: string[]
}

export interface ExistingFolderContext {
  name: string
  path: string[]
  bookmarkCount?: number
}

export interface ExistingTagContext {
  name: string
  bookmarkCount?: number
  clickCount?: number
  updatedAt?: string
  relatedFolderPaths?: string[][]
}

/** 目录治理动态统计（per-request，注入 user 提示词）。 */
export interface FolderGovernanceStats {
  primaryCount: number
  secondaryPathCount: number
  maxSecondaryPerPrimary: number
}

export interface ClassifyOptions {
  /** 当前 AI 连接(organizer 用于发起调用;提示词构建器不读取,故预览时可省略)。 */
  connection?: AIConnectionInfo
  existingTags?: string[]
  existingTagContext?: ExistingTagContext[]
  /** 用户标签库的真实规模（含未进 300 候选窗口的长尾）；缺省回退 existingTags.length。 */
  tagLibrarySize?: number
  existingFolders?: ExistingFolderContext[]
  tagStyle?: string
  /** 自定义系统提示词;非空则替代内置 buildSystemPrompt()。 */
  customSystemPrompt?: string
  temperature?: number
  titleLength?: 'short' | 'medium' | 'long'
  descriptionDetail?: 'minimal' | 'short' | 'detailed'
  tagCount?: number
  language?: 'zh' | 'en' | 'mixed'
  sourceBookmarks?: SourceBookmark[]
}

export interface ParsedBookmarkData {
  url?: string
  title?: string
  description?: string
  tags?: string[]
  folder?: string
  folderPath?: string[]
  confidence?: number
  classification?: {
    primary?: string
    secondary?: string
    folderPath?: string[]
  }
}

export interface InvokeParams {
  /** 预设 id:内置 provider 的请求怪癖(jsonMode/附加 body)与默认模型查表键。 */
  provider: string
  protocol: AIProtocol
  baseUrl: string
  apiKey: string
  model?: string
  /** 用户消息内容(单条 URL 的来源/上下文/任务/用户风格偏好)。 */
  prompt: string
  /** 系统消息内容(锁定的 TMarks 数据契约/规则/schema)。缺省回退 provider 默认 stub(供测试连接)。 */
  system?: string
  temperature?: number
  maxTokens?: number
}

export interface AIInvokeResult {
  content: string
  raw: unknown
}
