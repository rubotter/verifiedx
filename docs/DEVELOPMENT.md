# 开发与发布

## 环境

- 推荐 Node.js 22.12+（22.x）或 24+；同时兼容 20.19+（20.x）。
- npm，用于按 `package-lock.json` 安装依赖。
- Chromium，用于图标生成和浏览器回归：`npx playwright install chromium`。
- OpenSSL，用于浏览器测试生成临时 HTTPS 证书。
- Python 3，仅发布打包需要；使用标准库，无额外 Python 依赖。若系统命令为 `python`，可在构建后运行 `python scripts/package.py`。

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
```

浏览器测试使用临时配置及模拟的 X 响应，不需要登录账号。默认产物写入 `work/smoke/`，可通过 `SMOKE_OUTPUT` 指定路径；可用 `PLAYWRIGHT_BROWSERS_PATH` 指定 Chromium 缓存。

## 代码职责

| 路径 | 职责 |
| --- | --- |
| `src/` | Svelte 侧栏及 Tailwind 样式 |
| `extension/background.js` | 扫描会话、存储、标签页绑定和操作授权 |
| `extension/core.js` | 用户解析、认证分类、分页证据和筛选 |
| `extension/auto.js` | 自动采集状态、节流和停止条件 |
| `extension/capture.js` | 页面 fetch/XHR 观察与关注分页执行 |
| `extension/content.js` | 账号核对、滚动控制与消息传递 |
| `extension/overlay.js` | 粉丝自动滚动提示层 |
| `extension/friendship.js` | 单账号关注／取关及独立关系查询 |
| `extension/history.js` | 本地首次发现历史 |
| `assets/brand/` | A 版正式蓝 V 标识 |
| `scripts/` | 可复用的构建辅助工具 |

`npm run build` 将侧栏生成到 `extension/panel.html`、`panel.js` 和 `panel.css`。这些文件和可能产生的 `extension/assets/` 被 Git 忽略，但必须包含在发布包中。其余扩展脚本直接作为源码加载。

修改 Logo 时编辑 `assets/brand/verifiedx.svg`，运行 `npm run build:icons`，检查 16、32、48、128 像素图标。运行图标提交到 Git，因此普通构建不需要安装浏览器。

## 发布

1. 同步修改 `package.json` 和 `extension/manifest.json` 中的版本，运行 `npm install --package-lock-only` 更新锁文件。
2. 更新相关文档，运行逻辑测试、构建和浏览器回归。
3. 执行 `npm run package`。脚本按白名单收集运行文件及公开文档，生成 ZIP 和 SHA-256 校验文件，并核对包内文件与源文件一致。
4. 在浏览器中加载解压后的 `extension/`，检查安装、侧栏、本人账号绑定和实际列表采集。模拟回归通过不代表线上全量采集已验证。
5. 将 `dist/VerifiedX-版本号.zip` 和 `.sha256` 上传至 GitHub Release。发布包不提交进源码仓库。

脚本不覆盖已有同版本安装包；需要独立验证时，可执行：

```sh
python3 scripts/package.py --output-dir work/package-check
```

ZIP 根目录直接包含 `extension/`、`README.md`、`docs/`、Logo 及安装说明，不含依赖、测试数据或本地归档。它用于开发者模式安装；应用商店上架需要另行准备材料。

## Git 与本地文件

`.gitignore` 排除依赖、编译产物、安装包、测试报告、临时证书、环境文件和本地工作目录。正式源码、锁文件、图标与公开文档保留。

旧设计草稿、图片生成记录、开发计划和完整历史验证记录归档在 `work/local-archive/`，不随源码发布。不要在生产代码或文档中加入个人绝对路径、认证头或真实账号列表。

项目采用 MIT 许可证；分发时保留仓库根目录的 `LICENSE`。
