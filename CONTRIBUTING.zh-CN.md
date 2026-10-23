# 贡献指南

[English](CONTRIBUTING.md)

欢迎贡献 bug 修复、功能、文档和翻译。请先提 Issue，让问题与改动范围在 PR review 前得到明确说明。

## 先提 Issue

开始前先搜索[已有 Issue](https://github.com/fxbing/paseo-workboard/issues) 和 [PR](https://github.com/fxbing/paseo-workboard/pulls)。**每个 PR 都必须关联已有 Issue。** 没有覆盖当前改动的 Issue 时先创建；已有相关讨论则直接参与，不重复提单。较大的行为或架构调整应先在 Issue 中讨论，再开始实现。

标题应具体，正文根据请求类型说明必要内容：

- **Bug：** 问题及影响、复现步骤、预期与实际行为，以及涉及的 Workboard/Paseo 版本、操作系统和客户端。必要时附最小示例或脱敏日志、截图。
- **功能或改进：** 使用场景、当前缺少的能力、期望行为、考虑过的替代方案，以及如何判断改动有效。
- **文档或翻译：** 受影响的页面或章节、不准确或不清楚的内容，以及建议的修正。

使用虚构任务与示例。公开报告中不得包含凭证、私有会话、内部 URL、个人路径或真实 workspace 数据。

## 准备 PR

从最新 `main` 创建分支，PR 目标分支为 `main`。每个 PR 聚焦关联 Issue，不混入无关清理或依赖升级。

标题描述改动后的行为，正文应包含：

- **Summary：** 问题、改动后的行为，以及 reviewer 需要理解的设计取舍。Bug 修复可用简短的前后行为示例说明。
- **Related issue：** 完整解决时使用 `Fixes #123`，只处理其中一部分时使用 `Refs #123`。
- **Validation：** 实际执行的命令及结果，未验证项与原因；涉及集成或 UI 检查时说明宿主版本和平台。
- **Compatibility and risks（适用时）：** 存储数据、宿主兼容、标签、置顶或归档行为的变化。UI 改动附使用虚构数据的截图或短录屏，或说明尚未完成视觉检查的原因。

同步更新受影响的中英文文档。本地测试不能作为 CI、安装或发布成功的证明。提交前审阅全部改动，包括 AI 生成的部分。

## 环境与检查

通过 `mise` 使用项目运行时：

```sh
mise install
mise exec -- npm ci --ignore-scripts
mise exec -- npm run check
mise exec -- npm run format:check
```

`npm run check` 会运行 TypeScript 和单元测试。开发时先运行最小相关测试，再按改动类型执行检查：

| 改动                                  | 必需检查                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| 代码                                  | 相关测试、`mise exec -- npm run check` 和 `mise exec -- npm run format:check` |
| 纯文档                                | 格式、链接与源码一致性，无需运行单元测试                                      |
| 包、依赖、manifest 或 README 打包契约 | 额外运行 `mise exec -- npm run check:package`                                 |
| 宿主兼容桥接                          | 额外按[隔离集成指南](tests/integration/README.zh-CN.md)运行受支持宿主的测试   |

包检查验证待发布文件清单和 README 必需标题，不会执行发布。保留英文 README 的 `## Installation` 与 `## Limitations` 标题，Paseo Cafe 会用它们提取内容。[验证记录](docs/zh-CN/verification.md)只记录实际执行过的检查。

## 变更边界

- 常规单元测试必须确定性运行，不能依赖 daemon、浏览器、网络服务、模型或个人 Paseo home。
- 真宿主集成测试只能使用带 marker 的一次性临时 Paseo home，见[集成测试说明](tests/integration/README.zh-CN.md)。
- 不要把集成变量指向日常 Paseo home。该套件会修改自己的 fixture provider 并创建测试 workspace。
- 使用现有 React Native primitive 和 `theme` 颜色，紧凑控件保持现有的 36px 最小点击区。
- 公共 SDK 和 React Native API 已能完成的小型 UI 行为，不新增依赖。

## 架构与兼容性

先阅读[架构说明](docs/zh-CN/architecture.md)，再查看[验证记录](docs/zh-CN/verification.md)了解当前证据和边界。server 负责持久化看板投影和原生写入；client 是跟随主题的 React Native 界面。版本敏感集成集中在 `server/paseo-compat.ts`（宿主操作）和 `client/paseo-language.ts`（Web/Electron 语言设置）。

修改该兼容性边界时，必须补充已支持 Paseo 版本的测试；支持范围或证据变化时也要更新验证或发布文档。不能仅凭 TypeScript 类型推断兼容性。

Paseo 最低版本由 `paseo-plugin.json` 定义。三个 Paseo SDK 开发依赖保持相同版本，并与受支持宿主一起验证；一次宿主集成通过不代表完成 SDK 迁移。

## 使用 AI 辅助贡献

AI 编程助手修改仓库前必须阅读 [AGENTS.md](AGENTS.md)。`CLAUDE.md` 是指向该文件的相对软链；修改共享规则即可，不维护第二份副本。贡献者仍需理解改动、审阅结果并验证实际行为。

## 发布

打包和发布请遵循[发布说明](docs/zh-CN/releasing.md)。
