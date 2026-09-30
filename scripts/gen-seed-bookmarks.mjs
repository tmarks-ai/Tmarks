#!/usr/bin/env node
// Generates SQL for: 2-level folder hierarchy (5×4=20 leaf folders) + 100 bookmarks + tags
import { writeFileSync } from 'fs'

const USER_ID = 'ca00177f-6444-4490-96d5-c341f297d24b'
const OUT = 'seed-data.sql'

function sqlStr(s) { return `'${String(s).replace(/'/g, "''")}'` }

// ── Folder hierarchy: 5 parents × 4 children = 25 folders ──────────────
const folders = [
  // [id, name, parent_id, position]
  ['seed-cat-dev', '开发工具', null, 0],
  ['seed-cat-design', '设计资源', null, 1],
  ['seed-cat-ai', 'AI 技术', null, 2],
  ['seed-cat-learn', '学习资源', null, 3],
  ['seed-cat-life', '生活资讯', null, 4],

  ['seed-sub-fe', '前端框架', 'seed-cat-dev', 0],
  ['seed-sub-be', '后端框架', 'seed-cat-dev', 1],
  ['seed-sub-devtools', '开发工具', 'seed-cat-dev', 2],
  ['seed-sub-codelearn', '代码学习', 'seed-cat-dev', 3],

  ['seed-sub-ui', 'UI 设计', 'seed-cat-design', 0],
  ['seed-sub-icons', '图标素材', 'seed-cat-design', 1],
  ['seed-sub-colors', '配色方案', 'seed-cat-design', 2],
  ['seed-sub-inspire', '灵感创意', 'seed-cat-design', 3],

  ['seed-sub-aitools', 'AI 工具', 'seed-cat-ai', 0],
  ['seed-sub-ml', '机器学习', 'seed-cat-ai', 1],
  ['seed-sub-llm', '大语言模型', 'seed-cat-ai', 2],
  ['seed-sub-aipaper', 'AI 论文', 'seed-cat-ai', 3],

  ['seed-sub-tutorial', '编程教程', 'seed-cat-learn', 0],
  ['seed-sub-courses', '在线课程', 'seed-cat-learn', 1],
  ['seed-sub-docs', '技术文档', 'seed-cat-learn', 2],
  ['seed-sub-blog', '技术博客', 'seed-cat-learn', 3],

  ['seed-sub-news', '新闻资讯', 'seed-cat-life', 0],
  ['seed-sub-shop', '购物比价', 'seed-cat-life', 1],
  ['seed-sub-travel', '旅游出行', 'seed-cat-life', 2],
  ['seed-sub-tools', '效率工具', 'seed-cat-life', 3],
]

