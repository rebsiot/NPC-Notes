/**
 * G06 Player NPC Notes - world Journal storage. No writes to Actor/Token documents.
 * The Journal flags, not its name or folder location, define the association.
 */
export const MODULE_ID = "player-npc-notes";
export const JOURNAL_FLAG = "noteLink";
export const FOLDER_FLAG = "managedFolder";
export const SCHEMA = 1;

const inflight = new Map();

export function subjectUuidForActor(actor) {
  if (!actor || actor.documentName !== "Actor") return null;
  // A synthetic (unlinked) Token Actor is one NPC instance, not its template.
  if (actor.token && !actor.token.actorLink) return actor.token.uuid ?? null;
  return actor.uuid ?? null;
}

export async function resolveSubject(subjectUuid, lookup = globalThis.fromUuid) {
  if (typeof subjectUuid !== "string" || subjectUuid.length > 256) return null;
  if (!/^(Actor\.[A-Za-z0-9]+|Scene\.[A-Za-z0-9]+\.Token\.[A-Za-z0-9]+)$/.test(subjectUuid)) return null;
  const doc = await lookup(subjectUuid);
  if (doc?.documentName === "Actor" && !doc.inCompendium) {
    return { actor: doc, subjectUuid };
  }
  if (doc?.documentName === "Token" && doc.parent?.documentName === "Scene" && doc.actor) {
    return { actor: doc.actor, subjectUuid, sceneId: doc.parent.id };
  }
  return null;
}

export function playerMayNote(actor, user) {
  return Boolean(actor && user && actor.testUserPermission?.(user, "LIMITED"));
}

export function journalKey(subjectUuid, scope, userId = "") {
  return `${subjectUuid}|${scope}|${scope === "personal" ? userId : ""}`;
}

export function isValidScope(scope) {
  return scope === "shared" || scope === "personal";
}

export function journalLink(entry) {
  return entry?.getFlag?.(MODULE_ID, JOURNAL_FLAG) ?? null;
}

export function findJournal(journals, subjectUuid, scope, userId) {
  if (!isValidScope(scope)) return null;
  return Array.from(journals).find(entry => {
    const link = journalLink(entry);
    return link?.schema === SCHEMA && link.subjectUuid === subjectUuid &&
      link.scope === scope && (scope === "shared" || link.userId === userId);
  }) ?? null;
}

export function buildOwnership(actor, scope, userId, users, levels) {
  const none = levels.NONE;
  const owner = levels.OWNER;
  const ownership = { default: none };
  if (scope === "personal") {
    const user = Array.from(users).find(u => u.id === userId);
    if (!user) throw new Error("The requested player is no longer in this world.");
    if (!user.isGM) ownership[user.id] = owner;
  } else if (scope === "shared") {
    for (const user of users) {
      if (user.isGM || user.role === 0) continue;
      if (playerMayNote(actor, user)) ownership[user.id] = owner;
    }
  } else throw new Error("Unknown notes scope.");
  return ownership;
}

export function ownershipDiffers(current, expected) {
  const a = current ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(expected)]);
  return Array.from(keys).some(k => (a[k] ?? 0) !== (expected[k] ?? 0));
}

async function ensureFolder() {
  const found = game.folders.find(folder =>
    folder.type === "JournalEntry" && folder.getFlag?.(MODULE_ID, FOLDER_FLAG) === true
  );
  if (found) return found;
  return Folder.implementation.create({
    name: "Player NPC Notes",
    type: "JournalEntry",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } }
  });
}

async function ensureSharedPermissions(entry, actor) {
  const expected = buildOwnership(actor, "shared", null, game.users, CONST.DOCUMENT_OWNERSHIP_LEVELS);
  if (ownershipDiffers(entry.ownership, expected)) await entry.update({ ownership: expected });
}

export async function ensureJournal(subject, scope, userId) {
  if (!game.user?.isGM) throw new Error("A GM must create NPC note Journals.");
  if (!subject?.actor || !subject.subjectUuid || !isValidScope(scope)) {
    throw new Error("Invalid NPC note request.");
  }
  if (scope === "personal" && !game.users.get(userId)) throw new Error("Unknown player.");
  const key = journalKey(subject.subjectUuid, scope, userId);
  if (inflight.has(key)) return inflight.get(key);
  const work = (async () => {
    const existing = findJournal(game.journal, subject.subjectUuid, scope, userId);
    if (existing) {
      if (scope === "shared") await ensureSharedPermissions(existing, subject.actor);
      return existing;
    }
    const folder = await ensureFolder();
    const requestingUser = game.users.get(userId);
    const title = scope === "shared"
      ? `${subject.actor.name} - Party Notes`
      : `${subject.actor.name} - ${requestingUser.name} Notes`;
    const ownership = buildOwnership(subject.actor, scope, userId, game.users, CONST.DOCUMENT_OWNERSHIP_LEVELS);
    const entry = await JournalEntry.implementation.create({
      name: title,
      folder: folder?.id ?? null,
      ownership,
      flags: {
        [MODULE_ID]: {
          [JOURNAL_FLAG]: {
            schema: SCHEMA,
            subjectUuid: subject.subjectUuid,
            scope,
            ...(scope === "personal" ? { userId } : {})
          }
        }
      },
      pages: [{
        name: "Notes",
        type: "text",
        text: { content: "<p></p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }
      }]
    });
    if (!entry) throw new Error("Foundry did not create the NPC notes Journal.");
    return entry;
  })();
  inflight.set(key, work);
  try { return await work; }
  finally { inflight.delete(key); }
}

/** Only entries created by this module have their access re-synchronized. */
export async function syncSharedJournals(onlySubjectUuid = null) {
  if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id) return 0;
  let count = 0;
  for (const entry of game.journal) {
    const link = journalLink(entry);
    if (link?.schema !== SCHEMA || link.scope !== "shared") continue;
    if (onlySubjectUuid && link.subjectUuid !== onlySubjectUuid) continue;
    const subject = await resolveSubject(link.subjectUuid);
    if (!subject) continue; // An orphaned note is preserved, never deleted.
    const expected = buildOwnership(subject.actor, "shared", null, game.users, CONST.DOCUMENT_OWNERSHIP_LEVELS);
    if (ownershipDiffers(entry.ownership, expected)) {
      await entry.update({ ownership: expected });
      count++;
    }
  }
  return count;
}