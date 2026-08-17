import type { CodeWhispererMessage } from '../../plugin/types.js';
/**
 * Collapse agentic loop sequences in the built history.
 *
 * Each agentic iteration gets a fresh conversationId, so the model re-derives its preamble
 * (intent detection, greeting) every iteration. When replayed for the next user turn, the
 * model sees duplicate preambles and gets confused.
 *
 * Strips text from intermediate ASST(toolUses)→USER(toolResults) pairs, keeping only the
 * first assistant text and all tool_use/tool_result pairs.
 */
export declare function collapseAgenticLoops(history: CodeWhispererMessage[]): CodeWhispererMessage[];
export declare function buildHistory(msgs: any[], resolved: string): CodeWhispererMessage[];
export declare function injectSystemPrompt(history: CodeWhispererMessage[], system: string | undefined, resolved: string): CodeWhispererMessage[];
export declare function historyHasToolCalling(history: CodeWhispererMessage[]): boolean;
export declare function extractToolNamesFromHistory(history: CodeWhispererMessage[]): Set<string>;
