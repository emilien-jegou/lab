import { describe, it, expect } from 'vitest';

import { executionSchema } from '../../../../core/system/tracker';
import { StatementBuilder } from '../../statement-builder';
import { createMockEngine } from '../test-utils';

describe('Execution Tracking Queries Integration', () => {
  it('compiles valid CREATE statement targeting system_executions table', () => {
    const db = executionSchema.connect(createMockEngine());
    const query = db.doc('system_executions').create({
      id: 'exec-1',
      moduleId: 'example',
      triggerType: 'webhook',
      triggerName: 'Demo Webhook',
      status: 'running',
      startTime: 1000,
      meta: {},
      payload: {},
    });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());
    expect(sql).toBe(
      'CREATE system_executions SET id = $p1, moduleId = $p2, triggerType = $p3, triggerName = $p4, status = $p5, startTime = $p6, meta = $p7, payload = $p8;',
    );
    expect(bindings.p1).toBe('exec-1');
    expect(bindings.p5).toBe('running');
  });

  it('compiles valid UPDATE statement for execution complete', () => {
    const db = executionSchema.connect(createMockEngine());
    const query = db
      .doc('system_executions')
      .update()
      .merge({ status: 'completed', endTime: 2000 })
      .where({ id: 'exec-1' });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());
    expect(sql).toBe(
      'UPDATE system_executions MERGE $p1 WHERE id = $p2 RETURN AFTER;',
    );
    expect(bindings.p1).toEqual({ status: 'completed', endTime: 2000 });
    expect(bindings.p2).toBe('exec-1');
  });

  it('compiles valid UPDATE statement for execution fail', () => {
    const db = executionSchema.connect(createMockEngine());
    const query = db
      .doc('system_executions')
      .update()
      .merge({ status: 'failed', endTime: 2000, error: 'Query failed' })
      .where({ id: 'exec-1' });

    const { sql, bindings } = new StatementBuilder().compile(query.getAst());
    expect(sql).toBe(
      'UPDATE system_executions MERGE $p1 WHERE id = $p2 RETURN AFTER;',
    );
    expect(bindings.p1).toEqual({
      status: 'failed',
      endTime: 2000,
      error: 'Query failed',
    });
    expect(bindings.p2).toBe('exec-1');
  });
});
