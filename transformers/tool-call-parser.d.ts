import type { ToolCall } from '../../plugin/types.js';
export declare function parseBracketToolCalls(text: string): ToolCall[];
export declare function deduplicateToolCalls(toolCalls: ToolCall[]): ToolCall[];
export declare function cleanToolCallsFromText(text: string, toolCalls: ToolCall[]): string;
