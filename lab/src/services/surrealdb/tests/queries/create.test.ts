import { Schema } from 'effect';
import { describe, it, expect } from 'vitest';

import { document } from '../../api';
import { dbschema } from '../../api-builder';
import type { CreateStatement } from '../../ast';
import { mockEngine, useAstCapture } from '../test-utils';

const LogDoc = document('log', Schema.Any);
const db = dbschema(LogDoc).connect(mockEngine);

describe('CREATE Query Builder', () => {
  const { capture } = useAstCapture();

  it('handles single records and keywords', () => {
    const ast = capture<CreateStatement>(
      db.doc('log').create({ event: 'login' }).returns('NONE'),
    );
    expect(ast.type).toBe('CREATE');
    expect(ast.targets).toEqual([{ type: 'IDENTIFIER', value: 'log' }]);
    expect(ast.data).toEqual({
      type: 'SET',
      assignments: { event: { type: 'LITERAL', value: 'login' } },
    });
    expect(ast.return).toEqual({ type: 'KEYWORD', value: 'NONE' });
  });

  it('handles array bulk creation', () => {
    const ast = capture<CreateStatement>(
      db.doc('log').create([{ event: 'login' }, { event: 'logout' }]),
    );
    expect(ast.type).toBe('CREATE');
    expect(ast.targets).toEqual([{ type: 'IDENTIFIER', value: 'log' }]);
    expect(ast.data?.type).toEqual('CONTENT');
  });
});
