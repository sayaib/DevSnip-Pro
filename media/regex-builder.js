// Regex Builder & Tester script
(function init() {
  const testBtn = document.getElementById('testBtn');
  const clearBtn = document.getElementById('clearBtn');
  if (testBtn) testBtn.addEventListener('click', testRegex);
  if (clearBtn) clearBtn.addEventListener('click', clearAll);
})();

function sanitizeFlags(raw) {
  return (raw || '').toLowerCase().replace(/[^gimsuy]/g, '');
}

function testRegex() {
  const pattern = document.getElementById('pattern').value || '';
  const flags = sanitizeFlags(document.getElementById('flags').value || 'g');
  const testString = document.getElementById('testString').value || '';
  const output = document.getElementById('output');

  if (!pattern) {
    output.innerHTML = '<div style="color: var(--vscode-errorForeground);">Enter a pattern</div>';
    return;
  }

  // Guard extremely long inputs to avoid freezing
  if (testString.length > 500000) {
    output.innerHTML = '<div style="color: var(--vscode-errorForeground);">Test string too large (limit 500k)</div>';
    return;
  }

  try {
    const regex = new RegExp(pattern, flags || 'g');
    const matches = [];
    for (const m of testString.matchAll(regex)) {
      matches.push(m);
      // Safety: break after too many matches
      if (matches.length > 5000) break;
    }

    if (matches.length === 0) {
      output.innerHTML = '<h3>No matches found</h3>';
      return;
    }

    const html = [];
    html.push('<h3>Matches (' + matches.length + ')</h3>');
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const groups = m.groups ? Object.entries(m.groups) : [];
      html.push('<div style="margin:6px 0;">');
      html.push('<strong>Match ' + (i + 1) + ':</strong> "' + escapeHtml(m[0]) + '" at ' + m.index);
      if (m.length > 1 || groups.length > 0) {
        html.push('<div style="margin-left:10px;">');
        // Indexed groups
        for (let gi = 1; gi < m.length; gi++) {
          html.push('<div>Group ' + gi + ': ' + (m[gi] !== undefined ? '"' + escapeHtml(String(m[gi])) + '"' : 'undefined') + '</div>');
        }
        // Named groups
        for (const [name, val] of groups) {
          html.push('<div>Group ' + escapeHtml(name) + ': ' + (val !== undefined ? '"' + escapeHtml(String(val)) + '"' : 'undefined') + '</div>');
        }
        html.push('</div>');
      }
      html.push('</div>');
    }

    output.innerHTML = html.join('');
  } catch (e) {
    output.innerHTML = '<h3>Error:</h3><div style="color: var(--vscode-errorForeground);">' + escapeHtml(e.message) + '</div>';
  }
}

function clearAll() {
  document.getElementById('pattern').value = '';
  document.getElementById('flags').value = 'g';
  document.getElementById('testString').value = '';
  document.getElementById('output').innerHTML = '';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

