import * as monaco from 'monaco-editor/editor/editor.api.js';
monaco.languages.register({ id: 'sml', extensions: ['.sml', '.sig', '.fun'] });
monaco.languages.setLanguageConfiguration('sml', {
  comments: { blockComment: ['(*', '*)'] }, brackets: [['(', ')'], ['[', ']'], ['{', '}']],
  autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '{', close: '}' }, { open: '"', close: '"', notIn: ['string', 'comment'] }],
});
monaco.languages.setMonarchTokensProvider('sml', {
  keywords: ['abstype', 'and', 'andalso', 'as', 'case', 'datatype', 'do', 'else', 'end', 'eqtype', 'exception', 'fn', 'fun', 'functor', 'handle', 'if', 'in', 'include', 'infix', 'infixr', 'let', 'local', 'nonfix', 'of', 'op', 'open', 'orelse', 'raise', 'rec', 'sharing', 'sig', 'signature', 'struct', 'structure', 'then', 'type', 'val', 'where', 'while', 'with', 'withtype'],
  tokenizer: {
    root: [[/\(\*/, 'comment', '@comment'], [/#?"/, 'string', '@string'], [/[a-zA-Z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }], [/~?(?:0w[xX][0-9a-fA-F]+|0w\d+|0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE]~?\d+)?)/, 'number'], [/\'[a-zA-Z][\w']*/, 'type.identifier'], [/[(){}\[\]]/, '@brackets'], [/[!%&$#+\-/:<=>?@\\~`^|*]+/, 'operator']],
    comment: [[/\(\*/, 'comment', '@push'], [/\*\)/, 'comment', '@pop'], [/./, 'comment']],
    string: [[/\\./, 'string.escape'], [/"/, 'string', '@pop'], [/./, 'string']],
  },
});
