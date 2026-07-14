export const NOW = "2026-07-13T12:00:00.000Z";
export const LATER = "2026-07-13T12:01:00.000Z";
export const LATEST = "2026-07-13T12:02:00.000Z";

export const OWNER = {
  kind: "user",
  userId: "user-owner",
  displayName: "Owner",
  role: "owner",
} as const;

export const EDITOR = {
  kind: "user",
  userId: "user-editor",
  displayName: "Editor",
  role: "editor",
} as const;

export const REVIEWER = {
  kind: "user",
  userId: "user-reviewer",
  displayName: "Reviewer",
  role: "reviewer",
} as const;

export const PROVIDER = {
  provider: "example-compatible-api",
  model: "model-v1",
  requestId: "request-123",
  metadata: { region: "local", cached: false },
} as const;

export const BASE_REVISION = {
  schemaVersion: 1,
  revisionId: "revision-000",
  projectId: "project-main",
  parentRevisionId: null,
  sequence: 0,
  digestAlgorithm: "sha256",
  canonicalization: "jcs-rfc8785",
  digest: "a".repeat(64),
  contentBytes: 1_024,
  createdAt: NOW,
  createdBy: OWNER,
} as const;

export const CANDIDATE_REVISION = {
  ...BASE_REVISION,
  revisionId: "revision-001",
  parentRevisionId: "revision-000",
  sequence: 1,
  digest: "b".repeat(64),
  createdAt: LATER,
  createdBy: EDITOR,
} as const;

export const VALID_BEHAVIOR = {
  schemaVersion: 1,
  kind: "enemy-behavior",
  entryStateId: "patrol",
  states: [
    {
      stateId: "patrol",
      movement: {
        kind: "patrol",
        speedMultiplier: 0.8,
        waypoints: [
          { offsetX: -100, offsetY: 0, pauseSeconds: 0 },
          { offsetX: 100, offsetY: 0, pauseSeconds: 0.5 },
        ],
        loop: true,
      },
      transitions: [
        {
          transitionId: "transition-chase",
          toStateId: "chase",
          when: {
            mode: "all",
            conditions: [
              {
                kind: "distance-to-player",
                operator: "lte",
                pixels: 240,
              },
              { kind: "line-of-sight", visible: true },
            ],
          },
        },
      ],
    },
    {
      stateId: "chase",
      movement: {
        kind: "chase",
        speedMultiplier: 1.2,
        stopDistance: 24,
        requireLineOfSight: false,
      },
      transitions: [
        {
          transitionId: "transition-flee",
          toStateId: "flee",
          when: {
            mode: "all",
            conditions: [
              { kind: "health-ratio", operator: "lte", ratio: 0.25 },
            ],
          },
        },
        {
          transitionId: "transition-patrol",
          toStateId: "patrol",
          when: {
            mode: "all",
            conditions: [
              {
                kind: "distance-to-player",
                operator: "gte",
                pixels: 600,
              },
            ],
          },
        },
      ],
    },
    {
      stateId: "flee",
      movement: {
        kind: "flee",
        speedMultiplier: 1.5,
        safeDistance: 500,
      },
      transitions: [
        {
          transitionId: "transition-recover",
          toStateId: "patrol",
          when: {
            mode: "all",
            conditions: [{ kind: "state-elapsed", seconds: 5 }],
          },
        },
      ],
    },
  ],
} as const;

export const BEHAVIOR_OPERATION = {
  operationId: "operation-behavior",
  kind: "enemy.set-behavior",
  explanation: "Adiciona patrulha, perseguição e fuga declarativas.",
  behavior: VALID_BEHAVIOR,
} as const;

export const PASSING_TEST = {
  testRunId: "test-run-001",
  revisionId: "revision-001",
  revisionDigest: "b".repeat(64),
  status: "passed",
  checks: [
    {
      checkId: "check-start",
      name: "O jogo inicia",
      status: "passed",
      details: null,
    },
  ],
  executedBy: REVIEWER,
  startedAt: LATER,
  completedAt: LATEST,
} as const;

export const OWNER_APPROVAL = {
  decision: "approve",
  revisionId: CANDIDATE_REVISION.revisionId,
  revisionDigest: CANDIDATE_REVISION.digest,
  decidedBy: OWNER,
  explanation: "Testei o comportamento no sandbox e aprovei.",
  decidedAt: "2026-07-13T12:03:00.000Z",
} as const;

export const PENDING_PUBLICATION = {
  publicationId: "publication-001",
  status: "pending",
  scmProvider: "git-compatible",
  repository: "owner/repository",
  branch: "studio/change-001",
  changeRequestId: "42",
  changeRequestUrl: "https://example.test/changes/42",
  commitDigest: null,
  startedAt: "2026-07-13T12:04:00.000Z",
  completedAt: null,
  failureReason: null,
} as const;

export const SUCCESSFUL_PUBLICATION = {
  ...PENDING_PUBLICATION,
  status: "succeeded",
  commitDigest: "c".repeat(40),
  completedAt: "2026-07-13T12:05:00.000Z",
} as const;

export const APPROVED_CHANGE_SET = {
  schemaVersion: 1,
  changeSetId: "change-set-001",
  workspaceId: "workspace-main",
  projectId: "project-main",
  title: "Movimento do sentinela",
  explanation: "Faz o inimigo patrulhar, perseguir e recuar com pouca vida.",
  status: "approved",
  baseRevision: BASE_REVISION,
  candidateRevision: CANDIDATE_REVISION,
  sourceProposalIds: ["proposal-001"],
  operations: [BEHAVIOR_OPERATION],
  author: EDITOR,
  createdAt: NOW,
  updatedAt: "2026-07-13T12:03:00.000Z",
  latestTest: PASSING_TEST,
  review: OWNER_APPROVAL,
  publication: null,
  supersededByChangeSetId: null,
} as const;
