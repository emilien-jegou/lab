export type AstNode = AstValue | AstCondition | StatementNode;

export type AstValue =
  | { readonly type: "LITERAL"; readonly value: unknown }
  | { readonly type: "IDENTIFIER"; readonly value: string }
  | { readonly type: "PARAMETER"; readonly name: string }
  | { readonly type: "FUNCTION"; readonly name: string; readonly args: readonly AstValue[] }
  | { readonly type: "RECORD_ID"; readonly table: string; readonly id: string | number | readonly unknown[] | object }
  | { readonly type: "RAW_NODE"; readonly strings: readonly string[]; readonly values: readonly unknown[] }
  | { readonly type: "SUBQUERY"; readonly stmt: SelectStatement }
  | { readonly type: "RAW"; readonly sql: string }
  | { readonly type: "ALIAS"; readonly expr: AstValue; readonly alias: string }
  | { readonly type: "GRAPH_PATH"; readonly path: string };

export type ReturnClause = 
  | { readonly type: "KEYWORD"; readonly value: "NONE" | "BEFORE" | "AFTER" | "DIFF" }
  | { readonly type: "PROJECTION"; readonly fields: readonly AstValue[] };

export type DataClause =
  | { readonly type: "SET"; readonly assignments: Record<string, AstValue> }
  | { readonly type: "UNSET"; readonly fields: readonly string[] }
  | { readonly type: "MERGE"; readonly content: AstValue }
  | { readonly type: "CONTENT"; readonly content: AstValue }
  | { readonly type: "PATCH"; readonly patches: AstValue };

export type AstCondition =
  | { readonly type: "LOGICAL"; readonly operator: "AND" | "OR"; readonly operands: readonly AstCondition[] }
  | { readonly type: "COMPARISON"; readonly left: AstValue; readonly operator: SurrealOperator; readonly right: AstValue }
  | { readonly type: "NULLISH"; readonly left: AstValue; readonly right: AstValue }
  | { readonly type: "RAW_CONDITION"; readonly strings: readonly string[]; readonly values: readonly unknown[] };

export type SurrealOperator = 
  | "=" | "!=" | "==" | "?=" | "*=" | "~" | "!~" | "?~" | "*~" 
  | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" 
  | "CONTAINS" | "CONTAINSNOT" | "CONTAINSALL" | "CONTAINSANY" | "CONTAINSNONE"
  | "INSIDE" | "NOTINSIDE" | "ALLINSIDE" | "ANYINSIDE" | "NONEINSIDE"
  | "OUTSIDE" | "INTERSECTS" | "@@" | "<|";

export type OrderClause = {
  readonly field: AstValue;
  readonly direction: "ASC" | "DESC";
  readonly collate?: boolean;
  readonly numeric?: boolean;
};

export interface BaseStatement {
  readonly type: string;
  readonly timeout?: string;
  readonly parallel?: boolean;
}

export interface SelectStatement extends BaseStatement {
  readonly type: "SELECT";
  readonly live?: boolean;
  readonly diff?: boolean;
  readonly only?: boolean;
  readonly fields: readonly AstValue[];
  readonly omit?: readonly string[];
  readonly targets: readonly AstValue[];
  readonly withIndex?: readonly string[];
  readonly where?: AstCondition;
  readonly splitAt?: readonly string[];
  readonly groupBy?: readonly string[];
  readonly orderBy?: readonly OrderClause[];
  readonly limit?: number | AstValue;
  readonly start?: number | AstValue;
  readonly fetch?: readonly string[];
  readonly version?: string;
  readonly explain?: boolean | "FULL";
}

export interface CreateStatement extends BaseStatement {
  readonly type: "CREATE";
  readonly only?: boolean;
  readonly targets: readonly AstValue[];
  readonly data?: DataClause;
  readonly return?: ReturnClause;
}

export interface UpdateStatement extends BaseStatement {
  readonly type: "UPDATE";
  readonly only?: boolean;
  readonly targets: readonly AstValue[];
  readonly data: DataClause;
  readonly where?: AstCondition;
  readonly return?: ReturnClause;
}

export interface UpsertStatement extends Omit<UpdateStatement, "type"> {
  readonly type: "UPSERT";
}

export interface DeleteStatement extends BaseStatement {
  readonly type: "DELETE";
  readonly only?: boolean;
  readonly targets: readonly AstValue[];
  readonly where?: AstCondition;
  readonly return?: ReturnClause;
}

export interface InsertStatement extends BaseStatement {
  readonly type: "INSERT";
  readonly relation?: boolean;
  readonly ignore?: boolean;
  readonly target: AstValue;
  readonly data: AstValue | readonly AstValue[];
  readonly onDuplicate?: DataClause;
  readonly return?: ReturnClause;
}

export interface RelateStatement extends BaseStatement {
  readonly type: "RELATE";
  readonly only?: boolean;
  readonly from: AstValue;
  readonly edge: AstValue;
  readonly to: AstValue;
  readonly data?: DataClause;
  readonly return?: ReturnClause;
}

export interface RawStatement extends BaseStatement {
  readonly type: "RAW";
  readonly sql?: string;
  readonly strings?: readonly string[];
  readonly values?: readonly unknown[];
}

export interface TransactionStatement extends BaseStatement {
  readonly type: "TRANSACTION";
  readonly statements: readonly StatementNode[];
}

export type StatementNode =
  | SelectStatement
  | CreateStatement
  | UpdateStatement
  | UpsertStatement
  | DeleteStatement
  | InsertStatement
  | RelateStatement
  | RawStatement
  | TransactionStatement;
