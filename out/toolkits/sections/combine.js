"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.combineTools = void 0;
function combineTools(o) {
    const seen = new Map();
    for (const m of o.modes)
        for (const f of m.tool.fields)
            seen.set(f.id, (seen.get(f.id) ?? 0) + 1);
    const prefixOf = (mode) => mode.replace(/[^A-Za-z0-9]/g, "");
    /** Original id → combined id, per mode. */
    const maps = new Map();
    for (const m of o.modes) {
        const map = new Map();
        for (const f of m.tool.fields)
            map.set(f.id, (seen.get(f.id) ?? 0) > 1 || f.id === "mode" ? `${prefixOf(m.value)}_${f.id}` : f.id);
        maps.set(m.value, map);
    }
    const forward = (mode, values) => {
        const map = maps.get(mode);
        return Object.fromEntries(Object.entries(values).filter(([k]) => map.has(k)).map(([k, v]) => [map.get(k), v]));
    };
    const back = (mode, values) => {
        const map = maps.get(mode);
        const reverse = new Map([...map].map(([a, b]) => [b, a]));
        return Object.fromEntries(Object.entries(values).filter(([k]) => reverse.has(k)).map(([k, v]) => [reverse.get(k), v]));
    };
    const fields = [{ id: "mode", label: o.modeLabel, kind: "select", options: o.modes.map(m => ({ value: m.value, label: m.label })), default: o.modes[0].value, width: "wide" }];
    for (const m of o.modes) {
        const map = maps.get(m.value);
        for (const f of m.tool.fields) {
            fields.push({
                ...f,
                id: map.get(f.id),
                showIf: f.showIf ? { ...f.showIf, field: map.get(f.showIf.field) ?? f.showIf.field } : { field: "mode", equals: [m.value] }
            });
        }
    }
    const modeOf = (values) => o.modes.find(m => m.value === String(values.mode ?? "")) ?? o.modes[0];
    const examples = o.modes.flatMap(m => (m.tool.examples ?? []).map(e => ({ label: e.label, values: { mode: m.value, ...forward(m.value, e.values) } })));
    const aliases = o.modes.flatMap(m => [
        ...(m.aliasCommand ? [{ command: m.aliasCommand, values: { mode: m.value } }] : []),
        ...(m.tool.aliases ?? []).map(a => ({ command: a.command, values: { mode: m.value, ...forward(m.value, a.values) } }))
    ]);
    const actions = o.modes.flatMap(m => m.tool.actions ?? []);
    const keywords = [...new Set([...(o.keywords ?? []), ...o.modes.flatMap(m => m.tool.keywords ?? [])])];
    return {
        id: o.id,
        command: o.command,
        title: o.title,
        summary: o.summary,
        guide: o.guide ?? (o.modes.map(m => m.tool.guide).filter(Boolean).join("\n\n") || undefined),
        keywords,
        icon: o.icon,
        fields,
        examples,
        ...(aliases.length ? { aliases } : {}),
        ...(actions.length ? { actions } : {}),
        network: o.modes.some(m => m.tool.network),
        live: o.modes.some(m => m.tool.live) && !o.modes.some(m => m.tool.network),
        runLabel: o.modes[0].tool.runLabel,
        async dynamicExamples(ctx) {
            const lists = await Promise.all(o.modes.map(async (m) => (m.tool.dynamicExamples ? await m.tool.dynamicExamples(ctx) : []).map(e => ({ label: e.label, values: { mode: m.value, ...forward(m.value, e.values) } }))));
            return lists.flat();
        },
        async run(values, ctx, action) {
            const mode = modeOf(values);
            const result = await mode.tool.run(back(mode.value, values), ctx, action);
            return result.setValues ? { ...result, setValues: forward(mode.value, result.setValues) } : result;
        }
    };
}
exports.combineTools = combineTools;
//# sourceMappingURL=combine.js.map