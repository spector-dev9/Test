const ALIASES = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  node: "javascript",
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  py: "python",
  python: "python",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  fish: "bash",
  console: "bash",
  terminal: "bash",
  json: "json",
  jsonc: "json",
  json5: "json",
  css: "css",
  scss: "css",
  less: "css",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  svelte: "markup",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  sqlite: "sql",
  diff: "diff",
  patch: "diff",
  md: "markdown",
  markdown: "markdown",
  c: "clike",
  h: "clike",
  cpp: "clike",
  "c++": "clike",
  cc: "clike",
  hpp: "clike",
  csharp: "clike",
  cs: "clike",
  java: "clike",
  kt: "clike",
  kotlin: "clike",
  go: "clike",
  rust: "clike",
  rs: "clike",
  php: "clike",
  swift: "clike",
};

function keywordPattern(words) {
  return new RegExp(`\\b(?:${words.join("|")})\\b`, "y");
}

const JS_KEYWORDS = [
  "abstract", "as", "async", "await", "break", "case", "catch", "class",
  "const", "constructor", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "instanceof", "interface",
  "let", "new", "of", "private", "protected", "public", "readonly",
  "return", "satisfies", "set", "static", "super", "switch", "this",
  "throw", "try", "type", "typeof", "var", "void", "while", "with",
  "yield", "namespace", "declare", "keyof", "infer",
];

const JS_LITERALS = keywordPattern([
  "true", "false", "null", "undefined", "NaN", "Infinity",
]);

const PYTHON_KEYWORDS = [
  "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass",
  "raise", "return", "try", "while", "with", "yield", "match", "case",
];

const BASH_KEYWORDS = [
  "alias", "bg", "break", "case", "cd", "command", "continue", "declare",
  "do", "done", "echo", "elif", "else", "env", "esac", "eval", "exec",
  "exit", "export", "false", "fc", "fg", "fi", "for", "function", "getopts",
  "hash", "help", "history", "if", "in", "jobs", "kill", "let", "local",
  "logout", "mapfile", "popd", "printf", "pushd", "pwd", "read", "readonly",
  "return", "select", "set", "shift", "shopt", "source", "test", "then",
  "time", "times", "trap", "true", "type", "typeset", "ulimit", "umask",
  "unalias", "unset", "until", "wait", "while",
];

const CLIKE_KEYWORDS = [
  "abstract", "as", "async", "await", "break", "case", "catch", "class",
  "const", "continue", "default", "defer", "delete", "do", "else", "enum",
  "export", "extends", "extern", "finally", "fn", "for", "foreach",
  "function", "goto", "if", "implements", "import", "in", "interface",
  "internal", "is", "let", "match", "module", "namespace", "new", "nil",
  "operator", "out", "override", "package", "params", "private", "protected",
  "public", "readonly", "record", "ref", "return", "sealed", "sizeof",
  "static", "struct", "switch", "template", "this", "throw", "throws",
  "trait", "try", "type", "typeof", "unsafe", "using", "var", "virtual",
  "void", "while", "with", "yield",
];

const SQL_KEYWORDS = [
  "add", "all", "alter", "and", "any", "as", "asc", "between", "by", "case",
  "cast", "check", "constraint", "create", "cross", "database", "default",
  "delete", "desc", "distinct", "drop", "else", "end", "exists", "false",
  "fetch", "foreign", "from", "full", "group", "having", "if", "in",
  "index", "inner", "insert", "intersect", "into", "is", "join", "key",
  "left", "like", "limit", "not", "null", "offset", "on", "or", "order",
  "outer", "primary", "references", "returning", "right", "row", "select",
  "set", "table", "then", "true", "union", "unique", "update", "using",
  "values", "view", "when", "where", "with",
];

