interface ParsedEvent {
    type: string;
    data: any;
}
export declare function parseAwsEventStreamBuffer(buffer: string): ParsedEvent[];
export declare function parseEventLine(line: string): any | null;
export {};
