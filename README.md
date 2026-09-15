# dsh-苏格拉底教学系统

这是一个可复用的 DSH **Profile Bundle + Agent Preset consumer**。它把教学方法与 DSH 闪卡界面作为系统能力安装，但把每本教材的全部数据留在各自项目目录中。

## 数据边界

插件包不包含任何教材、`books/`、现有学生记忆、现有课程计划或现有闪卡。一个教学项目目录对应一本教材，并自行保存：

```text
<project>/
├── AGENTS.md / CLAUDE.md
├── system/          # 教学协议
├── teachers/        # 老师人设
├── world/           # 可选世界观
├── textbooks/       # 用户提供的一本教材
├── memory/          # 该教材的长期学习记忆
├── curriculum/      # 该教材的教学计划
├── flashcards/      # cards.tsv 与 dsh-state.<sessionId>.json
└── temp/
```

Host 从已验证的实时 Session 读取 `header.cwd`，并只在 `<cwd>/flashcards/` 读写插件数据。HTTP 请求不能提交文件路径。不同工作目录使用不同引擎和卡组。

## 会话内自动初始化

使用 `dsh-socratic-teaching-system` 预设创建会话后，Agent 在新会话的第一步自动调用：

```text
socratic_project(action=initialize)
```

Host 根据该会话已经验证的 `cwd`，在当前项目中补齐缺失的通用目录和模板。初始化是幂等的：已有教材、记忆、教学计划、闪卡以及其他文件一律保留，不会覆盖；因此空目录、只有教材的目录、或者已经上过课的目录都可以安全使用。

命令行初始化器仍保留作为可选的离线维护入口，但不再是正常使用所必需：

```bash
node /Users/jethro/Documents/self-project/dsh-socratic-teaching-system/init-project.js /path/to/new-textbook-project
```

正常流程只需要在 DSH 中打开项目目录并选择预设。模板只有空白记忆、空白课程计划和表头式空白闪卡文件。

## 开发与安装

```bash
cd /Users/jethro/Documents/self-project/dsh-socratic-teaching-system
pnpm install --offline --ignore-scripts
pnpm test
pnpm run check
pnpm pack --pack-destination dist
dsh plugin --profile web add -w ./dist/dsh-socratic-teaching-system-0.1.3.tgz --offline --ignore-scripts
```

Agent Preset 中只放 consumer，不放 Host service，也不使用 isolate 隔离 Host service：

```yaml
- id: socratic-teaching
  name: /Users/jethro/.dsh/profiles/web/node_modules/dsh-socratic-teaching-system/tool.js
```

预设 ID：`dsh-socratic-teaching-system`；显示名：`dsh-苏格拉底教学系统`。安装或替换 Profile Bundle 后重启现有 DSH Web Profile。不要启动替代服务器。

## 使用

- `上课`、`/上课`、`复习`：Agent 先调用 `socratic_review(action=start)`。
- `继续上课`：Agent 调用 `socratic_review(action=status)` 后按实际薄弱点衔接。
- 新会话欢迎界面的复习面板最大高度为 `min(68dvh, 720px)`，较长题目和选项有更充足空间，超出时仍可在卡片内部滚动。
- 闪卡格式：UTF-8、11 列 Anki TSV（ID、Question、A-D、Answer、Hint、Source、Explanation、Tags）。
- `flashcards/cards.tsv` 是 UI 卡组权威数据；`memory/review_schedule.md` 是 Agent 在 `/下课` 时同步维护的教学摘要。
- 正式复习每轮最多 5 张；独立答对逐级延长到 3/7/14/30 天，提示、答错或跳过回到 1 天。
- 每个会话的 UI 轮次和复习进度写入当前项目的 `flashcards/dsh-state.<sessionId>.json`。

## 安全与限制

同源接口为 `POST /api/socratic-teaching/review`。写入采用临时文件、fsync 和原子重命名；损坏状态会失败关闭而不会被覆盖。一个项目的 `flashcards/` 同时只应由一个 DSH 进程写入；当前版本不提供跨进程锁。

## 验证

```bash
pnpm test
pnpm run check
```

还需在重启后的现有 `http://127.0.0.1:3080` 新建会话做页面验收。已有非空会话不能切换预设。
