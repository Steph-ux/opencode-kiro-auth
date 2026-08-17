import type { CodeWhispererMessage } from '../../plugin/types.js';
export declare function sanitizeHistory(history: CodeWhispererMessage[]): CodeWhispererMessage[];
export declare function findOriginalToolCall(msgs: any[], toolUseId: string): any | null;
export declare function mergeAdjacentMessages(msgs: any[]): any[];
export declare function getContentText(m: any): string;