// ── 100 bookmarks: [title, url, description, folder_id, tags[], is_pinned] ──
const bm = [
  // sub-fe 前端框架
  ['React – 用于构建用户界面的库', 'https://react.dev', 'React 让创建交互式 UI 变得轻而易举。声明式编程，组件化架构。', 'seed-sub-fe', ['React','前端'], true],
  ['Vue.js – 渐进式 JavaScript 框架', 'https://vuejs.org', '易学易用，灵活的渐进式框架，响应式数据绑定。', 'seed-sub-fe', ['Vue','前端'], false],
  ['Svelte – 编译时框架', 'https://svelte.dev', '无虚拟 DOM，编译时优化，极小的运行时体积。', 'seed-sub-fe', ['Svelte','前端'], false],
  ['Solid.js – 高性能 UI 库', 'https://www.solidjs.com', '细粒度响应式，JSX 语法，极致性能。', 'seed-sub-fe', ['SolidJS','前端'], false],
  ['Astro – 内容驱动的网站框架', 'https://astro.build', 'Islands 架构，零 JS 默认输出，多框架混用。', 'seed-sub-fe', ['Astro','前端'], false],

  // sub-be 后端框架
  ['Express.js – Node.js Web 框架', 'https://expressjs.com', '极简灵活的 Node.js Web 应用框架。', 'seed-sub-be', ['Node.js','后端'], false],
  ['NestJS – 进阶 Node.js 框架', 'https://nestjs.com', 'TypeScript 优先，模块化架构，依赖注入。', 'seed-sub-be', ['Node.js','后端'], false],
  ['Fastify – 高性能 Node.js 框架', 'https://fastify.dev', '低开销，高性能，插件化架构。', 'seed-sub-be', ['Node.js','后端'], false],
  ['Hono – 超快 Web 框架', 'https://hono.dev', '基于 Web 标准，支持 Cloudflare Workers/Bun/Deno。', 'seed-sub-be', ['后端','Edge'], false],
  ['FastAPI – Python 高性能 API 框架', 'https://fastapi.tiangolo.com', '类型提示驱动，自动文档，异步支持。', 'seed-sub-be', ['Python','后端'], false],

  // sub-devtools 开发工具
  ['Visual Studio Code – 代码编辑器', 'https://code.visualstudio.com', '功能强大的代码编辑器，丰富的扩展生态。', 'seed-sub-devtools', ['编辑器','工具'], true],
  ['GitHub – 代码托管平台', 'https://github.com', '全球最大代码托管平台，协作开发。', 'seed-sub-devtools', ['Git','工具'], false],
  ['GitLab – DevOps 平台', 'https://gitlab.com', '一体化 DevOps 平台，CI/CD 内置。', 'seed-sub-devtools', ['Git','DevOps'], false],
  ['Docker – 容器化平台', 'https://www.docker.com', '构建、分享、运行容器化应用。', 'seed-sub-devtools', ['Docker','DevOps'], false],
  ['Postman – API 开发工具', 'https://www.postman.com', 'API 设计、测试、文档一体化平台。', 'seed-sub-devtools', ['API','工具'], false],

  // sub-codelearn 代码学习
  ['LeetCode – 算法刷题', 'https://leetcode.com', '海量算法题目，面试备战首选。', 'seed-sub-codelearn', ['算法','学习'], false],
  ['HackerRank – 编程练习', 'https://www.hackerrank.com', '编程挑战，技能认证。', 'seed-sub-codelearn', ['算法','学习'], false],
  ['Codewars – 编程武道场', 'https://www.codewars.com', '通过 kata 挑战提升编程技能。', 'seed-sub-codelearn', ['算法','学习'], false],
  ['freeCodeCamp – 免费编程课程', 'https://www.freecodecamp.org', '免费编程课程，项目实战，认证证书。', 'seed-sub-codelearn', ['课程','学习'], false],
  ['Exercism – 编程练习平台', 'https://exercism.org', '多语言编程练习，导师指导。', 'seed-sub-codelearn', ['练习','学习'], false],

  // sub-ui UI 设计
  ['Figma – 协作设计工具', 'https://www.figma.com', '实时协作 UI 设计，原型交互，组件库。', 'seed-sub-ui', ['设计','UI'], true],
  ['Sketch – Mac 设计工具', 'https://www.sketch.com', '矢量设计工具，符号系统，丰富插件。', 'seed-sub-ui', ['设计','UI'], false],
  ['Framer – 交互原型设计', 'https://www.framer.com', '高保真原型，代码组件，发布网站。', 'seed-sub-ui', ['设计','原型'], false],
  ['Penpot – 开源设计工具', 'https://penpot.app', '开源免费的 Figma 替代品。', 'seed-sub-ui', ['设计','开源'], false],
  ['Principle – 交互设计工具', 'https://principlejs.org', 'Mac 交互原型设计，动画时间线。', 'seed-sub-ui', ['设计','原型'], false],

  // sub-icons 图标素材
  ['Iconify – 图标框架', 'https://icon-sets.iconify.design', '200+ 图标集，按需加载。', 'seed-sub-icons', ['图标','素材'], false],
  ['Lucide Icons – 图标库', 'https://lucide.dev', '简洁现代的开源图标集。', 'seed-sub-icons', ['图标','开源'], false],
  ['Heroicons – Tailwind 图标', 'https://heroicons.com', 'Tailwind CSS 团队出品的手工图标。', 'seed-sub-icons', ['图标','Tailwind'], false],
  ['Tabler Icons – SVG 图标', 'https://tabler.io/icons', '5000+ 可定制 SVG 图标。', 'seed-sub-icons', ['图标','素材'], false],
  ['Flaticon – 免费图标', 'https://www.flaticon.com', '海量免费矢量图标和贴纸。', 'seed-sub-icons', ['图标','素材'], false],

  // sub-colors 配色方案
  ['Coolors – 配色生成器', 'https://coolors.co', '快速生成和谐配色方案。', 'seed-sub-colors', ['配色','设计'], false],
  ['Adobe Color – 专业配色工具', 'https://color.adobe.com', '色轮配色，提取主题色。', 'seed-sub-colors', ['配色','设计'], false],
  ['Color Hunt – 精选配色', 'https://colorhunt.co', '每日精选配色灵感。', 'seed-sub-colors', ['配色','灵感'], false],
  ['Realtime Colors – 实时配色', 'https://realtimecolors.com', '实时预览配色在真实网页上的效果。', 'seed-sub-colors', ['配色','设计'], false],
  ['0to255 – 色调微调工具', 'https://0to255.com', '基于 HSL 的色调微调，方便查找颜色变体。', 'seed-sub-colors', ['配色','工具'], false],

  // sub-inspire 灵感创意
  ['Dribbble – 设计师社区', 'https://dribbble.com', '设计师作品展示平台，灵感来源。', 'seed-sub-inspire', ['灵感','设计'], false],
  ['Behance – 创意作品集', 'https://www.behance.net', 'Adobe 旗下创意作品展示平台。', 'seed-sub-inspire', ['灵感','设计'], false],
  ['Awwwards – 网页设计奖', 'https://www.awwwards.com', '最佳网页设计评选，每日灵感。', 'seed-sub-inspire', ['灵感','网页'], false],
  ['Land-book – 着陆页灵感', 'https://land-book.com', '精选优质着陆页设计。', 'seed-sub-inspire', ['灵感','网页'], false],
  ['SiteInspire – 网站灵感', 'https://www.siteinspire.net', '高质量网页设计收藏。', 'seed-sub-inspire', ['灵感','网页'], false],

  // sub-aitools AI 工具
  ['ChatGPT – AI 对话助手', 'https://chat.openai.com', 'OpenAI 出品的 AI 对话助手。', 'seed-sub-aitools', ['AI','助手'], true],
  ['Claude – AI 助手', 'https://claude.ai', 'Anthropic 出品的安全 AI 助手。', 'seed-sub-aitools', ['AI','助手'], false],
  ['Gemini – Google AI', 'https://gemini.google.com', 'Google 多模态 AI 助手。', 'seed-sub-aitools', ['AI','Google'], false],
  ['Perplexity – AI 搜索引擎', 'https://www.perplexity.ai', 'AI 驱动的搜索引擎，实时信息。', 'seed-sub-aitools', ['AI','搜索'], false],
  ['Midjourney – AI 绘画', 'https://www.midjourney.com', 'AI 图像生成工具，艺术风格丰富。', 'seed-sub-aitools', ['AI','绘画'], false],

  // sub-ml 机器学习
  ['TensorFlow – 机器学习框架', 'https://www.tensorflow.org', 'Google 开源的机器学习平台。', 'seed-sub-ml', ['ML','Google'], false],
  ['PyTorch – 深度学习框架', 'https://pytorch.org', 'Meta 出品的动态计算图深度学习框架。', 'seed-sub-ml', ['ML','PyTorch'], false],
  ['Scikit-learn – 机器学习库', 'https://scikit-learn.org', 'Python 机器学习库，简单高效。', 'seed-sub-ml', ['ML','Python'], false],
  ['Kaggle – 数据科学社区', 'https://www.kaggle.com', '数据科学竞赛、数据集、Notebook。', 'seed-sub-ml', ['ML','数据'], false],
  ['Hugging Face – AI 模型库', 'https://huggingface.co', '模型、数据集、Spaces 一站式平台。', 'seed-sub-ml', ['ML','模型'], false],

  // sub-llm 大语言模型
  ['OpenAI API – GPT 接口', 'https://platform.openai.com', 'GPT-4/GPT-3.5 API 接口。', 'seed-sub-llm', ['LLM','API'], false],
  ['Anthropic API – Claude 接口', 'https://docs.anthropic.com', 'Claude API 文档与接口。', 'seed-sub-llm', ['LLM','API'], false],
  ['LangChain – LLM 框架', 'https://www.langchain.com', 'LLM 应用开发框架。', 'seed-sub-llm', ['LLM','框架'], false],
  ['LlamaIndex – RAG 框架', 'https://www.llamaindex.ai', '面向 RAG 应用的数据框架。', 'seed-sub-llm', ['LLM','RAG'], false],
  ['Ollama – 本地大模型', 'https://ollama.com', '本地运行开源大语言模型。', 'seed-sub-llm', ['LLM','本地'], false],

  // sub-aipaper AI 论文
  ['arXiv – 预印本论文', 'https://arxiv.org', '物理学、数学、计算机科学预印本。', 'seed-sub-aipaper', ['论文','科研'], false],
  ['Papers with Code – 论文+代码', 'https://paperswithcode.com', '论文附带代码和数据集。', 'seed-sub-aipaper', ['论文','代码'], false],
  ['Google Scholar – 学术搜索', 'https://scholar.google.com', '学术论文搜索引擎。', 'seed-sub-aipaper', ['论文','搜索'], false],
  ['Semantic Scholar – AI 学术', 'https://www.semanticscholar.org', 'AI 驱动的学术搜索引擎。', 'seed-sub-aipaper', ['论文','AI'], false],
  ['Connected Papers – 论文关系图', 'https://www.connectedpapers.com', '可视化论文引用关系。', 'seed-sub-aipaper', ['论文','工具'], false],

  // sub-tutorial 编程教程
  ['MDN Web Docs – Web 技术文档', 'https://developer.mozilla.org', 'Mozilla Web 技术权威文档。', 'seed-sub-tutorial', ['文档','Web'], true],
  ['W3Schools – 编程教程', 'https://www.w3schools.com', '免费 Web 编程教程与参考。', 'seed-sub-tutorial', ['教程','Web'], false],
  ['React 教程 – 官方文档', 'https://react.dev/learn', 'React 官方交互式教程。', 'seed-sub-tutorial', ['React','教程'], false],
  ['TypeScript Handbook – 类型手册', 'https://www.typescriptlang.org/docs', 'TypeScript 官方类型系统手册。', 'seed-sub-tutorial', ['TypeScript','文档'], false],
  ['CSS-Tricks – CSS 技巧', 'https://css-tricks.com', 'CSS 技巧、指南和最佳实践。', 'seed-sub-tutorial', ['CSS','教程'], false],

  // sub-courses 在线课程
  ['Coursera – 在线课程平台', 'https://www.coursera.org', '世界名校在线课程与学位。', 'seed-sub-courses', ['课程','在线'], false],
  ['Udemy – 在线学习平台', 'https://www.udemy.com', '海量实用技能视频课程。', 'seed-sub-courses', ['课程','在线'], false],
  ['edX – 哈佛 MIT 课程', 'https://www.edx.org', '哈佛、MIT 免费在线课程。', 'seed-sub-courses', ['课程','大学'], false],
  ['Pluralsight – 技术课程', 'https://www.pluralsight.com', 'IT 和软件技能评估与课程。', 'seed-sub-courses', ['课程','技术'], false],
  ['Khan Academy – 可汗学院', 'https://www.khanacademy.org', '免费教育课程，数学到编程。', 'seed-sub-courses', ['课程','免费'], false],

  // sub-docs 技术文档
  ['DevDocs – API 文档聚合', 'https://devdocs.io', '聚合多种技术 API 文档，离线可用。', 'seed-sub-docs', ['文档','API'], false],
  ['Can I Use – 浏览器兼容性', 'https://caniuse.com', 'Web 特性浏览器支持情况查询。', 'seed-sub-docs', ['文档','兼容性'], false],
  ['web.dev – Google Web 指南', 'https://web.dev', 'Google 出品的 Web 开发最佳实践。', 'seed-sub-docs', ['文档','Web'], false],
  ['A11y Project – 无障碍指南', 'https://www.a11yproject.com', 'Web 无障碍设计资源。', 'seed-sub-docs', ['文档','无障碍'], false],
  ['OWASP – 安全最佳实践', 'https://owasp.org', 'Web 应用安全社区与指南。', 'seed-sub-docs', ['安全','文档'], false],

  // sub-blog 技术博客
  ['Dev.to – 开发者社区', 'https://dev.to', '开发者博客与讨论社区。', 'seed-sub-blog', ['博客','社区'], false],
  ['Hacker News – 科技新闻', 'https://news.ycombinator.com', 'Y Combinator 科技新闻社区。', 'seed-sub-blog', ['新闻','科技'], false],
  ['Smashing Magazine – 设计杂志', 'https://www.smashingmagazine.com', '前端与设计深度文章。', 'seed-sub-blog', ['博客','设计'], false],
  ['A List Apart – Web 设计文章', 'https://alistapart.com', 'Web 设计与开发深度文章。', 'seed-sub-blog', ['博客','设计'], false],
  ['JavaScript Weekly – JS 周刊', 'https://javascriptweekly.com', '每周 JavaScript 新闻与文章。', 'seed-sub-blog', ['JS','周刊'], false],

  // sub-news 新闻资讯
  ['BBC News – 英国广播公司', 'https://www.bbc.com/news', 'BBC 国际新闻报道。', 'seed-sub-news', ['新闻','国际'], false],
  ['Reuters – 路透社', 'https://www.reuters.com', '路透社全球新闻。', 'seed-sub-news', ['新闻','国际'], false],
  ['The Verge – 科技媒体', 'https://www.theverge.com', '科技、文化、科学新闻。', 'seed-sub-news', ['新闻','科技'], false],
  ['TechCrunch – 科技新闻', 'https://techcrunch.com', '创业、科技行业新闻。', 'seed-sub-news', ['新闻','科技'], false],
  ['Ars Technica – IT 新闻', 'https://arstechnica.com', '深度科技与 IT 行业报道。', 'seed-sub-news', ['新闻','IT'], false],

  // sub-shop 购物比价
  ['Amazon – 在线购物', 'https://www.amazon.com', '全球最大在线购物平台。', 'seed-sub-shop', ['购物','电商'], false],
  ['eBay – 拍卖与购物', 'https://www.ebay.com', '在线拍卖与购物平台。', 'seed-sub-shop', ['购物','拍卖'], false],
  ['PriceRunner – 价格比较', 'https://www.pricerunner.com', '北欧价格比较网站。', 'seed-sub-shop', ['购物','比价'], false],
  ['CamelCamelCamel – 亚马逊价格追踪', 'https://camelcamelcamel.com', 'Amazon 商品价格历史追踪。', 'seed-sub-shop', ['购物','追踪'], false],
  ['Honey – 优惠券工具', 'https://www.joinhoney.com', '自动寻找优惠码。', 'seed-sub-shop', ['购物','优惠'], false],

  // sub-travel 旅游出行
  ['Google Maps – 地图导航', 'https://maps.google.com', '谷歌地图与导航服务。', 'seed-sub-travel', ['地图','导航'], false],
  ['TripAdvisor – 旅行点评', 'https://www.tripadvisor.com', '全球旅行点评与预订。', 'seed-sub-travel', ['旅行','点评'], false],
  ['Booking.com – 酒店预订', 'https://www.booking.com', '全球酒店与住宿预订。', 'seed-sub-travel', ['旅行','酒店'], false],
  ['Airbnb – 民宿预订', 'https://www.airbnb.com', '短租民宿与体验预订。', 'seed-sub-travel', ['旅行','民宿'], false],
  ['Skyscanner – 机票搜索', 'https://www.skyscanner.com', '全球机票、酒店比价搜索。', 'seed-sub-travel', ['旅行','机票'], false],

  // sub-tools 效率工具
  ['Notion – 一站式工作空间', 'https://www.notion.so', '笔记、知识库、项目管理一体。', 'seed-sub-tools', ['效率','笔记'], true],
  ['Todoist – 待办事项管理', 'https://todoist.com', '简洁强大的任务管理工具。', 'seed-sub-tools', ['效率','任务'], false],
  ['Trello – 看板工具', 'https://trello.com', '看板式项目管理工具。', 'seed-sub-tools', ['效率','看板'], false],
  ['Obsidian – 知识管理', 'https://obsidian.md', '本地 Markdown 笔记与知识图谱。', 'seed-sub-tools', ['效率','笔记'], false],
  ['1Password – 密码管理器', 'https://1password.com', '安全密码管理，跨平台同步。', 'seed-sub-tools', ['效率','安全'], false],
]

