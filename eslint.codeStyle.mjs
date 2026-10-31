// The repository's code style as lint rules, shared by both modules so neither drifts (see AGENTS.md).

const loops = ['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']
const branchesAndLoops = `:matches(IfStatement, SwitchStatement, ${loops.join(', ')})`
const iterationCallbacks =
  'CallExpression[callee.property.name=/^(forEach|map|flatMap|filter|reduce|reduceRight|some|every|find|findIndex|findLast|findLastIndex|from)$/] > :matches(ArrowFunctionExpression, FunctionExpression)'
const loopBody = 'A loop body must not branch or loop: pre-filter the input or extract the work into a named function.'
const privateFunction =
  'Export module functions: a file-private helper is untestable and often a sign that the responsibility belongs elsewhere.'

/** Short names that hide intent; coordinates (x, y, z) stay allowed. */
const abbreviations = [
  ...[
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
    'j',
    'k',
    'l',
    'm',
    'n',
    'o',
    'p',
    'q',
    'r',
    's',
    't',
    'u',
    'v',
    'w',
  ],
  ...['acc', 'arg', 'arr', 'attr', 'btn', 'buf', 'calc', 'cb', 'cfg', 'conf', 'ctx', 'cur', 'curr', 'dest', 'dir'],
  ...['dst', 'dt', 'el', 'elem', 'err', 'ev', 'evt', 'fn', 'idx', 'img', 'len', 'msg', 'num', 'obj', 'opts', 'pos'],
  ...['prev', 'pt', 'pts', 'req', 'res', 'src', 'str', 'tmp', 'temp', 'val', 'vec'],
]

const privateFunctions = [
  { selector: 'Program > FunctionDeclaration', message: privateFunction },
  {
    selector:
      'Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)',
    message: privateFunction,
  },
]

const structure = [
  {
    selector: 'IfStatement[alternate]',
    message: 'Use guard clauses or a named decision function instead of else/else-if branches.',
  },
  { selector: `:matches(${loops.join(', ')}) ${branchesAndLoops}`, message: loopBody },
  { selector: `${iterationCallbacks} ${branchesAndLoops}`, message: loopBody },
]

export const codeStyleRules = {
  // A function body is the first level, so a loop or branch may not hold another one.
  'max-depth': ['error', 1],
  'no-restricted-syntax': ['error', ...structure, ...privateFunctions],
  'id-denylist': ['error', ...abbreviations],
}

/** Tests keep their own small helpers private; nothing imports them. */
export const testCodeStyleRules = {
  'no-restricted-syntax': ['error', ...structure],
}
