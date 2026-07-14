import assert from "node:assert/strict";
import test from "node:test";
import { StudioDatabase } from "../src/database.js";

test("migrations create the collaboration schema", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const tables = database.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    for (const required of [
      "users",
      "invites",
      "projects",
      "revisions",
      "change_sets",
      "chat_messages",
      "activity",
      "approvals",
      "change_set_versions",
      "sandbox_tests",
      "change_set_reviews",
    ]) {
      assert.ok(names.includes(required), `missing ${required}`);
    }
  } finally {
    database.close();
  }
});

test("one-time invites establish a hashed opaque session", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const invite = database.createInvite("owner", null, 60_000);
    const stored = database.connection.prepare("SELECT token_hash FROM invites WHERE id = ?").get(invite.value.id) as {
      token_hash: string;
    };
    assert.notEqual(stored.token_hash, invite.token);
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/);

    const session = database.redeemInvite(invite.token, "Icaro", 60_000);
    assert.equal(session.user.role, "owner");
    assert.deepEqual(database.getSession(session.sessionToken)?.user, session.user);
    assert.throws(() => database.redeemInvite(invite.token, "Outro", 60_000), /Convite inválido/);

    const storedSession = database.connection
      .prepare("SELECT token_hash FROM sessions WHERE id = ?")
      .get(session.sessionId) as { token_hash: string };
    assert.notEqual(storedSession.token_hash, session.sessionToken);
  } finally {
    database.close();
  }
});

test("project snapshots use optimistic revisions and retain explanations", () => {
  const database = new StudioDatabase(":memory:");
  try {
    const session = database.createDevSession("Icaro", 60_000);
    const created = database.createProject("Labirinto", { version: 1 }, "Projeto inicial", session.user);
    assert.equal(created.revision.revision, 1);
    const updated = database.updateSnapshot(
      created.project.id,
      1,
      { version: 2 },
      "Ajustei o movimento",
      session.user,
    );
    assert.equal(updated.revision.revision, 2);
    assert.equal(database.getLatestRevision(created.project.id)?.explanation, "Ajustei o movimento");
    assert.throws(
      () => database.updateSnapshot(created.project.id, 1, { version: 3 }, "Conflito", session.user),
      /revisão 2/,
    );

    const message = database.addChatMessage(created.project.id, session.user, "Teste pronto");
    assert.equal(database.listChatMessages(created.project.id, undefined, 10)[0]?.id, message.id);

    const activity = database.connection
      .prepare("SELECT id FROM activity WHERE project_id = ? ORDER BY created_at LIMIT 1")
      .get(created.project.id) as { id: string };
    assert.throws(
      () => database.connection.prepare("UPDATE activity SET action = 'tampered' WHERE id = ?").run(activity.id),
      /activity is append-only/,
    );
    assert.throws(
      () => database.connection.prepare("DELETE FROM activity WHERE id = ?").run(activity.id),
      /activity is append-only/,
    );
  } finally {
    database.close();
  }
});
