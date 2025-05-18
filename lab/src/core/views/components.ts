import { Effect } from 'effect';
import { activeBuildContext, LiveQueryRef, LiveStreamRef } from './live';
import type { ViewComponent } from './types';

let fallbackActionCounter = 0;

export interface StatProps {
  readonly label: string;
  readonly value: LiveQueryRef<any> | LiveStreamRef<any> | string | number | boolean;
  readonly description?: string;
  readonly icon?: string;
  readonly change?: number | { readonly value: number; readonly direction: 'up' | 'down' };
}

export interface ButtonProps {
  readonly variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  readonly disabled?: boolean;
  readonly icon?: string;
}

export interface TableOptions {
  readonly columns?: readonly { readonly key: string; readonly title: string }[];
  readonly pageSize?: number;
}

export const V = {
  row: (children: readonly ViewComponent[], props: Record<string, unknown> = {}): ViewComponent => ({
    type: 'row',
    children,
    ...props,
    toJSON() {
      return { type: 'row', children: this.children, ...props };
    },
  }),

  col: (children: readonly ViewComponent[], props: Record<string, unknown> = {}): ViewComponent => ({
    type: 'col',
    children,
    ...props,
    toJSON() {
      return { type: 'col', children: this.children, ...props };
    },
  }),

  stat: (props: StatProps): ViewComponent => ({
    type: 'stat',
    ...props,
    toJSON() {
      return {
        type: 'stat',
        label: props.label,
        value: props.value,
        description: props.description,
        icon: props.icon,
        change: props.change,
      };
    },
  }),

  button: (
    label: string,
    onClick: Effect.Effect<any, any, any>,
    props: ButtonProps = {},
  ): ViewComponent => {
    const actionId = activeBuildContext
      ? activeBuildContext.nextActionId()
      : `action_${++fallbackActionCounter}`;

    const action = { _tag: 'ViewAction' as const, id: actionId, handler: onClick };

    if (activeBuildContext) {
      activeBuildContext.registerAction(actionId, onClick);
    }

    return {
      type: 'button',
      label,
      actionId,
      action,
      ...props,
      toJSON() {
        return {
          type: 'button',
          label,
          actionId,
          variant: props.variant ?? 'primary',
          disabled: props.disabled ?? false,
          icon: props.icon,
        };
      },
    };
  },

  divider: (): ViewComponent => ({
    type: 'divider',
    toJSON() {
      return { type: 'divider' };
    },
  }),

  table: (
    data: LiveQueryRef<any> | readonly any[],
    options: TableOptions = {},
  ): ViewComponent => ({
    type: 'table',
    data,
    ...options,
    toJSON() {
      return {
        type: 'table',
        data,
        columns: options.columns,
        pageSize: options.pageSize ?? 10,
      };
    },
  }),

  card: (children: readonly ViewComponent[], props: { title?: string } = {}): ViewComponent => ({
    type: 'card',
    children,
    ...props,
    toJSON() {
      return { type: 'card', children: this.children, ...props };
    },
  }),

  text: (content: string | LiveQueryRef<any>, props: Record<string, unknown> = {}): ViewComponent => ({
    type: 'text',
    content,
    ...props,
    toJSON() {
      return { type: 'text', content, ...props };
    },
  }),

  heading: (text: string, level: 1 | 2 | 3 | 4 | 5 | 6 = 2): ViewComponent => ({
    type: 'heading',
    text,
    level,
    toJSON() {
      return { type: 'heading', text, level };
    },
  }),
};
