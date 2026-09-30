# TMarks · Landing

独立的落地页项目(Vite + **React** + TypeScript)。**与主仓库(`apps/web` 等)无任何代码或构建依赖**——自带独立 `package.json`,不进 pnpm workspace、不进 turbo,可单独安装/构建/部署。(运行时栈与团队一致:React 19 + Vite 7。)

设计参考 Cindy(`cindy.cn` / `cindy.app`)的暗色终端 / 赛博朋克美学:等宽技术标签、系统状态指示灯、跑马灯、编号分区(`// 01 …`)、`CONSIDER IT SAVED.` 的笃定语气。

> 内容面向 TMarks(AI 书签与标签页收纳系统):一键书签、整窗标签页收纳、网页快照、文件夹与标签、AI 智能整理、多端同步。

## 目录结构

```
landing/
├── index.html              # 模板:构建时注入 %SITE_URL% og 元数据
├── package.json            # 独立:React 19 + Vite 7 + TS
├── tsconfig.json           # strict TS + jsx: react-jsx
├── vite.config.ts          # @vitejs/plugin-react + SITE_URL og 注入
├── scripts/prerender.mjs    # SSR 渲染后把各分区静态化成可直接抓取的 HTML
├── public/                 # 原样拷贝到 dist 根
│   ├── favicon.svg  og-cover.svg  _headers  fonts/   # 自托管字体(woff2)
└── src/
    ├── main.tsx            # createRoot(<App/>)
    ├── ssr-entry.tsx       # renderToString 入口(prerender 用)
    ├── App.tsx             # 页面骨架:FX / Ticker / Nav / main / Footer
    ├── config.ts           # CONFIG(CTA 链接,见下)
    ├── lib/css.ts          # CSS 自定义属性 → style 工具
    ├── components/         # Nav Hero HeroMocks Marquee Features Snapshot
    │                       # Terminal Organize Sync Install BrowserMock
    │                       # CtaBanner Footer Ticker Reveal
    └── styles/{base,sections}.css  # 主题 + 组件(全局样式)
```

## 开发

```bash
cd landing
pnpm install --ignore-workspace   # ⚠️ 必须,否则 pnpm 会向上找到主仓库 workspace
pnpm dev        # Vite dev server (HMR)
pnpm build      # tsc --noEmit && vite build && SSR 构建 && scripts/prerender.mjs 预渲染 → dist/
pnpm preview    # 预览构建产物
pnpm type-check # 仅类型检查
```

## 配置 CTA 链接

「GitHub 源码 / 下载」「获取浏览器插件」等按钮的 `href` 在各组件中绑定 `CONFIG`(`src/config.ts`):

```ts
export const CONFIG: LandingConfig = {
  // TODO: 发布前替换为真实仓库地址;留空时 GitHub 按钮与 footer 资源栏自动隐藏。
  githubUrl: '',
  // In-page anchor by default (the install section).
  extensionUrl: '#install',
  // 立绘占位,替换为真实 Pixiu 肖像(如 '/pixiu-hero.webp')。
  heroChara: '/pixiu-hero.svg',
  manifestoChara: '/pixiu-manifesto.svg',
  footerChara: '/pixiu-footer.svg',
}
```

## 部署到 Cloudflare Pages

1. 推送代码到 Git 仓库。
2. Cloudflare → Workers & Pages → Create → Pages → Connect to Git。
3. **Build command**:`cd landing && pnpm install --ignore-workspace && pnpm build`。
4. **Build output directory**:`landing/dist`。
5. `public/_headers` 会自动应用安全与缓存策略。

或 CLI:`npx wrangler pages deploy landing/dist --project-name tmarks-landing`。

## 设计与工程说明

- **配色**:近黑底 `#06070b` + 琥珀橙主色 `#ff9f4a` + 薄荷绿 `#4ade80`(live)+ 长春花蓝 `#9db4ff`(AI)。
- **字体**:Space Grotesk(标题)、Inter(正文)、JetBrains Mono(技术标签),全部自托管于 `public/fonts/`(woff2,latin 子集),无 Google Fonts 等第三方请求。
- **动效**:跑马灯、漂浮 mock、流光渐变标题、状态灯脉冲、AI 频谱条、滚动进场(`Reveal` + IntersectionObserver)、视差跟随;已对 `prefers-reduced-motion` 降级。
- **React 架构**:页面由 `App.tsx` 组合的函数组件渲染;滚动进场用多态 `<Reveal as="...">`(保留真实标签 `article/li/header/ul`,CSS 直系子选择器与语义不受影响);Nav 用 `useState` 管开合 + Esc 关闭(原 vanilla 版的越域 `ReferenceError` 在 React 状态模型下不复存在)。
- **SEO / 预渲染**:构建时 `scripts/prerender.mjs` 用 SSR 入口把页面渲染成静态 HTML——
  抓取器与禁 JS 的浏览器拿到完整内容(无「请启用 JavaScript」占位)。`SITE_URL` 环境变量
  在构建时注入 `og:url` / `og:image` 绝对地址(社交卡片必需);og 封面在 `public/og-cover.svg`。
- **类型安全**:strict TS;`jsx: react-jsx`(自动运行时,无需每文件 `import React`)。
- **CSP**:`_headers` 内 `style-src 'self' 'unsafe-inline'`(React 内联 `style` 与装饰自定义属性所需),`script-src 'self'`(Vite 打包后的本地 bundle),其余保持严格。
- **文件体积**:所有 `.ts` / `.tsx` / `.css` 均 ≤ 300 行(`index.html` 为 SPA 入口标记,不计入)。
