import {copyFile, lstat, mkdir, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const TEMPLATE_ROOT = fileURLToPath(new URL('./templates/project/', import.meta.url));

async function inspect(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function ensureDirectory(path) {
  const stat = await inspect(path);
  if (stat) {
    if (stat.isSymbolicLink()) throw Error('拒绝通过符号链接初始化项目：' + path);
    if (!stat.isDirectory()) throw Error('项目模板需要目录，但发现了文件：' + path);
    return false;
  }
  await mkdir(path);
  return true;
}

export async function initializeProject(projectRoot) {
  const root = resolve(projectRoot);
  const created = [];
  const existing = [];
  await mkdir(root, {recursive: true});
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw Error('项目根目录必须是真实目录');

  async function copyTree(sourceDir, targetDir) {
    for (const entry of await readdir(sourceDir, {withFileTypes: true})) {
      const source = join(sourceDir, entry.name);
      const target = join(targetDir, entry.name);
      const display = relative(root, target);
      if (entry.isDirectory()) {
        if (await ensureDirectory(target)) created.push(display + '/');
        else existing.push(display + '/');
        await copyTree(source, target);
      } else if (entry.isFile()) {
        const stat = await inspect(target);
        if (stat) {
          if (stat.isSymbolicLink()) throw Error('拒绝覆盖符号链接：' + target);
          existing.push(display);
        } else {
          await copyFile(source, target, constants.COPYFILE_EXCL);
          created.push(display);
        }
      }
    }
  }

  await copyTree(TEMPLATE_ROOT, root);
  return {initialized: true, projectRoot: root, created, existing, changed: created.length > 0};
}