// ── Tags ──────────────────────────────────────────────────────────────
const allTagNames = [...new Set(bm.flatMap(([, , , , tags]) => tags))]
const tags = allTagNames.map((name, i) => [`seed-tag-${String(i + 1).padStart(2, '0')}`, name])

const tagNameToId = Object.fromEntries(tags.map(([id, name]) => [name, id]))

// ── Generate SQL ──────────────────────────────────────────────────────
const lines = []

// 1. Clean up old seed data
lines.push('-- Clean up old seed data')
lines.push("DELETE FROM bookmark_tags WHERE bookmark_id LIKE 'seed-%';")
lines.push("DELETE FROM bookmarks WHERE id LIKE 'seed-%';")
lines.push("DELETE FROM tags WHERE id LIKE 'seed-%';")
lines.push("DELETE FROM bookmark_folders WHERE id LIKE 'seed-%';")
lines.push('')

// 2. Insert folders
lines.push('-- Insert 25 folders (5 parents + 20 children)')
folders.forEach(([id, name, parentId, pos]) => {
  lines.push(
    `INSERT INTO bookmark_folders (id, user_id, name, parent_id, position, is_deleted, created_at, updated_at) VALUES (${sqlStr(id)}, ${sqlStr(USER_ID)}, ${sqlStr(name)}, ${parentId ? sqlStr(parentId) : 'NULL'}, ${pos}, 0, datetime('now'), datetime('now'));`
  )
})
lines.push('')

