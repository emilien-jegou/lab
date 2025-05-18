// Iggy HTTP API response shapes and internal context types.
export interface IggyLoginResponse {
  readonly tokens?: {
    readonly access_token?: {
      readonly token?: string;
    };
  };
  readonly access_token?:
    | {
        readonly token?: string;
      }
    | string;
}

export interface IggyResourceDetails {
  readonly id: number;
  readonly name: string;
}

export interface IggyPollMessage {
  readonly offset: number;
  readonly timestamp: number;
  readonly id: number | string;
  readonly payload: string;
}

export interface IggyPollResponse {
  readonly messages?: readonly IggyPollMessage[];
}

export interface TopicContext {
  readonly streamIdNum: number;
  readonly topicIdNum: number;
}
