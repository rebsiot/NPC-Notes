import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  MODULE_ID, COLLECTION_FLAG, PAGE_FLAG, SCHEMA,
  subjectUuidForActor, subjectUuidForToken, resolveSubject, playerMayNote,
  isValidScope, kindForUuid, collectionKey, collectionName, pageName,
  collectionOwnership, findCollection, findPage, ensureCollection, ensurePage
} from "../scripts/store.mjs";

let users, journals, folders, actors, created, createdPages, journalUpdates, actorWrites;
function makeUser(id, { isGM = false, role = 1, name = id } = {}) {
  return { id, name, isGM, role };
}
function makeActor(id, allowed = []) {
  const actor = {
    id, name: `Secret ${id}`, uuid: `Actor.${id}`, documentName: "Actor",
    allowed: new Set(allowed),
    testUserPermission: u => u.isGM || actor.allowed.has(u.id),
    async update() { actorWrites++; throw new Error("Never write to Actors"); }
  };
  actors.set(actor.uuid, actor);
  return actor;
}
function makePage(data, entry) {
  const page = {
    id: `p${createdPages.length + 1}`, ...data,
    parent: entry, getFlag: (ns, key) => page.flags?.[ns]?.[key]
  };
  createdPages.push(page);
  return page;
}
function fakeJournal(data) {
  const entry = {
    id: `j${journals.length + 1}`, ...data,
    pages: [],
    getFlag: (ns, key) => entry.flags?.[ns]?.[key],
    testUserPermission: (user, level) => user.isGM ||
      (entry.ownership[user.id] ?? entry.ownership.default) >= (level === "OWNER" ? 3 : 1),
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "JournalEntryPage");
      const pages = data.map(item => makePage(item, entry));
      entry.pages.push(...pages);
      return pages;
    },
    async update(change) { journalUpdates.push(change); Object.assign(entry, change); },
    sheet: { render() {}, goToPage() {} }
  };
  entry.pages.push(...(data.pages || []));
  entry.pages.get = id => entry.pages.find(p => p.id === id);
  journals.push(entry);
  return entry;
}
beforeEach(() => {
  users = [makeUser("gm", { isGM: true, role: 4, name: "GM" }),
    makeUser("a", { name: "Alice" }), makeUser("b", { name: "Bob" })];
  journals = []; journals.get = id => journals.find(j => j.id === id);
  folders = []; actors = new Map(); created = []; createdPages = []; journalUpdates = []; actorWrites = 0;
  globalThis.game = { user: users[0],
    users: { get: id => users.find(u => u.id === id), [Symbol.iterator]: () => users[Symbol.iterator]() },
    journal: journals, folders };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 },
    JOURNAL_ENTRY_PAGE_FORMATS: { HTML: 1 } };
  globalThis.Folder = { implementation: { create: async data => {
    const folder = { id: "folder1", ...data, getFlag: (ns, k) => data.flags?.[ns]?.[k] };
    folders.push(folder); return folder;
  } } };
  globalThis.JournalEntry = { implementation: { create: async data => {
    created.push(data); return fakeJournal(data);
  } } };
  globalThis.fromUuid = async id => actors.get(id) ?? null;
});

test("UUID parsing distinguishes recurring Actors and per-scene unlinked Tokens", () => {
  const actor = makeActor("npc");
  assert.equal(subjectUuidForActor(actor), "Actor.npc");
  assert.equal(subjectUuidForActor({ documentName: "Item" }), null);
  actor.token = { actorLink: false, uuid: "Scene.map.Token.t1" };
  assert.equal(subjectUuidForActor(actor), "Scene.map.Token.t1");
  const doc = { documentName: "Token", uuid: "Scene.map.Token.t1", actorLink: true, actorId: "npc" };
  assert.equal(subjectUuidForToken(doc), "Actor.npc");
  assert.equal(subjectUuidForToken({ document: doc }), "Actor.npc");
  doc.actorLink = false;
  assert.equal(subjectUuidForToken(doc), "Scene.map.Token.t1");
  doc.actorLink = true; doc.actorId = "bad id";
  assert.equal(subjectUuidForToken(doc), null);
  assert.equal(kindForUuid("Actor.npc"), "recurring");
  assert.equal(kindForUuid("Scene.map.Token.t1"), "scene");
  assert.equal(kindForUuid("Compendium.foo.Actor.npc"), null);
  assert.equal(kindForUuid("Scene.map.Token.t1.Actor.npc"), null);
});

