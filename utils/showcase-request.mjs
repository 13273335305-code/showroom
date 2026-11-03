// Local PowerShell server bridge. Credentials stay in the inherited server environment.
import { createShowcaseHandler } from '../api/showcase.js';
try {
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; if (length > 65536) throw new Error('Invalid input'); chunks.push(chunk); }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const res = { statusCode: 200, setHeader() {}, end(body) { process.stdout.write(JSON.stringify({ status: this.statusCode, body: JSON.parse(body) })); } };
  await createShowcaseHandler()({ method: input.method, headers: input.headers, body: input.body }, res);
} catch { process.stdout.write(JSON.stringify({ status: 503, body: { error: { message: '本地分享服务暂不可用，请重试' } } })); }
