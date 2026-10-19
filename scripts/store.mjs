/**
 * G06 - AFT NPC Notes: v2 page-based storage (Foundry v14).
 * Native world Journals hold pages. No Actor/Token writes and no v1 migration.
 */
export const MODULE_ID = "player-npc-notes";
export const FOLDER_FLAG = "managedFolder";
export const COLLECTION_FLAG = "collectionLink";
export const PAGE_FLAG = "pageLink";
export const SCHEMA = 2;

const collectionInflight = new Map();
const pageInflight = new Map();
const UUID_PATTERN = /^(Actor\.[A-Za-z0-9]+|Scene\.[A-Za-z0-9]+\.Token\.[A-Za-z0-9]+)$/;

export function subjectUuidForActor(actor) {
  if (!actor || actor.documentName !== "Actor") return null;
  if (actor.token && !actor.token.actorLink) return actor.token.uuid ?? null;
  return actor.uuid ?? null;
}

/** One Actor across linked tokens, but each unlinked placed Token has its own identity. */
export function subjectUuidForToken(token) {
  const doc = token?.document?.documentName === "Token" ? token.document : token;
  if (doc?.documentName !== "Token" || typeof doc.uuid !== "string") return null;
  if (doc.actorLink) {
    if (!/^[A-Za-z0-9]+$/.test(doc.actorId ?? "")) return null;
    return `Actor.${doc.actorId}`;
  }
  return UUID_PATTERN.test(doc.uuid) ? doc.uuid : null;
}

export function kindForUuid(uuid) {
  if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) return null;
  return uuid.startsWith("Actor.") ? "recurring" : "scene";
}

export async function resolveSubject(subjectUuid, lookup = globalThis.fromUuid) {
  if (typeof subjectUuid !== "string" || subjectUuid.length > 256 || !kindForUuid(subjectUuid)) return null;
  const doc = await lookup(subjectUuid);
  if (doc?.documentName === "Actor" && !doc.inCompendium) {
    return { actor: doc, subjectUuid };
  }
  if (doc?.documentName === "Token" && doc.parent?.documentName === "Scene" && doc.actor) {
    return { actor: doc.actor, token: doc, subjectUuid, sceneId: doc.parent.id };
  }
  return null;
}

/** Sheet entry point still respects the game's Actor permissions. */
export function playerMayNote(actor, user) {
  return Boolean(actor && user && actor.testUserPermission?.(user, "LIMITED"));
}

export function isValidScope(scope) {
  return scope === "shared" || scope === "personal";
}

export function isValidKind(kind) {
  return kind === "recurring" || kind === "scene";
}

export function collectionKey(kind, scope, userId = "") {
  if (!isValidKind(kind) || !isValidScope(scope)) return null;
  if (scope === "personal" && !userId) return null;
  return `${scope}|${kind}|${scope === "personal" ? userId : ""}`;
}

export function collectionLink(entry) {
  return entry?.getFlag?.(MODULE_ID, COLLECTION_FLAG) ?? null;
}

export function pageLink(page) {
  return page?.getFlag?.(MODULE_ID, PAGE_FLAG) ?? null;
}

/** Only schema-2 collections are candidates; v0.2.1 noteLink Journals are ignored. */
export function findCollection(journals, kind, scope, userId = "") {
  if (!collectionKey(kind, scope, userId)) return null;
  return Array.from(journals).find(entry => {
    const link = collectionLink(entry);
    return link?.schema === SCHEMA && link.kind === kind && link.scope === scope &&
      (scope === "shared" || link.userId === userId);
  }) ?? null;
}

export function findPage(entry, subjectUuid) {
  if (!kindForUuid(subjectUuid)) return null;
  const pages = entry?.pages;
  if (!pages) return null;
  return Array.from(pages).find(page => {
    const link = pageLink(page);
    return link?.schema === SCHEMA && link.subjectUuid === subjectUuid;
  }) ?? null;
}

export function pageName(subject) {
  if (!kindForUuid(subject?.subjectUuid)) throw new Error("Invalid NPC page identity.");
  const clean = (s, fallback) => typeof s === "string" && s.trim() ? s.trim() : fallback;
  if (kindForUuid(subject.subjectUuid) === "recurring") {
    return clean(subject.actor?.name, "Unnamed NPC");
  }
  const tokenName = clean(subject.token?.name ?? subject.actor?.token?.name,
    clean(subject.actor?.name, "Unnamed Token"));
  const sceneName = clean(subject.token?.parent?.name, "Unknown Scene");
  return `${tokenName} [seen in ${sceneName}]`;
}