test("only saved world Actors and placed Token documents resolve", async () => {
  const actor = makeActor("npc");
  const token = { documentName: "Token", uuid: "Scene.map.Token.t1", name: "Guard",
    parent: { documentName: "Scene", id: "map", name: "Warehouse" }, actor };
  actors.set(token.uuid, token);
  assert.deepEqual(await resolveSubject(actor.uuid), { actor, subjectUuid: actor.uuid });
  assert.deepEqual(await resolveSubject(token.uuid),
    { actor, token, subjectUuid: token.uuid, sceneId: "map" });
  assert.equal(await resolveSubject("Actor.gone"), null);
  assert.equal(await resolveSubject("Scene.map.Token.t2"), null);
  actor.inCompendium = true;
  assert.equal(await resolveSubject(actor.uuid), null);
  assert.equal(await resolveSubject("Actor." + "x".repeat(300)), null);
});

test("sheet visibility remains limited to Actor permissions", () => {
  const actor = makeActor("npc", ["a"]);
  assert.equal(playerMayNote(actor, users[1]), true);
  assert.equal(playerMayNote(actor, users[2]), false);
  assert.equal(playerMayNote(actor, users[0]), true);
});

test("collection and page identity are independent of displayed names", () => {
  assert.equal(isValidScope("shared"), true);
  assert.equal(isValidScope("personal"), true);
  assert.equal(isValidScope("private"), false);
  assert.equal(collectionKey("recurring", "shared", "a"), collectionKey("recurring", "shared", "b"));
  assert.notEqual(collectionKey("recurring", "personal", "a"), collectionKey("recurring", "personal", "b"));
  assert.notEqual(collectionKey("recurring", "shared"), collectionKey("scene", "shared"));
  assert.equal(collectionKey("bad", "shared"), null);
  assert.equal(collectionKey("scene", "personal"), null);
  assert.equal(collectionName("recurring", "shared"), "Party \u2014 Recurring NPCs");
  assert.equal(collectionName("scene", "shared"), "Party \u2014 Scene NPCs");
  assert.equal(collectionName("recurring", "personal", "Alice"), "Alice \u2014 Recurring NPCs (Personal)");
});

test("page names use Actor names for linked NPCs, Token/Scene for unlinked", () => {
  const actor = makeActor("npc");
  assert.equal(pageName({ actor, subjectUuid: actor.uuid }), "Secret npc");
  assert.equal(pageName({ actor, subjectUuid: "Scene.map.Token.t1",
    token: { name: "Security Guard", parent: { name: "Night Club" } } }),
  "Security Guard [seen in Night Club]");
  assert.equal(pageName({ actor, subjectUuid: "Scene.map.Token.t1", token: { name: "", parent: {} } }),
    "Secret npc [seen in Unknown Scene]");
  assert.throws(() => pageName({ subjectUuid: "bad" }), /Invalid/);
});

test("shared journals grant all current and future players edit access", () => {
  assert.deepEqual(collectionOwnership("shared", "a", users, CONST.DOCUMENT_OWNERSHIP_LEVELS),
    { default: 3 });
});

test("personal journals grant no other player access and GMs retain implicit access", () => {
  assert.deepEqual(collectionOwnership("personal", "a", users, CONST.DOCUMENT_OWNERSHIP_LEVELS),
    { default: 0, a: 3 });
  assert.deepEqual(collectionOwnership("personal", "gm", users, CONST.DOCUMENT_OWNERSHIP_LEVELS),
    { default: 0 });
  assert.throws(() => collectionOwnership("personal", "missing", users, CONST.DOCUMENT_OWNERSHIP_LEVELS));
});

