type Position = {
    offset: number;
    line: number;
    column: number;
};
export declare class CodePointIterator {
    readonly text: string;
    private lastCodePoint;
    start: Position;
    end: Position;
    /**
     * Initialize this char iterator.
     */
    constructor(text: string);
    next(): number;
    eat(cp: number): boolean;
    moveAt(pos: Position): number;
}
export {};
