export type JsonMap = Record<string, unknown>;
export type JsonList = readonly JsonMap[];

export interface GitLabProject extends JsonMap {
  readonly id?: number;
  readonly path_with_namespace?: string;
  readonly name?: string;
  readonly default_branch?: string;
  readonly namespace?: {
    readonly id?: number;
    readonly full_path?: string;
  };
  readonly permissions?: {
    readonly project_access?: {
      readonly access_level?: number;
    };
    readonly group_access?: {
      readonly access_level?: number;
    };
  };
}

export interface GitLabGroup extends JsonMap {
  readonly id?: number;
  readonly full_path?: string;
  readonly name?: string;
}
