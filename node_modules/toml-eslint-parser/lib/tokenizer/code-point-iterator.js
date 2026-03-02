"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodePointIterator = void 0;
class CodePointIterator {
    /**
     * Initialize this char iterator.
     */
    constructor(text) {
        this.lastCodePoint = 0 /* CodePoint.NULL */;
        this.start = {
            offset: -1,
            line: 1,
            column: -1,
        };
        this.end = {
            offset: 0,
            line: 1,
            column: 0,
        };
        this.text = text;
    }
    next() {
        if (this.lastCodePoint === -1 /* CodePoint.EOF */) {
            return -1 /* CodePoint.EOF */;
        }
        return (this.lastCodePoint = this.moveAt(this.end));
    }
    eat(cp) {
        if (this.text.codePointAt(this.end.offset) === cp) {
            this.next();
            return true;
        }
        return false;
    }
    moveAt(pos) {
        var _a;
        this.start.offset = this.end.offset = pos.offset;
        this.start.line = this.end.line = pos.line;
        this.start.column = this.end.column = pos.column;
        const cp = (_a = this.text.codePointAt(this.start.offset)) !== null && _a !== void 0 ? _a : -1 /* CodePoint.EOF */;
        if (cp === -1 /* CodePoint.EOF */) {
            this.end = this.start;
            return cp;
        }
        const shift = cp >= 0x10000 ? 2 : 1;
        this.end.offset += shift;
        if (cp === 10 /* CodePoint.LINE_FEED */) {
            this.end.line += 1;
            this.end.column = 0;
        }
        else if (cp === 13 /* CodePoint.CARRIAGE_RETURN */) {
            if (this.text.codePointAt(this.end.offset) === 10 /* CodePoint.LINE_FEED */) {
                this.end.offset++;
                this.end.line += 1;
                this.end.column = 0;
            }
            return 10 /* CodePoint.LINE_FEED */;
        }
        else {
            this.end.column += shift;
        }
        return cp;
    }
}
exports.CodePointIterator = CodePointIterator;
