// In lab/src/services/surrealdb/ast-builder.ts
import type { StatementNode, TransactionStatement } from "./ast";

// lab/src/services/surrealdb/ast-builder.ts
import type {
  AstValue, AstCondition, ReturnClause, DataClause, OrderClause,
  SelectStatement, UpdateStatement, DeleteStatement,
  CreateStatement, InsertStatement, RelateStatement, UpsertStatement, SurrealOperator
} from "./ast";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export const val = {
  literal: (value: unknown): AstValue => ({ type: "LITERAL", value }),
  ident: (value: string): AstValue => ({ type: "IDENTIFIER", value }),
  param: (name: string): AstValue => ({ type: "PARAMETER", name: name.replace(/^\$/, "") }),
  func: (name: string, args: readonly AstValue[] = []): AstValue => ({ type: "FUNCTION", name, args }),
  id: (table: string, id: string | number | readonly unknown[] | object): AstValue => ({ type: "RECORD_ID", table, id }),
  raw: (sql: string): AstValue => ({ type: "RAW", sql }),
  rawNode: (strings: readonly string[], values: readonly unknown[]): AstValue => ({ type: "RAW_NODE", strings, values }),
  alias: (expr: AstValue, alias: string): AstValue => ({ type: "ALIAS", expr, alias }),
  graphPath: (path: string): AstValue => ({ type: "GRAPH_PATH", path }),
};

export const cond = {
  compare: (left: AstValue, operator: SurrealOperator, right: AstValue): AstCondition => ({ type: "COMPARISON", left, operator, right }),
  and: (...operands: readonly AstCondition[]): AstCondition => ({ type: "LOGICAL", operator: "AND", operands }),
  or: (...operands: readonly AstCondition[]): AstCondition => ({ type: "LOGICAL", operator: "OR", operands }),
  nullish: (left: AstValue, right: AstValue): AstCondition => ({ type: "NULLISH", left, right }),
  eq: (left: AstValue, right: AstValue) => cond.compare(left, "=", right),
  rawNode: (strings: readonly string[], values: readonly unknown[]): AstCondition => ({ type: "RAW_CONDITION", strings, values }),
};

export const data = {
  set: (assignments: Record<string, AstValue>): DataClause => ({ type: "SET", assignments }),
  unset: (fields: readonly string[]): DataClause => ({ type: "UNSET", fields }),
  merge: (content: AstValue): DataClause => ({ type: "MERGE", content }),
  content: (content: AstValue): DataClause => ({ type: "CONTENT", content }),
  patch: (patches: AstValue): DataClause => ({ type: "PATCH", patches }),
};

export const ret = {
  none: (): ReturnClause => ({ type: "KEYWORD", value: "NONE" }),
  before: (): ReturnClause => ({ type: "KEYWORD", value: "BEFORE" }),
  after: (): ReturnClause => ({ type: "KEYWORD", value: "AFTER" }),
  diff: (): ReturnClause => ({ type: "KEYWORD", value: "DIFF" }),
  fields: (fields: readonly AstValue[]): ReturnClause => ({ type: "PROJECTION", fields }),
};

export class SelectAstBuilder {
  private stmt: Partial<Mutable<SelectStatement>> = { type: "SELECT", fields: [], targets: [] };

  live(isLive = true) { this.stmt.live = isLive; return this; }
  diff(isDiff = true) { this.stmt.diff = isDiff; return this; }

