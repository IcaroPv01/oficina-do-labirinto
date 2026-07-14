import { describe, expect, it, vi } from "vitest";
import defaultProjectJson from "../../../game-data/default-project.json";
import type { StudioRealtimeProjection } from "./realtime-events";
import { applyStudioRealtimeMessage } from "./realtime-events";
import { studioDraftChangeSet } from "./studio-test-fixtures";

describe("applyStudioRealtimeMessage", () => {
  it("mantém presenças independentes e remove apenas a conexão encerrada", () => {
    const projection = projectionRecorder();

    applyStudioRealtimeMessage(
      {
        type: "ready",
        presence: [presence("client-one", "Ana")],
      },
      projection,
    );
    applyStudioRealtimeMessage(
      {
        type: "presence.join",
        presence: presence("client-two", "Beto", "testing"),
      },
      projection,
    );
    applyStudioRealtimeMessage(
      { type: "presence.leave", clientId: "client-one" },
      projection,
    );

    expect(projection.replaceMembers).toHaveBeenCalledOnce();
    expect(projection.upsertMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: "client-two", currentContext: "Testando" }),
    );
    expect(projection.removeMember).toHaveBeenCalledWith("client-one");
  });

  it("aceita somente propostas que passam pelo contrato compartilhado", () => {
    const projection = projectionRecorder();
    const changeSet = studioDraftChangeSet();

    applyStudioRealtimeMessage(
      { type: "change-set.updated", changeSet },
      projection,
    );
    applyStudioRealtimeMessage(
      {
        type: "change-set.updated",
        changeSet: { ...changeSet, operations: [{ kind: "code.run" }] },
      },
      projection,
    );

    expect(projection.upsertChangeSet).toHaveBeenCalledTimes(1);
    expect(projection.upsertChangeSet).toHaveBeenCalledWith(changeSet);
  });

  it("converte uma revisão remota válida sem aceitar snapshot corrompido", () => {
    const projection = projectionRecorder();
    const validRevision = {
      projectId: "project-main",
      revision: 2,
      snapshot: defaultProjectJson,
      createdAt: "2026-07-13T12:05:00.000Z",
    };

    applyStudioRealtimeMessage(
      { type: "project.revision.created", revision: validRevision },
      projection,
    );
    applyStudioRealtimeMessage(
      {
        type: "project.revision.created",
        revision: { ...validRevision, revision: 3, snapshot: { unsafe: true } },
      },
      projection,
    );

    expect(projection.applyProjectRevision).toHaveBeenCalledTimes(1);
    expect(projection.applyProjectRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-main",
        revisionNumber: 2,
        project: expect.objectContaining({ schemaVersion: 1 }),
      }),
    );
  });
});

function projectionRecorder(): StudioRealtimeProjection {
  return {
    replaceMembers: vi.fn(),
    upsertMember: vi.fn(),
    removeMember: vi.fn(),
    addChat: vi.fn(),
    upsertChangeSet: vi.fn(),
    applyProjectRevision: vi.fn(),
  };
}

function presence(
  clientId: string,
  displayName: string,
  state: "idle" | "editing" | "testing" = "idle",
) {
  return {
    clientId,
    user: {
      id: `user-${clientId}`,
      displayName,
      role: "editor",
    },
    state,
    entity: null,
  };
}
