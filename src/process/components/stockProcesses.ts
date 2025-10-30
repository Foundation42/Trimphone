import { TextTransformProcess } from "./textTransform";

export class EchoProcess extends TextTransformProcess {
  constructor() {
    super((input) => input);
  }
}

export class UppercaseProcess extends TextTransformProcess {
  constructor() {
    super((input) => input.toUpperCase());
  }
}

export class PrefixProcess extends TextTransformProcess {
  constructor(prefix: string) {
    super((input) => `${prefix}${input}`);
  }
}

export class SuffixProcess extends TextTransformProcess {
  constructor(suffix: string) {
    super((input) => `${input}${suffix}`);
  }
}
