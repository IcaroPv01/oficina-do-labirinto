const TEST_OWNER = {
  kind: "user",
  userId: "owner-001",
  displayName: "Ícaro",
  role: "owner",
} as const;

/** Smallest valid change set useful at HTTP and WebSocket test boundaries. */
export function studioDraftChangeSet() {
  const createdAt = "2026-07-13T12:00:00.000Z";
  return {
    schemaVersion: 1,
    changeSetId: "change-set-001",
    workspaceId: "workspace-main",
    projectId: "project-main",
    title: "Primeira proposta",
    explanation: "Documenta uma mudança antes de aplicá-la.",
    status: "draft",
    baseRevision: {
      schemaVersion: 1,
      revisionId: "revision-base",
      projectId: "project-main",
      parentRevisionId: null,
      sequence: 0,
      digestAlgorithm: "sha256",
      canonicalization: "jcs-rfc8785",
      digest: "a".repeat(64),
      contentBytes: 2,
      createdAt,
      createdBy: TEST_OWNER,
    },
    candidateRevision: null,
    sourceProposalIds: [],
    operations: [],
    author: TEST_OWNER,
    createdAt,
    updatedAt: createdAt,
    latestTest: null,
    review: null,
    publication: null,
    supersededByChangeSetId: null,
  } as const;
}
