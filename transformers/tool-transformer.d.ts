import type { ToolNameMap } from '../../plugin/types.js';
export declare const CODEWHISPERER_TOOL_NAME_MAX_LENGTH = 64;
export declare const CODEWHISPERER_DESCRIPTION_MAX_LENGTH = 1024;
export declare const CODEWHISPERER_SCHEMA_MAX_DEPTH = 32;
type JsonObject = Record<string, any>;
export interface ToolNameRegistry {
    toWire(originalName: string): string;
    toOriginalMap(): ToolNameMap;
}
/**
 * Builds a request-scoped registry. Keeping this state off global/SDK-client caches prevents
 * concurrent requests from restoring an alias with another request's tool namespace.
 */
export declare function createToolNameRegistry(tools?: unknown): ToolNameRegistry;
export declare function restoreToolName(name: string, toolNameMap?: ToolNameMap): string;
/**
 * Reduces modern JSON Schema to CodeWhisperer's conservative supported subset. Local references
 * and common composites are flattened before unsupported keywords are discarded.
 */
export declare function sanitizeCodeWhispererSchema(schema: unknown): JsonObject;
export declare function convertToolsToCodeWhisperer(tools: unknown, registry?: ToolNameRegistry): any[];
export declare function deduplicateToolResults(toolResults: any[]): any[];
export {};
