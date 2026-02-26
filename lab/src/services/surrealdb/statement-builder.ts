import type {
  AstValue, AstCondition, ReturnClause, DataClause, OrderClause,
  StatementNode, SelectStatement, UpdateStatement, DeleteStatement,
  CreateStatement, InsertStatement, RelateStatement, UpsertStatement,
  RawStatement, TransactionStatement
} from "./ast";

function isSurrealIDLike(val: unknown): val is { _tag: 'SurrealID'; table: string; value: unknown } {
  return typeof val === 'object' && val !== null && (val as any)._tag === 'SurrealID';
}

export class QueryContext {
  private bindings: Record<string, any> = {};
  private paramCount = 0;

  public bind(value: any): string {
    this.paramCount++;
    const paramName = `p${this.paramCount}`;
    this.bindings[paramName] = value;
    return `$${paramName}`;
  }

  public getBindings(): Record<string, any> {
    return this.bindings;
  }
}

export abstract class BaseBuilder<T extends StatementNode> {
  constructor(protected ctx: QueryContext, protected ast: T) { }

  abstract build(): string;

  protected buildValue(val: AstValue): string {
    switch (val.type) {
      case "LITERAL":
        return this.ctx.bind(val.value);

      case "IDENTIFIER": {
        if (val.value.includes('.')) {
          return val.value
            .split('.')
            .map((part) => (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part) ? part : `\`${part}\``))
            .join('.');
        }
        const isStandard = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val.value);
        return isStandard ? val.value : `\`${val.value}\``;
      }

      case "ALIAS": {
        const isStandardAlias = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(val.alias);
        const escapedAlias = isStandardAlias ? val.alias : `\`${val.alias}\``;
        return `${this.buildValue(val.expr)} AS ${escapedAlias}`;
      }

      case "GRAPH_PATH":
        return val.path;

      case "PARAMETER":
        return `$${val.name}`;

      case "FUNCTION": {
        const args = val.args.map(a => this.buildValue(a)).join(", ");
        return `${val.name}(${args})`;
      }

      case "RECORD_ID": {
        const tb = this.ctx.bind(val.table);
        const id = this.ctx.bind(val.id);
        return `type::record(${tb}, ${id})`;
      }

      case "RAW_NODE":
        return val.strings.reduce((acc, str, i) => {
          let bound = "";
          if (i < val.values.length) {
            const v = val.values[i];
            if (isSurrealIDLike(v)) {
              const tb = this.ctx.bind(v.table);
              const id = this.ctx.bind(v.value);
              bound = `type::record(${tb}, ${id})`;
            } else {
              bound = this.ctx.bind(v);
            }
          }
          return acc + str + bound;
        }, "");

      case "SUBQUERY": {
        const builder = new SelectBuilder(this.ctx, val.stmt);
        return `(${builder.build()})`;
      }

      case "RAW":
        return val.sql;

      default: {
        const _exhaustiveCheck: never = val;
        throw new Error(`Unsupported ast value type: ${(val as any).type}`);
      }
    }
  }

  protected buildCondition(cond: AstCondition): string {
    switch (cond.type) {
      case "LOGICAL": {
        const ops = cond.operands.map(c => this.buildCondition(c));
        return `(${ops.join(` ${cond.operator} `)})`;
      }

      case "COMPARISON": {
        const left = this.buildValue(cond.left);
        const right = this.buildValue(cond.right);
        return `${left} ${cond.operator} ${right}`;
      }

      case "NULLISH":
        return `${this.buildValue(cond.left)} ?? ${this.buildValue(cond.right)}`;

      case "RAW_CONDITION":
        return cond.strings.reduce((acc, str, i) => {
          let bound = "";
          if (i < cond.values.length) {
            const v = cond.values[i];
            if (isSurrealIDLike(v)) {
              const tb = this.ctx.bind(v.table);
              const id = this.ctx.bind(v.value);
              bound = `type::record(${tb}, ${id})`;
            } else {
              bound = this.ctx.bind(v);
            }
          }
          return acc + str + bound;
        }, "");

      default: {
        const _exhaustiveCheck: never = cond;
        throw new Error(`Unsupported condition type: ${(cond as any).type}`);
      }
    }
  }

  protected buildData(data: DataClause): string {
    switch (data.type) {
      case "SET": {
        const entries = Object.entries(data.assignments);
        if (entries.length === 0) {
          throw new Error("SET clause requires at least one field assignment");
        }
        const assignments = entries
          .map(([k, v]) => `${k} = ${this.buildValue(v)}`)
          .join(", ");
        return `SET ${assignments}`;
      }
      case "UNSET":
        return `UNSET ${data.fields.join(", ")}`;

      case "MERGE":
        return `MERGE ${this.buildValue(data.content)}`;

      case "CONTENT":
        return `CONTENT ${this.buildValue(data.content)}`;

      case "PATCH":
        return `PATCH ${this.buildValue(data.patches)}`;
    }
  }

  protected buildReturn(ret: ReturnClause): string {
    if (ret.type === "KEYWORD") {
      return `RETURN ${ret.value}`;
    }
    const fields = ret.fields.map(f => this.buildValue(f)).join(", ");
    return `RETURN ${fields}`;
  }
}

