// 原子写：先写同目录临时文件，再 rename 覆盖目标。
// 目的：流水线被超时 SIGKILL 时，最多丢一个 .tmp，不会留下截断的 digest/proposals/latest.*。
import fs from 'node:fs';
import path from 'node:path';

export function writeFileAtomic(file, data, encoding = 'utf8') {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(tmp, data, encoding);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}
