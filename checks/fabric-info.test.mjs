import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricInfoFromFilename } from '../shared/fabric-info.js';

test('fabric filenames separate the leading fabric number from its color code', () => {
  assert.deepEqual(fabricInfoFromFilename('390WBR_Diffuse.jpg'), { name: '390', fabricColorCode: 'WBR' });
  assert.deepEqual(fabricInfoFromFilename('389DBW.jpg'), { name: '389', fabricColorCode: 'DBW' });
  assert.deepEqual(fabricInfoFromFilename('00389dbw_Diffuse.JPG'), { name: '00389', fabricColorCode: 'dbw' });
  assert.deepEqual(fabricInfoFromFilename('389_Diffuse.jpg'), { name: '389', fabricColorCode: '' });
  assert.deepEqual(fabricInfoFromFilename('编织面料.png'), { name: '编织面料', fabricColorCode: '' });
  assert.deepEqual(fabricInfoFromFilename(), { name: '', fabricColorCode: '' });
});