export function collectionName(kind, scope, userName = "") {
  if (!collectionKey(kind, scope, scope === "personal" ? "user" : "")) throw new Error("Invalid collection name.");
  const category = kind === "recurring" ? "Recurring NPCs" : "Scene NPCs";
  return scope === "shared" ? `Party \u2014 ${category}` :
    `${userName?.trim() || "Player"} \u2014 ${category} (Personal)`;
}

/**
 * Party collection is open to all world players now and future: default OWNER.
 * Private collection has default NONE and an explicit OWNER for its player.
 * Neither model changes Actor permission or modifies an existing Journal.
 */
export function collectionOwnership(scope, userId, users, levels) {
  if (scope === "shared") return { default: levels.OWNER };
  if (scope !== "personal") throw new Error("Invalid notes scope.");
  const user = Array.from(users).find(u => u.id === userId);
  if (!user) throw new Error("Player not found.");
  const ownership = { default: levels.NONE };
  if (!user.isGM) ownership[userId] = levels.OWNER;
  return ownership;
}

async function ensureFolder() {
  const found = game.folders.find(folder =>
    folder.type === "JournalEntry" && folder.getFlag?.(MODULE_ID, FOLDER_FLAG) === true
  );
  if (found) return found;
  return Folder.implementation.create({
    name: "AFT NPC Notes", type: "JournalEntry",
    flags: { [MODULE_ID]: { [FOLDER_FLAG]: true } }
  });
}

/** Active GM only; no creation or implicit adoption of old per-NPC Journals. */
export async function ensureCollection(kind, scope, userId) {
  if (!game.user?.isGM) throw new Error("An online GM is required to create an NPC Journal.");
  const key = collectionKey(kind, scope, userId);
  if (!key) throw new Error("Invalid NPC Journal category.");
  if (scope === "personal" && !game.users.get(userId)) throw new Error("Player not found.");
  if (collectionInflight.has(key)) return collectionInflight.get(key);
  const work = (async () => {
    const existing = findCollection(game.journal, kind, scope, userId);
    if (existing) return existing; // Never change an existing Journal or its ownership.
    const folder = await ensureFolder();
    const requester = scope === "personal" ? game.users.get(userId) : null;
    return JournalEntry.implementation.create({
      name: collectionName(kind, scope, requester?.name),
      folder: folder?.id ?? null,
      ownership: collectionOwnership(scope, userId, game.users, CONST.DOCUMENT_OWNERSHIP_LEVELS),
      flags: { [MODULE_ID]: { [COLLECTION_FLAG]: {
        schema: SCHEMA, kind, scope,
        ...(scope === "personal" ? { userId } : {})
      } } },
      pages: []
    });
  })();
  collectionInflight.set(key, work);
  try { return await work; }
  finally { collectionInflight.delete(key); }
}

/** One page per subject UUID per collection, guarded against concurrent first-clicks. */
export async function ensurePage(subject, scope, userId) {
  if (!game.user?.isGM) throw new Error("An online GM is required to create an NPC page.");
  const kind = kindForUuid(subject?.subjectUuid);
  if (!kind || !subject?.actor || !isValidScope(scope)) throw new Error("Invalid NPC page request.");
  if (scope === "personal" && !game.users.get(userId)) throw new Error("Player not found.");
  const key = `${collectionKey(kind, scope, userId)}|${subject.subjectUuid}`;
  if (pageInflight.has(key)) return pageInflight.get(key);
  const work = (async () => {
    const entry = await ensureCollection(kind, scope, userId);
    if (!entry) throw new Error("Could not create the NPC notes Journal.");
    let page = findPage(entry, subject.subjectUuid);
    if (page) return { entry, page };
    const created = await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name: pageName(subject), type: "text",
      text: { content: "<p></p>", format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
      flags: { [MODULE_ID]: { [PAGE_FLAG]: { schema: SCHEMA, subjectUuid: subject.subjectUuid } } }
    }]);
    page = created?.[0];
    if (!page) throw new Error("Foundry did not create the NPC notes page.");
    return { entry, page };
  })();
  pageInflight.set(key, work);
  try { return await work; }
  finally { pageInflight.delete(key); }
}