export class RawBuilder extends BaseBuilder<RawStatement> {
  build(): string {
    if (this.ast.strings && this.ast.values) {
      return this.ast.strings.reduce((acc, str, i) => {
        let bound = "";
        if (i < this.ast.values!.length) {
          const val = this.ast.values![i];
          if (isSurrealIDLike(val)) {
            const tb = this.ctx.bind(val.table);
            const id = this.ctx.bind(val.value);
            bound = `type::thing(${tb}, ${id})`;
          } else {
            bound = this.ctx.bind(val);
          }
        }
        return acc + str + bound;
      }, "");
    }
    return this.ast.sql ?? "";
  }
}

// lab/src/services/surrealdb/statement-builder.ts
// [Update SelectBuilder.build() method:]

export class SelectBuilder extends BaseBuilder<SelectStatement> {
  private buildOrder(o: OrderClause): string {
    let str = `${this.buildValue(o.field)} ${o.direction}`;
    if (o.collate) str += " COLLATE";
    if (o.numeric) str += " NUMERIC";
    return str;
  }

  build(): string {
    const parts: string[] = [this.ast.live ? "LIVE SELECT" : "SELECT"];

    if (this.ast.diff) {
      parts.push("DIFF");
    } else if (this.ast.fields.length === 0) {
      parts.push("*");
    } else {
      parts.push(this.ast.fields.map(f => this.buildValue(f)).join(", "));
    }

    if (this.ast.omit && this.ast.omit.length > 0) {
      const escapedOmit = this.ast.omit.map((f) => {
        const isStandard = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(f);
        return isStandard ? f : `\`${f}\``;
      });
      parts.push(`OMIT ${escapedOmit.join(", ")}`);
    }

    parts.push("FROM");
    if (this.ast.only) parts.push("ONLY");
    parts.push(this.ast.targets.map(t => this.buildValue(t)).join(", "));

    if (this.ast.withIndex && this.ast.withIndex.length > 0) {
      parts.push(`WITH INDEX ${this.ast.withIndex.join(", ")}`);
    }

    if (this.ast.where) {
      parts.push(`WHERE ${this.buildCondition(this.ast.where)}`);
    }

    if (this.ast.splitAt?.length) parts.push(`SPLIT AT ${this.ast.splitAt.join(", ")}`);
    if (this.ast.groupBy?.length) parts.push(`GROUP BY ${this.ast.groupBy.join(", ")}`);

    if (this.ast.orderBy?.length) {
      const orderings = this.ast.orderBy.map(o => this.buildOrder(o)).join(", ");
      parts.push(`ORDER BY ${orderings}`);
    }

    if (this.ast.limit !== undefined) {
      const limitVal = typeof this.ast.limit === "number" ? this.ctx.bind(this.ast.limit) : this.buildValue(this.ast.limit);
      parts.push(`LIMIT ${limitVal}`);
    }
    if (this.ast.start !== undefined) {
      const startVal = typeof this.ast.start === "number" ? this.ctx.bind(this.ast.start) : this.buildValue(this.ast.start);
      parts.push(`START ${startVal}`);
    }

    if (this.ast.fetch?.length) parts.push(`FETCH ${this.ast.fetch.join(", ")}`);
    if (this.ast.timeout) parts.push(`TIMEOUT ${this.ast.timeout}`);
    if (this.ast.explain) {
      parts.push(this.ast.explain === "FULL" ? "EXPLAIN FULL" : "EXPLAIN");
    }

    return parts.join(" ");
  }
}

export class UpdateBuilder extends BaseBuilder<UpdateStatement> {
  build(): string {
    const parts: string[] = ["UPDATE"];

    if (this.ast.only) parts.push("ONLY");
    parts.push(this.ast.targets.map(t => this.buildValue(t)).join(", "));
    parts.push(this.buildData(this.ast.data));

    if (this.ast.where) parts.push(`WHERE ${this.buildCondition(this.ast.where)}`);
    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));
    if (this.ast.timeout) parts.push(`TIMEOUT ${this.ast.timeout}`);

    return parts.join(" ");
  }
}

