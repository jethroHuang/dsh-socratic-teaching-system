#!/usr/bin/env node
import {resolve} from 'node:path';
import {initializeProject} from './project.js';

const target = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const result = await initializeProject(target);
console.log(result.changed ? '已补全苏格拉底教学项目：' + target : '项目已经初始化，无需修改：' + target);
console.log('新建 ' + result.created.length + ' 项，保留现有 ' + result.existing.length + ' 项；没有覆盖任何已有教材或记忆。');
console.log('下一步：把一本教材放入 textbooks/，然后用 dsh-苏格拉底教学系统预设创建会话。');
