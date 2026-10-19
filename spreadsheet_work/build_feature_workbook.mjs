import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = 'C:/Users/Administrator/Desktop/MM06-2/outputs';
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('项目特色功能');
sheet.showGridLines = false;
sheet.tabColor = '#1F4E78';

const font = 'Aptos';
const navy = '#16324F';
const blue = '#2563EB';
const purple = '#7C3AED';
const ink = '#1F2937';
const muted = '#64748B';
const line = '#D8E0EA';
const paleBlue = '#F4F8FF';
const palePurple = '#FAF7FF';

sheet.mergeCells('A1:F1');
sheet.getRange('A1').values = [['项目特色功能介绍']];
sheet.getRange('A1:F1').format = {
  font: { name: font, size: 18, bold: true, color: navy },
  horizontalAlignment: 'left',
  verticalAlignment: 'center',
};
sheet.getRange('A1:F1').format.rowHeight = 34;

sheet.mergeCells('A2:F2');
sheet.getRange('A2').values = [['设计台与材质编辑器的核心功能、使用价值和可展示效果（依据当前项目实现整理）']];
sheet.getRange('A2:F2').format = {
  font: { name: font, size: 10, color: muted, italic: true },
  verticalAlignment: 'center',
};
sheet.getRange('A2:F2').format.rowHeight = 22;

sheet.getRange('A4:F4').values = [['模块', '图标', '特色功能', '功能说明', '展示效果 / 关键点', '适用场景']];
sheet.getRange('A4:F4').format = {
  fill: navy,
  font: { name: font, size: 10, bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'all', style: 'thin', color: '#FFFFFF' },
};
sheet.getRange('A4:F4').format.rowHeight = 28;

