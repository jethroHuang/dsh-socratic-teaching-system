# 项目闪卡

`cards.tsv` 是当前教材项目的 11 列 Anki TSV 卡组。DSH 会在本目录创建 `dsh-state.<sessionId>.json` 保存会话复习状态。

`mastered.tsv` 是已掌握归档：一张卡在**所有会话**的复习进度中到达最高档（stage 4，30 天间隔）后，会在继续上课或下课时被移出 `cards.tsv`、写入本文件，不再出现在日常复习里。

归档文件前 11 列与 `cards.tsv` 完全相同，另加 `MasteredAt`（归档时间）与 `MasteredStage`（归档时的掌握等级）。要恢复某张卡，把它的前 11 列合并回 `cards.tsv` 即可；也可以在复习面板的「Anki 管理」中一键恢复全部已掌握卡片。