test("first shared page creates one consolidated Journal and a flagged page", async () => {
  const actor = makeActor("npc");
  const { entry, page } = await ensurePage({ actor, subjectUuid: actor.uuid }, "shared", "a");
  assert.equal(entry.name, "Party \u2014 Recurring NPCs");
  assert.equal(page.name, "Secret npc");
  assert.equal(page.text.content, "<p></p>");
  assert.equal(page.text.format, 1);
  assert.deepEqual(entry.flags[MODULE_ID][COLLECTION_FLAG],
    { schema: SCHEMA, kind: "recurring", scope: "shared" });
  assert.deepEqual(page.flags[MODULE_ID][PAGE_FLAG], { schema: SCHEMA, subjectUuid: actor.uuid });
  assert.equal(entry.ownership.default, 3);
  assert.equal(folders.length, 1);
  assert.equal(actorWrites, 0);
});

test("two recurring NPCs become pages within the same Journal", async () => {
  const a = makeActor("alpha"); const b = makeActor("beta");
  const first = await ensurePage({ actor: a, subjectUuid: a.uuid }, "shared", "a");
  const second = await ensurePage({ actor: b, subjectUuid: b.uuid }, "shared", "b");
  assert.strictEqual(first.entry, second.entry);
  assert.notEqual(first.page.id, second.page.id);
  assert.equal(journals.length, 1);
  assert.equal(journals[0].pages.length, 2);
});

test("two scene NPCs from one Actor template get different pages, same Journal", async () => {
  const actor = makeActor("guard");
  const t1 = { actor, subjectUuid: "Scene.map.Token.t1", token: {name:"Guard",parent:{name:"Warehouse"}} };
  const t2 = { actor, subjectUuid: "Scene.map.Token.t2", token: {name:"Guard",parent:{name:"Warehouse"}} };
  const a = await ensurePage(t1, "shared", "a");
  const b = await ensurePage(t2, "shared", "a");
  assert.equal(journals.length, 1);
  assert.equal(a.entry.name, "Party \u2014 Scene NPCs");
  assert.notEqual(a.page.id, b.page.id);
  assert.equal(a.page.name, b.page.name);
  assert.equal(a.page.flags[MODULE_ID].pageLink.subjectUuid, t1.subjectUuid);
  assert.equal(b.page.flags[MODULE_ID].pageLink.subjectUuid, t2.subjectUuid);
});

test("separate shared Journals for recurring and scene NPCs", async () => {
  const actor = makeActor("guard");
  const recurring = await ensurePage({ actor, subjectUuid: actor.uuid }, "shared", "a");
  const scene = await ensurePage({ actor, subjectUuid: "Scene.map.Token.t1" }, "shared", "a");
  assert.notEqual(recurring.entry.id, scene.entry.id);
  assert.equal(journals.length, 2);
  assert.equal(folders.length, 1);
});

test("two private Journals per player and no cross-player Journal sharing", async () => {
  const actor = makeActor("guard");
  await ensurePage({ actor, subjectUuid: actor.uuid }, "personal", "a");
  await ensurePage({ actor, subjectUuid: "Scene.map.Token.t1" }, "personal", "a");
  await ensurePage({ actor, subjectUuid: actor.uuid }, "personal", "b");
  await ensurePage({ actor, subjectUuid: "Scene.map.Token.t1" }, "personal", "b");
  assert.equal(journals.length, 4);
  assert.equal(journals.every(j => j.ownership.default === 0), true);
  assert.equal(journals.filter(j => j.ownership.a === 3).length, 2);
  assert.equal(journals.filter(j => j.ownership.b === 3).length, 2);
  assert.equal(findCollection(journals, "recurring", "personal", "a").testUserPermission(users[2], "OWNER"), false);
});

test("one subject in party and private creates one page in each category", async () => {
  const actor = makeActor("target");
  const party = await ensurePage({ actor, subjectUuid: actor.uuid }, "shared", "a");
  const personal = await ensurePage({ actor, subjectUuid: actor.uuid }, "personal", "a");
  assert.notEqual(party.entry.id, personal.entry.id);
  assert.notEqual(party.page.id, personal.page.id);
});

