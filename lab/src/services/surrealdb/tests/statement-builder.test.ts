// lab/src/services/surrealdb/tests/statement-builder.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

import type { StatementNode } from '../ast';
import { StatementBuilder } from '../statement-builder';

describe('StatementBuilder (SQL Compiler) Unit Tests', () => {
  let compiler: StatementBuilder;

  beforeEach(() => {
    compiler = new StatementBuilder();
  });

  it('compiles RECORD_IDs safely as type::record()', () => {
    const ast: StatementNode = {
      type: 'DELETE',
      targets: [{ type: 'RECORD_ID', table: 'person', id: 'jaime:lannister' }],
    };

    const result = compiler.compile(ast);
    expect(result.sql).toBe('DELETE type::record($p1, $p2);');
    expect(result.bindings.p1).toBe('person');
    expect(result.bindings.p2).toBe('jaime:lannister');
  });

  it('safely parameterizes complex WHERE logic with parentheses', () => {
    const ast: StatementNode = {
      type: 'SELECT',
      fields: [],
      targets: [{ type: 'IDENTIFIER', value: 'user' }],
      where: {
        type: 'LOGICAL',
        operator: 'OR',
        operands: [
          {
            type: 'COMPARISON',
            left: { type: 'IDENTIFIER', value: 'a' },
            operator: '=',
            right: { type: 'LITERAL', value: 1 },
          },
          {
            type: 'LOGICAL',
            operator: 'AND',
            operands: [
              {
                type: 'COMPARISON',
                left: { type: 'IDENTIFIER', value: 'b' },
                operator: '>',
                right: { type: 'LITERAL', value: 2 },
              },
              {
                type: 'NULLISH',
                left: { type: 'IDENTIFIER', value: 'c' },
                right: { type: 'LITERAL', value: 3 },
              },
            ],
          },
        ],
      },
    };

    const result = compiler.compile(ast);
    expect(result.sql).toBe('SELECT * FROM user WHERE (a = $p1 OR (b > $p2 AND c ?? $p3));');
    expect(result.bindings).toEqual({ p1: 1, p2: 2, p3: 3 });
  });

  it('escapes identifiers with backticks if needed', () => {
    const ast: StatementNode = {
      type: 'SELECT',
      fields: [{ type: 'IDENTIFIER', value: 'my-field' }],
      targets: [{ type: 'IDENTIFIER', value: '123_table' }],
    };
    const { sql } = compiler.compile(ast);
    expect(sql).toBe('SELECT `my-field` FROM `123_table`;');
  });

  it('compiles ALIAS and GRAPH_PATH correctly without backticks', () => {
    const ast: StatementNode = {
      type: 'SELECT',
      fields: [
        { type: 'IDENTIFIER', value: 'name' },
        {
          type: 'ALIAS',
          expr: { type: 'IDENTIFIER', value: 'email' },
          alias: 'contact',
        },
        { type: 'GRAPH_PATH', path: '->wrote->post.*' },
      ],
      targets: [{ type: 'IDENTIFIER', value: 'user' }],
    };
    const { sql } = compiler.compile(ast);
    expect(sql).toBe('SELECT name, email AS contact, ->wrote->post.* FROM user;');
  });

  it('compiles full modifiers for SELECT statements', () => {
    const ast: StatementNode = {
      type: 'SELECT',
      only: true,
      fields: [{ type: 'IDENTIFIER', value: 'name' }],
      omit: ['password'],
      targets: [{ type: 'IDENTIFIER', value: 'user' }],
      withIndex: ['idx_email'],
      splitAt: ['emails'],
      groupBy: ['role'],
      orderBy: [
        {
          field: { type: 'IDENTIFIER', value: 'age' },
          direction: 'DESC',
          numeric: true,
          collate: true,
        },
      ],
      limit: 10,
      start: 5,
      fetch: ['profile'],
      timeout: '2s',
      explain: 'FULL',
    };

    const result = compiler.compile(ast);
    expect(result.sql).toBe(
      'SELECT name OMIT password FROM ONLY user WITH INDEX idx_email SPLIT AT emails GROUP BY role ORDER BY age DESC COLLATE NUMERIC LIMIT $p1 START $p2 FETCH profile TIMEOUT 2s EXPLAIN FULL;',
    );
    expect(result.bindings.p1).toBe(10);
    expect(result.bindings.p2).toBe(5);
  });
});
