import * as Schema from "effect/Schema";

/** The client sends at most this many ungrouped projects; the rest stay ungrouped. */
export const PROJECT_GROUP_SUGGESTION_MAX_PROJECTS = 100;
export const PROJECT_GROUP_NAME_MAX_LENGTH = 40;

const ShortText = Schema.String.check(Schema.isMaxLength(200));

export const ProjectGroupSuggestionInput = Schema.Struct({
  /** `key` is opaque to the server: it is echoed back and never shown to the model. */
  projects: Schema.Array(
    Schema.Struct({
      key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_000)),
      title: ShortText,
      /** `owner/name`, when the project is a known repository. */
      repository: Schema.optionalKey(ShortText),
    }),
  ).check(Schema.isMaxLength(PROJECT_GROUP_SUGGESTION_MAX_PROJECTS)),
  groups: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
      name: ShortText,
      parentId: Schema.optionalKey(Schema.String),
    }),
  ).check(Schema.isMaxLength(500)),
});
export type ProjectGroupSuggestionInput = typeof ProjectGroupSuggestionInput.Type;

export const ProposedProjectGroup = Schema.Struct({
  /** Names this proposal so a later proposed group can nest inside it. */
  ref: Schema.String,
  name: Schema.String,
  parentGroupId: Schema.optionalKey(Schema.String),
  /** Always listed before the groups that reference it. */
  parentRef: Schema.optionalKey(Schema.String),
  projectKeys: Schema.Array(Schema.String),
});
export type ProposedProjectGroup = typeof ProposedProjectGroup.Type;

export const ProjectGroupSuggestionResult = Schema.Union([
  Schema.TaggedStruct("Suggested", {
    model: Schema.String,
    assignments: Schema.Array(
      Schema.Struct({ groupId: Schema.String, projectKeys: Schema.Array(Schema.String) }),
    ),
    groups: Schema.Array(ProposedProjectGroup),
  }),
  Schema.TaggedStruct("Unavailable", {
    reason: Schema.Literals(["failed", "timeout", "invalid-output"]),
  }),
]);
export type ProjectGroupSuggestionResult = typeof ProjectGroupSuggestionResult.Type;