const GRAMMARS = {
  javascript: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/y],
    ["number", /\b0[bB][01_]+\b|\b0[oO][0-7_]+\b|\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?\b/y],
    ["keyword", keywordPattern(JS_KEYWORDS)],
    ["literal", JS_LITERALS],
    ["function", /\b[A-Za-z_$][\w$]*(?=\s*\()/y],
  ],
  typescript: null,
  python: [
    ["comment", /#[^\n]*/y],
    ["string", /"""[\s\S]*?"""|'''[\s\S]*?'''|[rbfuRBFU]{0,2}"(?:\\[\s\S]|[^"\\\n])*"|[rbfuRBFU]{0,2}'(?:\\[\s\S]|[^'\\\n])*'/y],
    ["number", /\b0[bB][01_]+\b|\b0[oO][0-7_]+\b|\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ["keyword", keywordPattern(PYTHON_KEYWORDS)],
    ["literal", keywordPattern(["True", "False", "None", "self", "cls"])],
    ["function", /\b[A-Za-z_]\w*(?=\s*\()/y],
  ],
  bash: [
    ["comment", /#[^\n]*/y],
    ["string", /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/y],
    ["variable", /\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[@*#?$!0-9-]/y],
    ["keyword", keywordPattern(BASH_KEYWORDS)],
    ["function", /\b[A-Za-z_]\w*(?=\s*\()/y],
    ["number", /\b\d+(?:\.\d+)?\b/y],
  ],
  json: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\[\s\S]|[^"\\])*"/y],
    ["number", /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
    ["literal", keywordPattern(["true", "false", "null"])],
  ],
  css: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/y],
    ["meta", /@[\w-]+/y],
    ["variable", /--[\w-]+/y],
    ["number", /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|fr|deg|ch|ex)?\b/y],
    ["keyword", keywordPattern(["!important", "from", "to"])],
    ["function", /\b[\w-]+(?=\s*\()/y],
  ],
  markup: [
    ["comment", /<!--[\s\S]*?-->/y],
    ["tag", /<\/?[A-Za-z][\w:.-]*|\/?>/y],
    ["string", /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y],
    ["attr", /\b[A-Za-z_][\w:.-]*(?==)/y],
    ["literal", keywordPattern(["true", "false"])],
  ],
  yaml: [
    ["comment", /#[^\n]*/y],
    ["string", /"(?:\\[\s\S]|[^"\\])*"|'[^']*'/y],
    ["number", /\b\d+(?:\.\d+)?\b/y],
    ["literal", keywordPattern(["true", "false", "null", "yes", "no", "on", "off"])],
    ["attr", /[\w.-]+(?=:\s)/y],
    ["meta", /^[ \t]*- /my],
  ],
  sql: [
    ["comment", /--[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /'(?:''|[^'])*'|"(?:[^"])*"/y],
    ["number", /\b\d+(?:\.\d+)?\b/y],
    ["keyword", keywordPattern(SQL_KEYWORDS)],
    ["function", /\b[A-Za-z_]\w*(?=\s*\()/y],
  ],
  markdown: [
    ["comment", /^\s{0,3}#{1,6}[^\n]*/my],
    ["string", /`[^`\n]+`|\*\*[^*\n]+\*\*/y],
    ["meta", /^\s*[-*+] |^\s*\d+[.)] /my],
  ],
  clike: [
    ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/y],
    ["number", /\b0[xX][0-9a-fA-F_]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFuUlL]*\b/y],
    ["keyword", keywordPattern(CLIKE_KEYWORDS)],
    ["literal", keywordPattern(["true", "false", "nullptr", "NULL", "None"])],
    ["function", /\b[A-Za-z_]\w*(?=\s*\()/y],
  ],
  generic: [
    ["comment", /\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//y],
    ["string", /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'/y],
    ["number", /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y],
  ],
};

GRAMMARS.typescript = GRAMMARS.javascript;

export function normalizeLanguage(language) {
  if (typeof language !== "string") return null;
  const key = language.trim().toLowerCase().split(/[\s,]+/)[0];
  if (!key) return null;
  return ALIASES[key] ?? null;
}

function highlightDiff(code) {
  const tokens = [];

  code.split("\n").forEach((line, index, all) => {
    const text = index === all.length - 1 ? line : `${line}\n`;

    if (line.startsWith("+++") || line.startsWith("---")) {
      tokens.push({ type: "meta", text });
    } else if (line.startsWith("@@")) {
      tokens.push({ type: "meta", text });
    } else if (line.startsWith("+")) {
      tokens.push({ type: "added", text });
    } else if (line.startsWith("-")) {
      tokens.push({ type: "removed", text });
    } else {
      tokens.push({ type: "plain", text });
    }
  });

  return tokens;
}

export function highlightCode(code, language) {
  if (typeof code !== "string" || !code) return [];

  const normalized = normalizeLanguage(language);

  if (normalized === "diff") return highlightDiff(code);

  const grammar = GRAMMARS[normalized] ?? GRAMMARS.generic;
  const tokens = [];
  let i = 0;
  let plainStart = 0;

  const flushPlain = (end) => {
    if (end > plainStart) {
      tokens.push({ type: "plain", text: code.slice(plainStart, end) });
    }
  };

  while (i < code.length) {
    let matchedLength = 0;
    let matchedType = null;

    for (const [type, pattern] of grammar) {
      pattern.lastIndex = i;
      const match = pattern.exec(code);
      if (match && match[0].length > 0) {
        matchedType = type;
        matchedLength = match[0].length;
        break;
      }
    }

    if (matchedType) {
      flushPlain(i);
      tokens.push({ type: matchedType, text: code.slice(i, i + matchedLength) });
      i += matchedLength;
      plainStart = i;
    } else {
      i += 1;
    }
  }

  flushPlain(code.length);

  return tokens;
}

export function tokensToText(tokens) {
  return tokens.map((token) => token.text).join("");
}
