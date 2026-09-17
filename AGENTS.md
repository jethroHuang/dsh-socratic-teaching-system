# dsh-socratic-teaching-system —— 插件源码仓库

> **本目录是插件源码仓库，不是教学项目。用户不会在这里上课。**
>
> 不要在本目录执行 `/上课`、`/下课`、`/复习`、`继续上课` 等教学命令，
> 也不要期望这里有学生、教材或学习进度。需要上课时，用下面「新建教学项目」
> 的方式在**别的目录**建立教学项目。

本仓库产出的是 DSH Profile Bundle + Agent Preset consumer：把教学方法与闪卡
界面作为系统能力安装，而把每本教材的全部数据留在各自的教学项目目录中。

## 新建教学项目（真正的上课目录）

教学项目的入口文档是 `templates/project/AGENTS.md`，它会被复制进新建的教材项目。
建立方式二选一：

- 在 DSH 中打开目标目录并选择预设 `dsh-socratic-teaching-system`，新会话第一步
  自动调用 `socratic_project(action=initialize)`；
- 或离线初始化：

  ```bash
  node init-project.js /path/to/new-textbook-project
  ```

初始化是幂等的：只补齐缺失的通用模板，绝不覆盖已有教材、记忆、教学计划或闪卡。

## 仓库结构

- `host.js` / `engine.js` / `core.cjs` / `project.js`：Host 半（HTTP 接口、复习引擎、
  TSV 逻辑、项目初始化）。
- `client.js`：浏览器半（`conversation.input.dock` 上的复习面板）。
- `tool.js`：Agent Preset consumer（注册 `socratic_review` 与 `socratic_project`）。
- `cordis.patch.yml` / `package.json`：Profile Bundle 声明与发布清单。
- `templates/project/**`：**新项目模板，也是教学协议的权威副本**。
- `system/`、`memory/`、`curriculum/`、`teachers/`、`world/`、`textbooks/`、`temp/`：
  上述模板在本仓库根目录的**参考副本**，方便直接阅读协议与老师人设。
  它们不是活跃教学数据，不会被写入。
- `test/`：`node --test` 测试。
- `dist/`：打包产物（已 gitignore，随 GitHub Release 发布）。

## 修改教学协议时的同步规则

`templates/project/system/*.md` 是随包发布、并被复制进每个新项目的权威版本；
根目录 `system/*.md` 是给人在仓库里直接阅读的副本。两者必须**逐字一致**：

```bash
for f in core_prompt.md session_protocol.md socratic_method.md model_adapter.md; do
  diff -q "system/$f" "templates/project/system/$f"
done
```

`templates/project/flashcards/README.md` 与根目录 `flashcards/README.md` 保持一致。

**例外（刻意不同，无需同步）**：`templates/project/AGENTS.md` 与
`templates/project/CLAUDE.md` 描述的是**教学项目**，会被复制进新建的教材目录；
而本仓库根目录的 `AGENTS.md` / `CLAUDE.md` 描述的是**本仓库**（插件源码）。
两者内容不同是正常的，不要把它们改回一致。

## 开发与发布

```bash
pnpm install --offline --ignore-scripts
pnpm test          # node --test test/*.test.js
pnpm run check     # 各入口文件语法检查
pnpm pack --pack-destination dist
```

发布：`git tag vX.Y.Z` → 推送 tag → `gh release create vX.Y.Z dist/*.tgz --title vX.Y.Z`
（沿用既有约定：轻量 tag、附 tgz 资产、notes 含安装命令）。

## 安装到 DSH Profile

```bash
dsh plugin --profile web add -w ./dist/dsh-socratic-teaching-system-<版本>.tgz --offline --ignore-scripts
```

安装或替换 Profile Bundle 后**重启现有 DSH Web Profile**；不要启动替代服务器。
已有非空会话不能切换预设，需新建会话做页面验收。

## 红线

- **不把本目录当教学项目**：不在此上课，不在此写入学生记忆或教材。
- 数据边界：插件包不包含任何教材、`books/`、学生记忆、课程计划或闪卡；
  这些都只存在于各教学项目目录中。
- 不读取或写入当前工作目录以外的教材、记忆、教学计划或闪卡数据。
- `templates/project/**` 是发布物；改它等于改所有新项目的行为，需与根目录副本同步。