// 3. Insert tags
lines.push(`-- Insert ${tags.length} tags`)
tags.forEach(([id, name]) => {
  lines.push(
    `INSERT INTO tags (id, user_id, name, color, click_count, created_at, updated_at) VALUES (${sqlStr(id)}, ${sqlStr(USER_ID)}, ${sqlStr(name)}, NULL, 0, datetime('now'), datetime('now'));`
  )
})
lines.push('')

// 4. Insert bookmarks
lines.push(`-- Insert ${bm.length} bookmarks`)
bm.forEach((b, i) => {
  const [title, url, desc, folderId, tagNames, isPinned] = b
  const id = `seed-bm-${String(i + 1).padStart(3, '0')}`
  const domain = new URL(url).hostname
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  const pos = i % 5 // 0-4 within folder
  const createdOffset = i // stagger created_at
  const pinned = isPinned ? 1 : 0
  const pinOrder = isPinned ? i : 0
  const clickCount = Math.floor(Math.random() * 50)
  lines.push(
    `INSERT INTO bookmarks (id, user_id, title, url, description, cover_image, favicon, is_pinned, is_archived, click_count, folder_id, pin_order, is_todo, position, normalized_url, created_at, updated_at) VALUES (${sqlStr(id)}, ${sqlStr(USER_ID)}, ${sqlStr(title)}, ${sqlStr(url)}, ${sqlStr(desc)}, NULL, ${sqlStr(favicon)}, ${pinned}, 0, ${clickCount}, ${sqlStr(folderId)}, ${pinOrder}, 0, ${pos}, ${sqlStr(url.toLowerCase())}, datetime('now', '-${createdOffset} hours'), datetime('now'));`
  )
})
lines.push('')

// 5. Insert bookmark_tags
lines.push('-- Insert bookmark_tags associations')
bm.forEach((b, i) => {
  const [title, url, desc, folderId, tagNames] = b
  const bookmarkId = `seed-bm-${String(i + 1).padStart(3, '0')}`
  tagNames.forEach((tagName) => {
    const tagId = tagNameToId[tagName]
    if (tagId) {
      lines.push(
        `INSERT INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at) VALUES (${sqlStr(bookmarkId)}, ${sqlStr(tagId)}, ${sqlStr(USER_ID)}, datetime('now'));`
      )
    }
  })
})
lines.push('')

writeFileSync(OUT, lines.join('\n'))
console.log(`Generated ${OUT}: ${folders.length} folders, ${bm.length} bookmarks, ${tags.length} tags`)
