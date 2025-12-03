function log(message) {
  const el = document.getElementById('log');
  if (el) {
    const time = new Date().toLocaleTimeString();
    el.textContent += '[' + time + '] ' + message + '\n';
    el.scrollTop = el.scrollHeight;
  }
  try { console.log('[JSON→TOON]', message); } catch {}
}

(function initBindings() {
  const convertBtn = document.getElementById('convertBtn');
  const copyBtn = document.getElementById('copyBtn');
  const clearBtn = document.getElementById('clearBtn');
  if (convertBtn) convertBtn.addEventListener('click', convertToToon);
  if (copyBtn) copyBtn.addEventListener('click', copyOutput);
  if (clearBtn) clearBtn.addEventListener('click', clearAll);
  log('UI initialized');
})();

function convertToToon() {
  const input = document.getElementById('input').value;
  const output = document.getElementById('output');
  output.value = 'Converting...';
  try {
    const json = safeParseJson(input);
    log('Parsed JSON successfully');
    output.value = toToon(json);
    log('Converted to TOON. Length: ' + (output.value.length));
  } catch (e) {
    output.value = '❌ Invalid JSON: ' + e.message;
    log('Conversion error: ' + e.message);
  }
}

function toToon(value) {
  if (Array.isArray(value)) {
    return renderArray(value, 0, 'items');
  }
  if (value && typeof value === 'object') {
    return renderTopLevelObject(value);
  }
  return formatPrimitive(value);
}

function formatPrimitive(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  return String(v);
}

function renderTopLevelObject(obj) {
  const lines = [];
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}: items[${val.length}]:`);
        lines.push(renderArrayItems(val, 1));
      }
    } else if (val && typeof val === 'object') {
      lines.push(`${key}:`);
      lines.push(renderNestedObject(val, 1));
    } else {
      lines.push(`${key}: ${formatPrimitive(val)}`);
    }
  }
  return lines.join('\n');
}

function renderArray(arr, indent, label) {
  const pad = '  '.repeat(indent);
  const lines = [];
  lines.push(`${label}[${arr.length}]:`);
  lines.push(renderArrayItems(arr, indent + 1));
  return pad + lines.join('\n');
}

function renderArrayItems(arr, indent) {
  const lines = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      lines.push(renderNestedObject(item, indent, true));
    } else {
      const pad = '  '.repeat(indent);
      lines.push(`${pad}- ${formatPrimitive(item)}`);
    }
  }
  return lines.join('\n');
}

function renderNestedObject(obj, indent, bulletFirst = false) {
  const pad = '  '.repeat(indent);
  const lines = [];
  const entries = Object.entries(obj);
  for (let i = 0; i < entries.length; i++) {
    const [k, v] = entries[i];
    const prefix = bulletFirst && i === 0 ? `${pad}- ` : pad;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${prefix}${k}:`);
      lines.push(renderNestedObject(v, indent + 1));
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${prefix}${k}: []`);
      } else {
        lines.push(`${prefix}${k}: items[${v.length}]:`);
        lines.push(renderArrayItems(v, indent + 1));
      }
    } else {
      lines.push(`${prefix}${k}: ${formatPrimitive(v)}`);
    }
  }
  return lines.join('\n');
}

function copyOutput() {
  const output = document.getElementById('output');
  const text = output.value || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => log('Output copied')).catch(() => { fallbackCopy(text); log('Output copied (fallback)'); });
  } else {
    fallbackCopy(text);
    log('Output copied (fallback)');
  }
}

function fallbackCopy(text) {
  const tmp = document.createElement('textarea');
  tmp.style.position = 'fixed';
  tmp.style.opacity = '0';
  tmp.value = text;
  document.body.appendChild(tmp);
  tmp.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(tmp);
}

function safeParseJson(content) {
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch (e) {
    const fixed = content
      .replace(/\r\n|\r|\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/'([^']*)'/g, '"$1"')
      .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/}\s*{/g, '},{')
      .replace(/]\s*\[/g, '],[');
    const reparsed = JSON.parse(fixed);
    log('Input was not strict JSON; applied fixes');
    return reparsed;
  }
}

function clearAll() {
  const inputEl = document.getElementById('input');
  const outputEl = document.getElementById('output');
  const logEl = document.getElementById('log');
  if (inputEl) inputEl.value = '';
  if (outputEl) outputEl.value = '';
  if (logEl) logEl.textContent = '';
  log('Cleared');
}

window.addEventListener('error', (ev) => {
  const output = document.getElementById('output');
  if (output) { output.value = '❌ Error: ' + (ev.error && ev.error.message ? ev.error.message : ev.message); }
  log('Global error: ' + (ev.error && ev.error.message ? ev.error.message : ev.message));
});
