# TMarks

AI 书签与标签页收纳系统:一键书签、整窗标签页收纳、网页快照、文件夹与标签、
AI 智能整理、多端同步。自托管于 Cloudflare Workers + D1 + R2。

## 结构

```
packages/
  contracts/   @tmarks/contracts   单一契约源(品牌类型 + 权威目录)
  ai/          @tmarks/ai           单条书签 AI 分类
  backend-core/ @tmarks/backend-core 后端 handler + Hono 路由
apps/
  web/         React 19 + Vite 7 + Tailwind v4(Web 应用)
  tab/         MV3 扩展(Dexie + revision 同步)
  worker/      Cloudflare Worker(消费 backend-core)
landing/       落地页(独立构建,不参与 turbo 流水线)
sql/           D1 schema 唯一来源(01-08 按域编号,追加式演进,见 sql/README.md)
```

## 硬约束

每个代码文件 ≤ 300 行,由 `scripts/check-code-size.mjs` 强制(根 `pnpm check:code-size`)。

## 快速开始

```bash
pnpm install        # Node ≥ 20,pnpm 10
pnpm build          # turbo run build
pnpm type-check     # turbo run type-check
pnpm test           # turbo run test
pnpm check:code-size
```

部署与自托管步骤(创建 D1/R2、迁移、Secret、自定义域名)见 [DEPLOY.md](./DEPLOY.md)。

## 浏览器扩展

扩展安装、API 源/密钥配置与三方同步协作链路见 [EXTENSION.md](./EXTENSION.md)。

## 安全

- Web 端:密码登录(JWT 访问令牌 + HttpOnly Cookie 刷新令牌,轮换并检测重用)。
- 扩展端:细粒度 `X-API-Key`。
- Worker 启动即 fail-closed:D1 迁移未应用或 `JWT_SECRET` 弱于 32 字符时拒绝服务。
- 漏洞请走私密渠道,详见 [SECURITY.md](./SECURITY.md)。

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 许可

[MIT](./LICENSE) © 2024-2026 TMarks Team。第三方声明见 [NOTICE.md](./NOTICE.md)。

## 原则

重写"壳",复用"算法":脚手架全新,但 sync / snapshot / license / auth / AI 单条分类的
prompt+解析+fallback / D1 schema 从旧版自研代码移植(© TMarks Team,原 CC BY-NC 4.0,
本仓库随仓库整体以 MIT 再授权,见 NOTICE.md)。