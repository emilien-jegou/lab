// Internal AST helpers, type guards, and WHERE/data-mode parsers.
import type {
  OdmCondition,
  OdmValue,
  RawSQL,
  SurrealID,
  UpdateMode,
  WhereClause,
} from '../api';
import type {
  AstCondition,
  AstValue,
  DataClause,
  SurrealOperator,
} from '../ast';
import { Ast } from '../ast-builder';

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
export function isSurrealID(val: unknown): val is SurrealID {
  return isObject(val) && (val as any)._tag === 'SurrealID';
}
function isRawSQL(val: unknown): val is RawSQL {
  return isObject(val) && (val as any)._tag === 'RawSQL';
}
function isOdmValue(val: unknown): val is OdmValue {
  return isObject(val) && (val as any)._tag === 'OdmValue';
}
function isOdmCondition(val: unknown): val is OdmCondition {
  return isObject(val) && (val as any)._tag === 'OdmCondition';
}
function isOperatorObject(val: unknown): val is Record<string, unknown> {
  return (
    isObject(val) &&
    !(val instanceof Date) &&
    !('_tag' in val) &&
    Object.keys(val).some((k) => k.startsWith('$'))
  );
}

export function toAstValue(val: unknown): AstValue {
  if (isSurrealID(val)) return Ast.val.id(val.table, val.value);
  if (isRawSQL(val)) return Ast.val.rawNode(val.strings, val.values);
  if (isOdmValue(val)) return val.ast as AstValue;
  if (val && typeof val === 'object' && '_tag' in val && (val as any)._tag === 'Field') {
    return Ast.val.ident((val as any).name);
  }
  return Ast.val.literal(val);
}

function toAstFieldOrValue(val: unknown): AstValue {
  if (typeof val === 'string') return Ast.val.ident(val);
  if (val && typeof val === 'object' && '_tag' in val && (val as any)._tag === 'Field') {
    return Ast.val.ident((val as any).name);
  }
  return toAstValue(val);
}

export function parseTarget(target: unknown): AstValue {
  if (isSurrealID(target)) return Ast.val.id(target.table, target.value);
  if (isRawSQL(target)) return Ast.val.rawNode(target.strings, target.values);
  if (typeof target === 'string') {
    if (target.includes(':')) {
      const colonIndex = target.indexOf(':');
      const table = target.slice(0, colonIndex);
      const idPart = target.slice(colonIndex + 1);
      const cleanId =
        idPart.startsWith('"') && idPart.endsWith('"')
          ? idPart.slice(1, -1)
          : idPart;

      let parsedId: unknown = cleanId;
      if (/^-?\d+$/.test(cleanId)) {
        parsedId = Number(cleanId);
      } else if (
        (cleanId.startsWith('[') && cleanId.endsWith(']')) ||
        (cleanId.startsWith('{') && cleanId.endsWith('}'))
      ) {
        try {
          parsedId = JSON.parse(cleanId);
        } catch {
          // Keep string if malformed JSON
        }
      }

      return Ast.val.id(table, parsedId as string | number | object | readonly unknown[]);
    }
    return Ast.val.ident(target);
  }
  throw new Error('Invalid target type');
}

export const compare = (
  left: unknown,
  operator: SurrealOperator,
  right: unknown,
): OdmCondition => ({
  _tag: 'OdmCondition',
  ast: Ast.cond.compare(toAstFieldOrValue(left), operator, toAstValue(right)),
});

export function mapFieldSpec(s: any): AstValue {
  if (isOdmValue(s)) return s.ast;
  if (s && typeof s === 'object' && '_tag' in s) {
    if (s._tag === 'Field') return Ast.val.ident(s.name);
    if (s._tag === 'As') {
      const expr = isOdmValue(s.field) ? (s.field.ast as AstValue) : Ast.val.ident(String(s.field));
      return Ast.val.alias(expr, s.alias);
    }
    if (s._tag === 'Rel') return Ast.val.graphPath(s.path);
  }
  if (typeof s === 'string') return Ast.val.ident(s);
  return Ast.val.ident(String(s?.name || s?.path || s?.alias || s));
}

