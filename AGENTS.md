# 苏格拉底教学系统项目入口

本目录只服务于**一本教材**。所有路径均相对当前工作目录；不得把其他项目的教材或学习记忆混入本项目。

## 会话启动

1. 静默读取 `system/core_prompt.md`。
2. `/上课` 时按 `system/session_protocol.md` 加载 `memory/`、`curriculum/syllabus.md`、当前老师人设与 `textbooks/`。
3. 使用 `socratic_review` 时，卡组和复习状态只来自 `flashcards/`。

## 项目结构

- `system/`：教学协议，只读。
- `teachers/`：老师人设，只读，可按模板扩展。
- `world/`：可选世界观，只读。
- `textbooks/`：本项目唯一教材，由用户维护，只读。
- `memory/`：本教材的长期学习记忆，读写。
- `curriculum/`：本教材的教学计划，读写。
- `flashcards/`：本教材的卡片与 DSH 复习状态，读写。
- `temp/`：临时文件，读写，下课清理。

## 命令

`/上课 [老师名]`、`/下课`、`/切换老师 [名字]`、`/复习`、`继续上课`、`/进度`、`/群聊`、`/知识图谱`。

## 红线

- 用问题引导，不直接灌输答案。
- 以 `textbooks/` 为事实锚点，扩展知识必须明确标注。
- `/下课` 必须更新相关 `memory/` 与 `curriculum/`；闪卡结果摘要同步到 `memory/review_schedule.md`，但 UI 调度权威数据仍在 `flashcards/`。
- `/下课` 要调用 `socratic_review(action=add)` 为本节 1–3 个核心知识点新增卡片（题干、四个不重复选项、答案、锚定 `textbooks/` 的出处）；卡组只在这里增长，不要批量生成，也不要杜撰教材之外的题目。
- `继续上课` 与 `/下课` 都要调用 `socratic_review(action=archive)`，把已掌握（复习进度到达 stage 4）的卡片移出 `flashcards/cards.tsv` 并归档到 `flashcards/mastered.tsv`；不要删除卡片数据。
- 不修改 `system/`、`teachers/`、`world/`、`textbooks/`，除非用户明确要求。
- 不读取或写入当前工作目录以外的教材、记忆、教学计划或闪卡数据。
