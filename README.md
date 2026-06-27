# Boss 直聘自动投递 Agent

> ⚠️ **仅供个人求职学习使用，请遵守 Boss 直聘用户协议与相关法律法规，低频率、有头模式运行。账号受限风险自负。**

基于 Playwright + TypeScript + LLM 的 Boss 直聘（zhipin.com）自动投递 Agent。

## 功能特性

- CDP 优先连接已登录 Chrome，失败时自动启动或二维码登录兜底
- 多层数据获取：window state → route 拦截 → response 监听 → CDP Network → JS 注入 → 直接 API → DOM 兜底
- LLM JD 筛选与匹配打分，自动生成个性化打招呼语
- SQLite 持久化：去重、状态流转、缓存、黑名单、日报统计
- 验证码/反爬检测：自动截图并暂停等待人工处理
- Dry-run 模式默认开启，保护账号安全

## 安装

```bash
npm install
npx playwright install chromium
```

## 配置

复制示例环境变量文件并填写：

```bash
cp .env.example .env
```

至少配置 LLM provider 与 API Key：

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxx
```

## 运行

```bash
# 默认 Dry-run 模式（不会真正投递）
npm run dev

# 正式模式（将 DRY_RUN=false 写入 .env）
npm start

# 测试
npm test
npm run test:unit
npm run test:integration
npm run test:coverage
```

## 目录结构

```
├── src/
│   ├── browser/          # 浏览器管理、反检测、人类行为、验证码检测
│   ├── platform/boss/    # Boss 直聘专属 API 与 DOM 逻辑
│   ├── llm/              # LLM 客户端、Prompt、筛选
│   ├── storage/          # SQLite 存储
│   ├── pipeline/         # 流水线与 Orchestrator
│   ├── report/           # 报告导出
│   ├── test/             # 测试 fixtures、mock、MSW
│   └── main.ts           # CLI 入口
├── scripts/              # 登录、调试脚本
├── data/                 # session、日志、数据库、报告
└── workspace/            # 开发计划与参考方案
```

## 免责声明

本项目仅用于个人求职效率提升与学习交流，不保证对平台规则的完全合规。使用者应自行评估风险，合理控制调用频率，避免对平台造成压力。