const OP_MAP: Record<string, SurrealOperator> = {
  $eq: '=',
  $not: '!=',
  $exact: '==',
  $fuzzy: '~',
  $notFuzzy: '!~',
  $anyEq: '?=',
  $allEq: '*=',
  $anyFuzzy: '?~',
  $allFuzzy: '*~',
  $lt: '<',
  $lte: '<=',
  $gt: '>',
  $gte: '>=',
  $contains: 'CONTAINS',
  $notContains: 'CONTAINSNOT',
  $containsAll: 'CONTAINSALL',
  $containsAny: 'CONTAINSANY',
  $containsNone: 'CONTAINSNONE',
  $in: 'INSIDE',
  $notIn: 'NOTINSIDE',
  $allIn: 'ALLINSIDE',
  $anyIn: 'ANYINSIDE',
  $noneIn: 'NONEINSIDE',
  $outside: 'OUTSIDE',
  $intersects: 'INTERSECTS',
  $search: '@@',
};

export function parseWhere(where?: WhereClause): AstCondition | undefined {
  if (!where) return undefined;
  const conditions: AstCondition[] = [];
  const whereRecord = where as Record<string, unknown>;

  if (Array.isArray(whereRecord.$and)) {
    const ops = (whereRecord.$and as readonly WhereClause[])
      .map(parseWhere)
      .filter((c): c is AstCondition => c !== undefined);
    if (ops.length) conditions.push(Ast.cond.and(...ops));
  }
  if (Array.isArray(whereRecord.$or)) {
    const ops = (whereRecord.$or as readonly WhereClause[])
      .map(parseWhere)
      .filter((c): c is AstCondition => c !== undefined);
    if (ops.length) conditions.push(Ast.cond.or(...ops));
  }
  if (Array.isArray(whereRecord.$nullish)) {
    const [key, val] = whereRecord.$nullish as unknown as readonly [string, unknown];
    conditions.push(Ast.cond.nullish(Ast.val.ident(key), toAstValue(val)));
  }
  if (whereRecord.$raw) {
    const raws = Array.isArray(whereRecord.$raw) ? whereRecord.$raw : [whereRecord.$raw];
    for (const r of raws) {
      if (isRawSQL(r)) conditions.push(Ast.cond.rawNode(r.strings, r.values));
    }
  }
  if (whereRecord.$expr) {
    const exprs = Array.isArray(whereRecord.$expr) ? whereRecord.$expr : [whereRecord.$expr];
    for (const e of exprs) {
      if (isOdmValue(e) || isOdmCondition(e)) {
        conditions.push((e as any).ast);
      }
    }
  }

  for (const [key, val] of Object.entries(whereRecord)) {
    if (['$and', '$or', '$nullish', '$raw', '$expr'].includes(key)) continue;
    if (val === undefined) continue;
    const left = Ast.val.ident(key);
    if (isOperatorObject(val)) {
      for (const [opKey, opVal] of Object.entries(val as Record<string, unknown>)) {
        if (opKey === '$knn' && Array.isArray(opVal)) {
          const [k, metric, target] = opVal;
          if (target !== undefined) {
            conditions.push(
              Ast.cond.compare(
                left,
                '<|',
                Ast.val.rawNode([`${k}, ${metric}|> `, ''], [target]),
              ),
            );
          } else {
            conditions.push(Ast.cond.compare(left, '<|', Ast.val.raw(`${k}, ${metric}|>`)));
          }
          continue;
        }
        const mappedOp = OP_MAP[opKey];
        if (mappedOp) conditions.push(Ast.cond.compare(left, mappedOp, toAstValue(opVal)));
      }
    } else {
      conditions.push(Ast.cond.eq(left, toAstValue(val)));
    }
  }
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return Ast.cond.and(...conditions);
}

export function parseDataMode(mode: UpdateMode): DataClause {
  switch (mode.type) {
    case 'SET': {
      if (Array.isArray(mode.data)) {
        throw new Error('SET mode does not support arrays. Use content() or merge() instead.');
      }
      const entries = Object.entries(mode.data as Record<string, unknown>);
      if (entries.length === 0) {
        throw new Error('SET clause requires at least one field assignment');
      }
      const assignments: Record<string, AstValue> = {};
      for (const [k, v] of entries)
        assignments[k] = toAstValue(v);
      return Ast.data.set(assignments);
    }
    case 'UNSET':
      return Ast.data.unset(mode.fields.map(String));
    case 'MERGE':
      return Ast.data.merge(toAstValue(mode.data));
    case 'CONTENT':
      return Ast.data.content(toAstValue(mode.data));
    case 'PATCH':
      return Ast.data.patch(toAstValue(mode.data));
    default:
      throw new Error('Unsupported mode type');
  }
}