test("repeated and concurrent creates reuse a single page and Journal", async () => {
  const actor = makeActor("guard"); const subject = {actor,subjectUuid:actor.uuid};
  const [first, second, third] = await Promise.all([
    ensurePage(subject, "shared", "a"), ensurePage(subject, "shared", "b"),
    ensurePage(subject, "shared", "a")
  ]);
  assert.strictEqual(first.entry, second.entry);
  assert.strictEqual(first.page, third.page);
  assert.equal(journals.length, 1);
  assert.equal(journals[0].pages.length, 1);
});

test("old per-NPC notes remain unchanged, not migrated or implicitly reused", async () => {
  const actor = makeActor("target");
  const legacy = fakeJournal({
    name: "Secret target - Party Notes", ownership: {default:0,a:3},
    flags:{[MODULE_ID]:{noteLink:{schema:1,scope:"shared",subjectUuid:actor.uuid}}}
  });
  const oldPage = makePage({name:"Notes",text:{content:"<p>Old content</p>"}},legacy);
  legacy.pages.push(oldPage);
  const oldId = legacy.id;
  const newer = await ensurePage({actor,subjectUuid:actor.uuid},"shared","a");
  assert.notEqual(newer.entry.id,oldId);
  assert.equal(journals.length,2);
  assert.equal(legacy.pages[0].text.content,"<p>Old content</p>");
  assert.deepEqual(legacy.ownership,{default:0,a:3});
  assert.equal(journalUpdates.length,0);
  assert.equal(findCollection([legacy],"recurring","shared"),null);
});

test("manual page titles and note HTML persist across reopening", async () => {
  const actor = makeActor("target"); const subject = {actor,subjectUuid:actor.uuid};
  const first = await ensurePage(subject,"shared","a");
  first.page.name = "My nickname";
  first.page.text.content = "<p>Found the artifact</p>";
  actor.name = "Different NPC name";
  const next = await ensurePage(subject,"shared","a");
  assert.strictEqual(first.page,next.page);
  assert.equal(next.page.name,"My nickname");
  assert.equal(next.page.text.content,"<p>Found the artifact</p>");
  assert.equal(journalUpdates.length,0);
});

test("new pages inherit existing personal Journal ownership without rewrites", async () => {
  const a=makeActor("alpha"), b=makeActor("beta");
  const one=await ensurePage({actor:a,subjectUuid:a.uuid},"personal","a");
  one.entry.ownership={default:0,a:3};
  const two=await ensurePage({actor:b,subjectUuid:b.uuid},"personal","a");
  assert.strictEqual(one.entry,two.entry);
  assert.deepEqual(two.entry.ownership,{default:0,a:3});
  assert.equal(journalUpdates.length,0);
});

test("unflagged Journals and unflagged pages are never taken over", async () => {
  const a=makeActor("target");
  const untagged=fakeJournal({name:"Party \u2014 Recurring NPCs",ownership:{default:3}});
  const untaggedPage=makePage({name:a.name},untagged);untagged.pages.push(untaggedPage);
  const opened=await ensurePage({actor:a,subjectUuid:a.uuid},"shared","a");
  assert.notStrictEqual(opened.entry,untagged);
  assert.notStrictEqual(opened.page,untaggedPage);
  assert.equal(journals.length,2);
});

test("only active GM is allowed to create collections and pages", async () => {
  const actor=makeActor("target");
  game.user=users[1];
  await assert.rejects(ensurePage({actor,subjectUuid:actor.uuid},"shared","a"),/GM/);
  await assert.rejects(ensureCollection("scene","shared","a"),/GM/);
  assert.equal(journals.length,0);
});

test("invalid scope, malformed UUID, deleted user cannot create notes", async () => {
  const actor=makeActor("target");
  await assert.rejects(ensurePage({actor,subjectUuid:actor.uuid},"other","a"),/Invalid/);
  await assert.rejects(ensurePage({actor,subjectUuid:"bad uuid"},"shared","a"),/Invalid/);
  await assert.rejects(ensurePage({actor,subjectUuid:actor.uuid},"personal","missing"),/Player/);
  assert.equal(journals.length,0);
});