  // [Keep all other existing methods: fields, omit, from, only, where, etc.]
  fields(fields: readonly AstValue[]) { this.stmt.fields = fields; return this; }
  omit(fields: readonly string[]) { this.stmt.omit = fields; return this; }
  from(targets: readonly AstValue[]) { this.stmt.targets = targets; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  withIndex(indexes: readonly string[]) { this.stmt.withIndex = indexes; return this; }
  where(condition: AstCondition) { this.stmt.where = condition; return this; }
  splitAt(fields: readonly string[]) { this.stmt.splitAt = fields; return this; }
  groupBy(fields: readonly string[]) { this.stmt.groupBy = fields; return this; }
  orderBy(orders: readonly OrderClause[]) { this.stmt.orderBy = orders; return this; }
  limit(limit: number | AstValue) { this.stmt.limit = limit; return this; }
  start(start: number | AstValue) { this.stmt.start = start; return this; }
  fetch(fields: readonly string[]) { this.stmt.fetch = fields; return this; }
  timeout(duration: string) { this.stmt.timeout = duration; return this; }
  explain(mode: boolean | "FULL" = true) { this.stmt.explain = mode; return this; }
  build(): SelectStatement {
    if (!this.stmt.targets || this.stmt.targets.length === 0) throw new Error("Select statement requires target");
    return this.stmt as SelectStatement;
  }
}

export class UpdateAstBuilder {
  private stmt: Partial<Mutable<UpdateStatement>> = { type: "UPDATE", targets: [] };
  targets(targets: readonly AstValue[]) { this.stmt.targets = targets; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  data(clause: DataClause) { this.stmt.data = clause; return this; }
  where(condition: AstCondition) { this.stmt.where = condition; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  timeout(duration: string) { this.stmt.timeout = duration; return this; }
  build(): UpdateStatement {
    if (!this.stmt.targets?.length || !this.stmt.data) throw new Error("Update requires target and data");
    return this.stmt as UpdateStatement;
  }
}

export class UpsertAstBuilder {
  private stmt: Partial<Mutable<UpsertStatement>> = { type: "UPSERT", targets: [] };
  targets(targets: readonly AstValue[]) { this.stmt.targets = targets; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  data(clause: DataClause) { this.stmt.data = clause; return this; }
  where(condition: AstCondition) { this.stmt.where = condition; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  timeout(duration: string) { this.stmt.timeout = duration; return this; }
  build(): UpsertStatement {
    if (!this.stmt.targets?.length || !this.stmt.data) throw new Error("Upsert requires target and data");
    return this.stmt as UpsertStatement;
  }
}

export class CreateAstBuilder {
  private stmt: Partial<Mutable<CreateStatement>> = { type: "CREATE", targets: [] };
  targets(targets: readonly AstValue[]) { this.stmt.targets = targets; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  data(clause: DataClause) { this.stmt.data = clause; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  build(): CreateStatement {
    if (!this.stmt.targets?.length) throw new Error("Create missing targets");
    return this.stmt as CreateStatement;
  }
}

export class DeleteAstBuilder {
  private stmt: Partial<Mutable<DeleteStatement>> = { type: "DELETE", targets: [] };
  targets(targets: readonly AstValue[]) { this.stmt.targets = targets; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  where(condition: AstCondition) { this.stmt.where = condition; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  timeout(duration: string) { this.stmt.timeout = duration; return this; }
  build(): DeleteStatement {
    if (!this.stmt.targets?.length) throw new Error("Delete missing targets");
    return this.stmt as DeleteStatement;
  }
}

export class InsertAstBuilder {
  private stmt: Partial<Mutable<InsertStatement>> = { type: "INSERT" };
  into(target: AstValue) { this.stmt.target = target; return this; }
  data(payload: AstValue | readonly AstValue[]) { this.stmt.data = payload; return this; }
  relation(isRel = true) { this.stmt.relation = isRel; return this; }
  ignore(isIgnore = true) { this.stmt.ignore = isIgnore; return this; }
  onDuplicate(clause: DataClause) { this.stmt.onDuplicate = clause; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  build(): InsertStatement {
    if (!this.stmt.target || !this.stmt.data) throw new Error("Insert missing target or data");
    return this.stmt as InsertStatement;
  }
}

export class RelateAstBuilder {
  private stmt: Partial<Mutable<RelateStatement>> = { type: "RELATE" };
  from(from: AstValue) { this.stmt.from = from; return this; }
  edge(edge: AstValue) { this.stmt.edge = edge; return this; }
  to(to: AstValue) { this.stmt.to = to; return this; }
  only(isOnly = true) { this.stmt.only = isOnly; return this; }
  data(clause: DataClause) { this.stmt.data = clause; return this; }
  returns(clause: ReturnClause) { this.stmt.return = clause; return this; }
  build(): RelateStatement {
    if (!this.stmt.from || !this.stmt.edge || !this.stmt.to) throw new Error("Relate requires from, edge, and to nodes");
    return this.stmt as RelateStatement;
  }
}

export class TransactionAstBuilder {
  private stmt: Partial<Mutable<TransactionStatement>> = { type: "TRANSACTION", statements: [] };
  statements(statements: readonly StatementNode[]) { this.stmt.statements = statements; return this; }
  build(): TransactionStatement {
    return {
      type: "TRANSACTION",
      statements: this.stmt.statements ?? [],
    };
  }
}

export const Ast = {
  val, cond, data, ret,
  stmt: {
    select: () => new SelectAstBuilder(),
    update: () => new UpdateAstBuilder(),
    upsert: () => new UpsertAstBuilder(),
    create: () => new CreateAstBuilder(),
    delete: () => new DeleteAstBuilder(),
    insert: () => new InsertAstBuilder(),
    relate: () => new RelateAstBuilder(),
    transaction: () => new TransactionAstBuilder(),
  }
};
