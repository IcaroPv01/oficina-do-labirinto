import { describe, expect, it } from "vitest";
import {
  AiModeSchema,
  ProviderMetadataSchema,
  RevisionDigestMetadataSchema,
  StudioIdSchema,
  WorkspaceRoleSchema,
} from "./primitives.js";
import { BASE_REVISION, PROVIDER } from "./test-fixtures.js";

describe("studio primitives", () => {
  it("accepts the four explicit workspace roles and no implicit role", () => {
    expect(WorkspaceRoleSchema.options).toEqual([
      "owner",
      "editor",
      "reviewer",
      "viewer",
    ]);
    expect(WorkspaceRoleSchema.safeParse("admin").success).toBe(false);
  });

  it("keeps IDs opaque and rejects paths or whitespace", () => {
    expect(StudioIdSchema.safeParse("revision:01-a").success).toBe(true);
    expect(StudioIdSchema.safeParse("../revision").success).toBe(false);
    expect(StudioIdSchema.safeParse("revision 01").success).toBe(false);
  });

  it("enumerates provider-neutral AI intents", () => {
    expect(AiModeSchema.safeParse("propose-behavior").success).toBe(true);
    expect(AiModeSchema.safeParse("clean-png").success).toBe(true);
    expect(AiModeSchema.safeParse("run-shell").success).toBe(false);
  });

  it("accepts non-secret provider provenance", () => {
    expect(ProviderMetadataSchema.parse(PROVIDER)).toEqual(PROVIDER);
  });

  it.each(["apiKey", "access_token", "secret", "Authorization", "cookie"])(
    "forbids credential-like provider metadata key %s",
    (key) => {
      const value = { ...PROVIDER, metadata: { [key]: "must-not-pass" } };
      expect(ProviderMetadataSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each([
    [
      "authorization header",
      ["Authorization: ", "Bear", "er ", "abcdefghijklmnop"].join(""),
    ],
    [
      "known token prefix",
      ["provider-key ", "vb", "k_", "1234567890abcdef"].join(""),
    ],
    ["cloud access key", ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("")],
    [
      "private key header",
      ["-----BEGIN OPENSSH ", "PRIVATE", " KEY-----"].join(""),
    ],
    [
      "cookie header",
      ["Set-", "Cookie: session=", "abcdefghijklmnop"].join(""),
    ],
    [
      "credentials in URL",
      ["https://user", ":password@", "example.test"].join(""),
    ],
  ])("forbids credential-like provider metadata value %s", (_label, secretLikeValue) => {
    expect(
      ProviderMetadataSchema.safeParse({
        ...PROVIDER,
        metadata: { note: secretLikeValue },
      }).success,
    ).toBe(false);
  });

  it.each([
    "bearer",
    "sketch-v2",
    "https://example.test/model",
    "request.12345",
    "cookie-policy",
  ])("keeps ordinary provider metadata value %s", (ordinaryValue) => {
    expect(
      ProviderMetadataSchema.safeParse({
        ...PROVIDER,
        metadata: { note: ordinaryValue },
      }).success,
    ).toBe(true);
  });

  it("limits provider metadata size and rejects unknown top-level fields", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`field${index}`, index]),
    );
    expect(
      ProviderMetadataSchema.safeParse({ ...PROVIDER, metadata }).success,
    ).toBe(false);
    expect(
      ProviderMetadataSchema.safeParse({ ...PROVIDER, endpoint: "secret-ish" })
        .success,
    ).toBe(false);
  });
});

describe("revision digest metadata", () => {
  it("accepts a canonical genesis digest", () => {
    expect(RevisionDigestMetadataSchema.parse(BASE_REVISION)).toEqual(
      BASE_REVISION,
    );
  });

  it("requires a parent exactly for non-genesis revisions", () => {
    expect(
      RevisionDigestMetadataSchema.safeParse({
        ...BASE_REVISION,
        sequence: 1,
      }).success,
    ).toBe(false);
    expect(
      RevisionDigestMetadataSchema.safeParse({
        ...BASE_REVISION,
        parentRevisionId: "revision-parent",
      }).success,
    ).toBe(false);
  });

  it("rejects self-parenting, malformed digests and extra fields", () => {
    expect(
      RevisionDigestMetadataSchema.safeParse({
        ...BASE_REVISION,
        sequence: 1,
        parentRevisionId: BASE_REVISION.revisionId,
      }).success,
    ).toBe(false);
    expect(
      RevisionDigestMetadataSchema.safeParse({
        ...BASE_REVISION,
        digest: "ABC",
      }).success,
    ).toBe(false);
    expect(
      RevisionDigestMetadataSchema.safeParse({
        ...BASE_REVISION,
        hidden: true,
      }).success,
    ).toBe(false);
  });
});
