export function parseBracketToolCalls(text) {
    const toolCalls = [];
    const pattern = /\[Called\s+(\w+)\s+with\s+args:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})\]/gs;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const funcName = match[1];
        const argsStr = match[2];
        if (!funcName || !argsStr)
            continue;
        try {
            const args = JSON.parse(argsStr);
            toolCalls.push({
                toolUseId: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: funcName,
                input: args
            });
        }
        catch (e) {
            continue;
        }
    }
    return toolCalls;
}
export function deduplicateToolCalls(toolCalls) {
    const seen = new Set();
    const unique = [];
    for (const tc of toolCalls) {
        if (!seen.has(tc.toolUseId)) {
            seen.add(tc.toolUseId);
            unique.push(tc);
        }
    }
    return unique;
}
export function cleanToolCallsFromText(text, toolCalls) {
    let cleaned = text;
    for (const tc of toolCalls) {
        const funcName = tc.name;
        const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\[Called\\s+${escapedName}\\s+with\\s+args:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}\\]`, 'gs');
        cleaned = cleaned.replace(pattern, '');
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
}
