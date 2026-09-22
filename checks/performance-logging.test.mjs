import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeveloperLogger, HEADERS } from '../shared/developer-logging.js';

test('performance log records drag phases and timing columns', async () => {
  let tick = 0;
  const downloads = [];
  const logger = createDeveloperLogger({ now: () => new Date(++tick * 1000), download: (...args) => downloads.push(args) });
  logger.start({ fps: 60 });
  logger.record('拖拽开始：测试面料', { durationMs: 1.2 });
  logger.record('拖拽移动：测试面料', { pickMs: 4.8 });
  logger.record('拖拽松手：测试面料', { durationMs: 320.5, pickMs: 5.1 });
  assert.deepEqual(logger.records().slice(1).map(record => record.operation), ['拖拽开始：测试面料', '拖拽移动：测试面料', '拖拽松手：测试面料']);
  assert.equal(logger.records().at(-1).durationMs, 320.5);
  assert.equal(logger.records().at(-1).pickMs, 5.1);
  logger.export();
  const csv = await downloads[0][0].text();
  assert.match(csv, /操作耗时 \(ms\),命中检测耗时 \(ms\)/);
  assert.match(csv, /拖拽松手：测试面料/);
  assert.deepEqual(HEADERS.slice(-2), ['操作耗时 (ms)', '命中检测耗时 (ms)']);
});
