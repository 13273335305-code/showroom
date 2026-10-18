import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_AI_PROMPT_DEFAULTS, createCaptureAiPromptStore } from '../shared/capture-ai-prompts.js';

test('missing prompt table explains the repair and the same edits can be saved after initialization', async () => {
  let ready = false, draft;
  const store = createCaptureAiPromptStore({ access: async () => ({ userId: 'admin', client: {
    from() { return {
      select() { return this; }, eq() { return this; }, upsert(value) { draft = value.prompts; return this; },
      async maybeSingle() { return ready ? { data: { prompts: draft } } : { error: { code: 'PGRST205' } }; },
      async single() { return ready ? { data: { prompts: draft } } : { error: { code: 'PGRST205' } }; },
    }; },
  } }) });
  assert.deepEqual(await store.load(), CAPTURE_AI_PROMPT_DEFAULTS);
  const edits = [{ label: '意式轻奢', prompt: '为此床垫生成一张意式轻奢场景图，不包含任何文案。' }];
  await assert.rejects(store.save('admin', edits), /最新版 supabase\/system-config-admin\.sql.*当前编辑内容会保留/);
  assert.equal(edits[0].label, '意式轻奢');
  ready = true;
  assert.deepEqual(await store.save('admin', edits), edits);
  assert.deepEqual(await store.load(), edits);
});
