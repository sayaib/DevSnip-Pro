(function() {
    const inputEl = document.getElementById('input');
    const outputEl = document.getElementById('output');
    if (!inputEl || !outputEl) return;

    function setOutput(message) {
        if (!outputEl) return;
        outputEl.value = String(message ?? '');
    }

    function getInput() {
        return inputEl && 'value' in inputEl ? inputEl.value || '' : '';
    }

    function formatJson() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            const parsed = JSON.parse(text);
            setOutput(JSON.stringify(parsed, null, 2));
        } catch (e) {
            setOutput('❌ JSON error: ' + (e && e.message ? e.message : e));
        }
    }

    function minifyJson() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            const parsed = JSON.parse(text);
            setOutput(JSON.stringify(parsed));
        } catch (e) {
            setOutput('❌ JSON error: ' + (e && e.message ? e.message : e));
        }
    }

    function validateJson() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            JSON.parse(text);
            setOutput('✅ Valid JSON');
        } catch (e) {
            setOutput('❌ Invalid JSON: ' + (e && e.message ? e.message : e));
        }
    }

    function parseXmlStrict(text) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'application/xml');
        const err = xmlDoc.getElementsByTagName('parsererror')[0];
        if (err) throw new Error(err.textContent || 'Invalid XML');
        return xmlDoc;
    }

    function formatXml() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            const doc = parseXmlStrict(text);
            const serializer = new XMLSerializer();
            const compact = serializer.serializeToString(doc).replace(/>\s+</g, '><');
            const lines = compact.replace(/></g, '>\n<').split('\n');
            let indent = 0;
            const out = [];
            for (const line of lines) {
                const isClosing = /^<\//.test(line);
                const isSelfClosing = /\/>$/.test(line);
                const isOpening = /^<[^!?][^>]*[^\/]>$/.test(line);
                if (isClosing) indent = Math.max(indent - 1, 0);
                out.push('  '.repeat(indent) + line);
                if (isOpening && !isSelfClosing) indent++;
            }
            setOutput(out.join('\n'));
        } catch (e) {
            setOutput('❌ XML error: ' + (e && e.message ? e.message : e));
        }
    }

    function minifyXml() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            const doc = parseXmlStrict(text);
            const serializer = new XMLSerializer();
            const raw = serializer.serializeToString(doc);
            setOutput(raw.replace(/>\s+</g, '><').trim());
        } catch (e) {
            setOutput('❌ XML error: ' + (e && e.message ? e.message : e));
        }
    }

    function validateXml() {
        const text = getInput();
        if (!text.trim()) { setOutput(''); return; }
        try {
            parseXmlStrict(text);
            setOutput('✅ Valid XML');
        } catch (e) {
            setOutput('❌ Invalid XML: ' + (e && e.message ? e.message : e));
        }
    }

    function clearAll() {
        inputEl.value = '';
        setOutput('');
    }

    document.getElementById('formatJsonBtn')?.addEventListener('click', formatJson);
    document.getElementById('minifyJsonBtn')?.addEventListener('click', minifyJson);
    document.getElementById('validateJsonBtn')?.addEventListener('click', validateJson);
    document.getElementById('formatXmlBtn')?.addEventListener('click', formatXml);
    document.getElementById('minifyXmlBtn')?.addEventListener('click', minifyXml);
    document.getElementById('validateXmlBtn')?.addEventListener('click', validateXml);
    document.getElementById('clearBtn')?.addEventListener('click', clearAll);
    function copyOutput() {
        const val = outputEl && 'value' in outputEl ? outputEl.value || '' : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(val);
        } else {
            const tmp = document.createElement('textarea');
            tmp.style.position = 'fixed';
            tmp.style.opacity = '0';
            tmp.value = val;
            document.body.appendChild(tmp);
            tmp.select();
            try { document.execCommand('copy'); } catch {}
            document.body.removeChild(tmp);
        }
    }
    document.getElementById('copyBtn')?.addEventListener('click', copyOutput);
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
    window.addEventListener('message', (event) => {
        const msg = event && event.data ? event.data : {};
        if (msg && msg.command === 'prefill' && typeof msg.text === 'string') {
            inputEl.value = msg.text;
        }
    });
})();

