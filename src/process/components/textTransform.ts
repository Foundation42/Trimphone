import { MemoryProcess } from "../memoryProcess";

export type TextTransform = (input: string) => string | Promise<string>;

const newlineRegex = /\r?\n$/;

function ensureTrailingNewline(value: string): string {
  if (value === "") {
    return value;
  }
  return newlineRegex.test(value) ? value : `${value}\n`;
}

export class TextTransformProcess extends MemoryProcess {
  constructor(transform: TextTransform) {
    super(async (input) => {
      const result = await transform(input);
      return ensureTrailingNewline(result);
    });
  }
}