const rows = [
  ['设计台', '', '展台模式', '切换到展台视图，支持自动旋转、全屏展示与展台比例设置。', '突出模型整体陈列效果，可配合默认视角与展台比例统一展示构图。', '客户演示、线上展厅、方案汇报'],
  ['设计台', '', '标尺模式', '点击标尺模式后，先生成三段标尺；标尺生成完成后，再显示模型具体的长、宽、高数字尺寸。', '在模型视图叠加长宽高标尺，并在生成完成后显示具体数字，帮助快速确认模型实际尺寸。', '尺寸核对、报价沟通、生产对接'],
  ['设计台', '', '标记模式', '点击模型表面添加标记，并维护标记属性与说明。', '标记跟随模型保存，便于记录问题、设计意图和评审结论。', '设计评审、工艺沟通、问题追踪'],
  ['设计台', '', 'AI绘画', '基于提示词生成面料与效果参考图，快速验证创意方向。', '辅助探索纹理、配色与风格方案，缩短从想法到视觉草案的时间。', '概念提案、灵感探索、风格确认'],
  ['设计台', '', '光影流转', '模拟日光变化与光影流转，观察模型在不同光照下的表现。', '日光参数与时间推进联动，材质层次和空间氛围更直观。', '展厅演示、效果评估、空间氛围展示'],
  ['材质编辑器', '', '批处理齐色', '按色号批量导入同一面料的多种颜色，并自动加入上传队列。', '自动识别色号文件，减少重复上传和逐个配置的操作。', '大批量面料录入、色卡整理'],
  ['材质编辑器', '', '色号球', '用色号球快速识别、切换和预览不同配色。', '每个色号对应独立纹理与材质数据，支持默认色号和卡片内切换。', '配色管理、选样沟通、资产检索'],
  ['材质编辑器', '', '绒毛侧面光', '调节绒毛面料的侧面光强度与柔和度。', '通过 sheen 相关参数表现绒毛、起绒面料的侧向高光与柔和质感。', '绒毛面料调试、材质效果确认'],
];
sheet.getRange('A5:F12').values = rows;
sheet.getRange('A5:F12').format = {
  font: { name: font, size: 10, color: ink },
  verticalAlignment: 'center',
  wrapText: true,
  borders: {
    insideHorizontal: { style: 'thin', color: line },
    bottom: { style: 'thin', color: line },
  },
};
sheet.getRange('A5:A9').format = { fill: paleBlue, font: { name: font, size: 10, bold: true, color: blue }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
sheet.getRange('A10:A12').format = { fill: palePurple, font: { name: font, size: 10, bold: true, color: purple }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
sheet.getRange('C5:C12').format.font = { name: font, size: 10, bold: true, color: navy };
sheet.getRange('D5:F12').format.verticalAlignment = 'top';
sheet.getRange('B5:B12').format = { horizontalAlignment: 'center', verticalAlignment: 'center' };
sheet.getRange('A5:F12').format.rowHeight = 62;

// Keep the grouped module labels visually continuous without merging distinct table columns.
sheet.getRange('A5:A9').format.borders = { preset: 'outside', style: 'thin', color: '#C7D7EE' };
sheet.getRange('A10:A12').format.borders = { preset: 'outside', style: 'thin', color: '#DDD0F5' };

sheet.mergeCells('A14:F14');
sheet.getRange('A14').values = [['说明：图标用于快速识别功能模块，正文可直接用于项目收尾测试、演示或产品介绍材料。']];
sheet.getRange('A14:F14').format = {
  font: { name: font, size: 9, color: muted, italic: true },
  fill: '#F8FAFC',
  verticalAlignment: 'center',
  wrapText: true,
  borders: { top: { style: 'thin', color: line } },
};
sheet.getRange('A14:F14').format.rowHeight = 25;

sheet.getRange('A1:F14').format.font.name = font;
sheet.getRange('A1:A14').format.columnWidth = 14;
sheet.getRange('B1:B14').format.columnWidth = 10;
sheet.getRange('C1:C14').format.columnWidth = 18;
sheet.getRange('D1:D14').format.columnWidth = 32;
sheet.getRange('E1:E14').format.columnWidth = 34;
sheet.getRange('F1:F14').format.columnWidth = 25;
sheet.freezePanes.freezeRows(4);

function iconSvg(kind, color) {
  const bg = '#FFFFFF';
  const common = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"`;
  const stroke = `fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  let body = '';
  if (kind === 'showroom') body = `<path ${stroke} d="M12 50V20l20-8 20 8v30M12 50h40M21 50v-9h22v9M32 12v10M22 29l10-4 10 4v11l-10 5-10-5z"/>`;
  if (kind === 'ruler') body = `<path ${stroke} d="M16 48L48 16M23 41l-5-5M30 34l-5-5M37 27l-5-5M44 20l-5-5M13 52h38"/><path ${stroke} d="M13 52V45M51 52V45"/>`;
  if (kind === 'marker') body = `<path ${stroke} d="M20 46l4-16 22-15 8 9-22 15zM24 30l9 9M18 49l9-2"/><path ${stroke} d="M40 12v-4M50 20l4-2"/>`;
  if (kind === 'ai') body = `<path ${stroke} d="M32 10l4 11 11 4-11 4-4 11-4-11-11-4 11-4zM49 38l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>`;
  if (kind === 'light') body = `<path ${stroke} d="M32 10v9M17 17l6 6M10 32h9M17 47l6-6M47 17l-6 6M54 32h-9M47 47l-6-6"/><circle ${stroke} cx="32" cy="32" r="10"/><path ${stroke} d="M32 42v8M27 54h10"/>`;
  if (kind === 'batch') body = `<path ${stroke} d="M19 18h26v31H19zM26 13h18v5M24 26h16M24 33h13M24 40h10M49 31l4 4 8-9"/>`;
  if (kind === 'swatch') body = `<circle cx="32" cy="32" r="18" fill="#E8B2A3" stroke="${color}" stroke-width="3"/><path d="M19 28c8-8 18-8 26 0" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/><path d="M22 38c7 5 13 5 20 0" fill="none" stroke="#7C3AED" stroke-width="3" stroke-linecap="round"/>`;
  if (kind === 'sheen') body = `<path ${stroke} d="M18 48c8-15 20-24 34-30-4 13-5 25-2 35M22 43c9-2 17 0 24 6M28 33c6 1 11 3 16 7"/><path ${stroke} d="M13 24l5-5M10 34h7"/>`;
  return `<svg ${common}><rect x="2" y="2" width="60" height="60" rx="16" fill="${bg}"/><circle cx="32" cy="32" r="29" fill="${color}" opacity="0.08"/>${body}</svg>`;
}

const iconKinds = ['showroom', 'ruler', 'marker', 'ai', 'light', 'batch', 'swatch', 'sheen'];
const iconColors = [blue, blue, blue, blue, blue, purple, purple, purple];
for (let i = 0; i < iconKinds.length; i += 1) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(iconSvg(iconKinds[i], iconColors[i])).toString('base64')}`;
  sheet.images.add({
    dataUrl,
    anchor: { from: { row: i + 4, col: 1 }, extent: { widthPx: 48, heightPx: 48 } },
  });
}

workbook.recalculate();
const inspect = await workbook.inspect({ kind: 'table', range: '项目特色功能!A1:F14', include: 'values,formulas', tableMaxRows: 20, tableMaxCols: 8, tableMaxCellChars: 120 });
console.log(inspect.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const preview = await workbook.render({ sheetName: '项目特色功能', range: 'A1:F14', scale: 1.25, format: 'png' });
await fs.writeFile(`${outputDir}/_preview.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(`${outputDir}/项目特色功能介绍_更新.xlsx`);
console.log(`saved ${outputDir}/项目特色功能介绍_更新.xlsx`);
