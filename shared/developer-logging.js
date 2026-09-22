const HEADERS = ['时间', '用户操作', '帧率 (FPS)', '内存占用率 (%)', 'CPU占用率 (%)', 'GPU占用率 (%)', '页面网速 (Kbps)'];

function valueOrEmpty(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : '';
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function createDeveloperLogger({ now = () => new Date(), download }) {
  let recording = false;
  let records = [];
  let lastSampleAt = 0;

  function add(operation, metrics = {}) {
    if (!recording) return null;
    const record = {
      time: now().toISOString(),
      operation,
      fps: valueOrEmpty(metrics.fps, 1),
      memoryPercent: valueOrEmpty(metrics.memoryPercent),
      cpuPercent: valueOrEmpty(metrics.cpuPercent),
      gpuPercent: valueOrEmpty(metrics.gpuPercent),
      networkKbps: valueOrEmpty(metrics.networkKbps, 1)
    };
    records.push(record);
    return record;
  }

  return {
    start(metrics) {
      records = [];
      recording = true;
      lastSampleAt = 0;
      add('开始记录', metrics);
    },
    stop(metrics) {
      add('停止记录', metrics);
      recording = false;
    },
    isRecording() { return recording; },
    sample(metrics) {
      if (!recording) return false;
      const timestamp = Date.now();
      if (timestamp - lastSampleAt < 1000) return false;
      lastSampleAt = timestamp;
      add('状态采样', metrics);
      return true;
    },
    record(operation, metrics) { return add(operation, metrics); },
    count() { return records.length; },
    records() { return records.map(record => ({ ...record })); },
    export() {
      if (!records.length || typeof download !== 'function') return false;
      const rows = [HEADERS, ...records.map(record => [
        record.time, record.operation, record.fps, record.memoryPercent,
        record.cpuPercent, record.gpuPercent, record.networkKbps
      ])];
      const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
      download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'Spenic-操作日志-' + new Date().toISOString().slice(0, 10) + '.csv');
      return true;
    }
  };
}

export { HEADERS };