export class UpsertBuilder extends BaseBuilder<UpsertStatement> {
  build(): string {
    const parts: string[] = ["UPSERT"];

    if (this.ast.only) parts.push("ONLY");
    parts.push(this.ast.targets.map(t => this.buildValue(t)).join(", "));
    parts.push(this.buildData(this.ast.data));

    if (this.ast.where) parts.push(`WHERE ${this.buildCondition(this.ast.where)}`);
    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));
    if (this.ast.timeout) parts.push(`TIMEOUT ${this.ast.timeout}`);

    return parts.join(" ");
  }
}

export class CreateBuilder extends BaseBuilder<CreateStatement> {
  build(): string {
    const parts: string[] = ["CREATE"];

    if (this.ast.only) parts.push("ONLY");
    parts.push(this.ast.targets.map(t => this.buildValue(t)).join(", "));

    if (this.ast.data) parts.push(this.buildData(this.ast.data));
    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));

    return parts.join(" ");
  }
}

export class DeleteBuilder extends BaseBuilder<DeleteStatement> {
  build(): string {
    const parts: string[] = ["DELETE"];

    if (this.ast.only) parts.push("ONLY");
    parts.push(this.ast.targets.map(t => this.buildValue(t)).join(", "));

    if (this.ast.where) parts.push(`WHERE ${this.buildCondition(this.ast.where)}`);
    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));
    if (this.ast.timeout) parts.push(`TIMEOUT ${this.ast.timeout}`);

    return parts.join(" ");
  }
}

export class InsertBuilder extends BaseBuilder<InsertStatement> {
  build(): string {
    const parts: string[] = ["INSERT"];

    if (this.ast.relation) parts.push("RELATION");
    if (this.ast.ignore) parts.push("IGNORE");

    parts.push("INTO");
    parts.push(this.buildValue(this.ast.target));

    const data = this.ast.data;
    if (Array.isArray(data)) {
      const items = data.map((d) => this.buildValue(d)).join(", ");
      parts.push(`[${items}]`);
    } else {
      parts.push(this.buildValue(data as AstValue));
    }

    if (this.ast.onDuplicate) {
      parts.push("ON DUPLICATE KEY UPDATE");
      const dataStr = this.buildData(this.ast.onDuplicate);
      parts.push(dataStr.startsWith("SET ") ? dataStr.slice(4) : dataStr);
    }

    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));

    return parts.join(" ");
  }
}

export class RelateBuilder extends BaseBuilder<RelateStatement> {
  build(): string {
    const parts: string[] = ["RELATE"];

    if (this.ast.only) parts.push("ONLY");

    const relationPath = `${this.buildValue(this.ast.from)}->${this.buildValue(this.ast.edge)}->${this.buildValue(this.ast.to)}`;
    parts.push(relationPath);

    if (this.ast.data) parts.push(this.buildData(this.ast.data));
    if (this.ast.return) parts.push(this.buildReturn(this.ast.return));

    return parts.join(" ");
  }
}

export class TransactionStatementBuilder extends BaseBuilder<TransactionStatement> {
  build(): string {
    const lines = ["BEGIN TRANSACTION"];
    for (const stmt of this.ast.statements) {
      const stmtSql = new StatementBuilder(this.ctx).type(stmt).build();
      lines.push(stmtSql.endsWith(";") ? stmtSql.slice(0, -1) : stmtSql);
    }
    lines.push("COMMIT TRANSACTION");
    return lines.join(";\n") + ";";
  }
}

export class StatementBuilder {
  constructor(private ctx: QueryContext = new QueryContext()) { }

  public type(ast: StatementNode): BaseBuilder<any> {
    switch (ast.type) {
      case "SELECT": return new SelectBuilder(this.ctx, ast);
      case "UPDATE": return new UpdateBuilder(this.ctx, ast);
      case "UPSERT": return new UpsertBuilder(this.ctx, ast);
      case "CREATE": return new CreateBuilder(this.ctx, ast);
      case "DELETE": return new DeleteBuilder(this.ctx, ast);
      case "INSERT": return new InsertBuilder(this.ctx, ast);
      case "RELATE": return new RelateBuilder(this.ctx, ast);
      case "RAW": return new RawBuilder(this.ctx, ast);
      case "TRANSACTION": return new TransactionStatementBuilder(this.ctx, ast);
      default: {
        const _exhaustiveCheck: never = ast;
        throw new Error(`Unsupported statement type`);
      }
    }
  }

  public compile(ast: StatementNode): { sql: string; bindings: Record<string, any> } {
    const builder = this.type(ast);
    let sql = builder.build();

    if (!sql.trim().endsWith(";")) {
      sql += ";";
    }

    return {
      sql,
      bindings: this.ctx.getBindings()
    };
  }

  public compileTree(statements: StatementNode[]): { sql: string; bindings: Record<string, any> } {
    const queries = statements.map(ast => this.type(ast).build());
    return {
      sql: queries.join(";\n") + ";",
      bindings: this.ctx.getBindings()
    };
  }
}
