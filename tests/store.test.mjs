import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  MODULE_ID, subjectUuidForActor, subjectUuidForToken, resolveSubject,
  playerMayNote, isValidScope, journalKey, findJournal, buildOwnership,
  ensureJournal, journalTitle, isLegacyGeneratedTitle
} from "../scripts/store.mjs";

let actors, users, journal, folders, created, updated, folderCreations, actorWrites;
function user(id, { isGM = false, role = 1 } = {}) {
  return { id, name: `User ${id}`, isGM, role };
}
function actor(id, accessible = []) {
  const obj = {
    id, name: `Secret Actor ${id}`, documentName: "Actor", uuid: `Actor.${id}`,
    accessible: new Set(accessible),
    testUserPermission: u => u.isGM || obj.accessible.has(u.id),
    async update() { actorWrites++; throw new Error("Actor must never be updated"); }
  };
  return obj;
}
function fakeJournal(data) {
  const entry = {
    id: `j${journal.length + 1}`, ...data,
    getFlag: (scope, key) => data.flags?.[scope]?.[key],
    testUserPermission: u => u.isGM || (entry.ownership[u.id] ?? entry.ownership.default) === 3,
    async update(change) { updated.push({ id: entry.id, change }); Object.assign(entry, change); },
    sheet: { render() {} }
  };
  journal.push(entry);
  return entry;
}
beforeEach(() => {
  actors = new Map();
  users = [user("gm", {isGM:true,role:4}),user("playerA"),user("playerB"),user("visitor", {role:0})];
  journal = []; folders = []; created = []; updated = [];
  actorWrites = 0; folderCreations = 0;
  const userCollection = {
    [Symbol.iterator]: () => users[Symbol.iterator](),
    get: id => users.find(u => u.id === id),
    get activeGM() { return users[0]; }
  };
  globalThis.game = { user: users[0], users:userCollection, journal, folders };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { NONE:0, LIMITED:1, OBSERVER:2, OWNER:3 },
    JOURNAL_ENTRY_PAGE_FORMATS: { HTML:1 }
  };
  globalThis.Folder = { implementation: {
    create: async data => {
      folderCreations++;
      const f = { ...data, id:"folderA", getFlag:(scope,key)=>data.flags?.[scope]?.[key] };
      folders.push(f); return f;
    }
  }};
  globalThis.JournalEntry = { implementation: {
    create: async data => { created.push(data); return fakeJournal(data); }
  }};
  globalThis.fromUuid = async uuid => actors.get(uuid) ?? null;
});

test("world Actors keep Actor UUID and unlinked synthetic Actors keep Token UUID", () => {
  const a = actor("foo");
  assert.equal(subjectUuidForActor(a), "Actor.foo");
  a.token = { actorLink:false, uuid:"Scene.scA.Token.tokA" };
  assert.equal(subjectUuidForActor(a), "Scene.scA.Token.tokA");
  a.token.actorLink = true;
  assert.equal(subjectUuidForActor(a), "Actor.foo");
  assert.equal(subjectUuidForActor({documentName:"Item"}),null);
});

test("Token UUID shortcut uses Actor UUID for linked and Token UUID for unlinked", () => {
  const doc = {
    documentName:"Token", uuid:"Scene.scA.Token.tokA", actorLink:true, actorId:"foo"
  };
  assert.equal(subjectUuidForToken(doc), "Actor.foo");
  assert.equal(subjectUuidForToken({document:doc}), "Actor.foo");
  doc.actorLink = false;
  assert.equal(subjectUuidForToken(doc), "Scene.scA.Token.tokA");
  doc.actorLink = true; doc.actorId = "bad id";
  assert.equal(subjectUuidForToken(doc), null);
  assert.equal(subjectUuidForToken({documentName:"Actor",uuid:"Actor.foo"}),null);
});

test("resolution accepts only saved world Actor or placed Token UUIDs", async () => {
  const a = actor("foo"); actors.set(a.uuid,a);
  const doc = {documentName:"Token",id:"tokA",parent:{documentName:"Scene",id:"scA"},actor:a};
  actors.set("Scene.scA.Token.tokA",doc);
  assert.deepEqual(await resolveSubject(a.uuid),{actor:a,subjectUuid:a.uuid});
  assert.deepEqual(await resolveSubject("Scene.scA.Token.tokA"),{
    actor:a,token:doc,subjectUuid:"Scene.scA.Token.tokA",sceneId:"scA"
  });
  assert.equal(await resolveSubject("Compendium.foo.Actor.a"),null);
  assert.equal(await resolveSubject("Actor.unknown"),null);
  assert.equal(await resolveSubject("Scene.scA.Token.foo.Actor.bar"),null);
  a.inCompendium=true;
  assert.equal(await resolveSubject(a.uuid),null);
});

test("Actor LIMITED checking remains only for sheet compatibility", () => {
  const a = actor("foo",["playerA"]);
  assert.equal(playerMayNote(a,users[1]),true);
  assert.equal(playerMayNote(a,users[2]),false);
  assert.equal(playerMayNote(a,users[0]),true);
});

test("scope keys distinguish personal notes but share one party Journal", () => {
  assert.equal(isValidScope("shared"),true);
  assert.equal(isValidScope("personal"),true);
  assert.equal(isValidScope("gm"),false);
  assert.equal(journalKey("Actor.foo","shared","a"),journalKey("Actor.foo","shared","b"));
  assert.notEqual(journalKey("Actor.foo","personal","a"),journalKey("Actor.foo","personal","b"));
});

test("new party Journals give edit rights to players, independent of NPC stats", () => {
  const a=actor("secret",[]);
  const ownership=buildOwnership(a,"shared","playerA",users,CONST.DOCUMENT_OWNERSHIP_LEVELS);
  assert.deepEqual(ownership,{default:0,playerA:3,playerB:3});
  assert.equal(ownership.gm,undefined);
  assert.equal(ownership.visitor,undefined);
});

test("new personal Journals only give rights to the author", () => {
  const a=actor("secret",[]);
  assert.deepEqual(buildOwnership(a,"personal","playerA",users,CONST.DOCUMENT_OWNERSHIP_LEVELS),{
    default:0,playerA:3
  });
  assert.deepEqual(buildOwnership(a,"personal","gm",users,CONST.DOCUMENT_OWNERSHIP_LEVELS),{
    default:0
  });
  assert.throws(()=>buildOwnership(a,"personal","missing",users,CONST.DOCUMENT_OWNERSHIP_LEVELS));
});

test("a shared note stores one Journal with a page, not an Actor mutation", async () => {
  const a=actor("foo",[]);
  const entry=await ensureJournal({actor:a,subjectUuid:a.uuid},"shared","playerA",{anonymous:true});
  assert.equal(entry.name,"Secret Actor foo - Party Notes");
  assert.equal(entry.pages[0].type,"text");
  assert.equal(entry.pages[0].text.content,"<p></p>");
  assert.equal(entry.pages[0].text.format,1);
  assert.equal(entry.ownership.playerA,3);
  assert.equal(entry.ownership.playerB,3);
  assert.equal(entry.flags[MODULE_ID].noteLink.subjectUuid,a.uuid);
  assert.equal(folderCreations,1);
  assert.equal(actorWrites,0);
});

test("linked notes use the real Actor name rather than a UUID fragment", async () => {
  const a=actor("foo");
  const entry=await ensureJournal({actor:a,subjectUuid:a.uuid},"shared","playerA");
  assert.equal(entry.name,"Secret Actor foo - Party Notes");
});

test("unlinked token names include their Scene and preserve the Token's own label", async () => {
  const a=actor("foo");
  const token={name:"Desk Sergeant",parent:{name:"Downtown Police Precinct"}};
  const subject={actor:a,token,subjectUuid:"Scene.scA.Token.tokA"};
  const entry=await ensureJournal(subject,"shared","playerA");
  assert.equal(entry.name,"Desk Sergeant [seen in Downtown Police Precinct] - Party Notes");
  assert.equal(entry.flags[MODULE_ID].noteLink.subjectUuid,subject.subjectUuid);
  const personal=await ensureJournal(subject,"personal","playerA");
  assert.equal(personal.name,"Desk Sergeant [seen in Downtown Police Precinct] - User playerA Notes");
});

test("only exact v0.2.0 generated titles are repaired on access", async () => {
  const a=actor("foo"); const subject={actor:a,subjectUuid:a.uuid};
  const entry=fakeJournal({
    name:"NPC foo - Party Notes", ownership:{default:0,playerA:3},
    pages:[{text:{content:"<p>My old notes stay put</p>"}}],
    flags:{[MODULE_ID]:{noteLink:{schema:1,subjectUuid:a.uuid,scope:"shared"}}}
  });
  assert.equal(isLegacyGeneratedTitle(entry,subject.subjectUuid,"shared"),true);
  const reopened=await ensureJournal(subject,"shared","playerA");
  assert.strictEqual(reopened,entry);
  assert.equal(entry.name,"Secret Actor foo - Party Notes");
  assert.deepEqual(updated,[{id:entry.id,change:{name:"Secret Actor foo - Party Notes"}}]);
  assert.equal(entry.pages[0].text.content,"<p>My old notes stay put</p>");
  assert.deepEqual(entry.ownership,{default:0,playerA:3});
  assert.equal(created.length,0);
  assert.strictEqual(await ensureJournal(subject,"shared","playerB"),entry);
  assert.equal(updated.length,1);
});

test("user-customized titles and unrelated Journal names remain unchanged", async () => {
  const a=actor("foo"); const subject={actor:a,subjectUuid:a.uuid};
  const custom=fakeJournal({name:"We met the captain",ownership:{default:0,playerA:3},
    flags:{[MODULE_ID]:{noteLink:{schema:1,subjectUuid:a.uuid,scope:"shared"}}}
  });
  assert.equal(isLegacyGeneratedTitle(custom,subject.subjectUuid,"shared"),false);
  await ensureJournal(subject,"shared","playerA");
  assert.equal(custom.name,"We met the captain");
  assert.equal(updated.length,0);
});

test("title builder falls back safely for an unnamed scene but keeps the UUID key", () => {
  const a=actor("foo");
  assert.equal(journalTitle({actor:a,subjectUuid:"Actor.foo"},"shared"),"Secret Actor foo - Party Notes");
  assert.equal(journalTitle({actor:a,subjectUuid:"Scene.scA.Token.tokA",token:{name:"Watchman",parent:{}}},"shared"),
    "Watchman [seen in Unknown Scene] - Party Notes");
});

test("personal notes are never returned as party or another player's", async () => {
  const a=actor("foo");
  const note=await ensureJournal({actor:a,subjectUuid:a.uuid},"personal","playerA");
  assert.equal(findJournal(journal,a.uuid,"personal","playerA"),note);
  assert.equal(findJournal(journal,a.uuid,"personal","playerB"),null);
  assert.equal(findJournal(journal,a.uuid,"shared","playerA"),null);
  assert.equal(note.ownership.playerB,undefined);
});

test("repeated and concurrent requests reuse Journal and folder without duplicates", async () => {
  const a=actor("foo"); const subject={actor:a,subjectUuid:a.uuid};
  const [first,second]=await Promise.all([
    ensureJournal(subject,"shared","playerA"),
    ensureJournal(subject,"shared","playerB")
  ]);
  assert.strictEqual(first,second);
  assert.strictEqual(first,await ensureJournal(subject,"shared","playerA"));
  assert.equal(created.length,1);
  assert.equal(folderCreations,1);
});

test("existing v0.1.1 party Journal permissions and content are not modified", async () => {
  const a=actor("foo"); const subject={actor:a,subjectUuid:a.uuid};
  const legacy=fakeJournal({
    name:"Old party notes", ownership:{default:0,playerA:3},
    pages:[{text:{content:"<p>Private legacy text</p>"}}],
    flags:{ [MODULE_ID]:{ noteLink:{schema:1,subjectUuid:a.uuid,scope:"shared"} } }
  });
  const again=await ensureJournal(subject,"shared","playerB");
  assert.strictEqual(again,legacy);
  assert.deepEqual(legacy.ownership,{default:0,playerA:3});
  assert.equal(legacy.pages[0].text.content,"<p>Private legacy text</p>");
  assert.equal(updated.length,0);
  assert.equal(created.length,0);
});

test("two different unlinked tokens get separate Journals", async () => {
  const a=actor("foo");
  const t1={actor:a,subjectUuid:"Scene.scA.Token.tokA"};
  const t2={actor:a,subjectUuid:"Scene.scA.Token.tokB"};
  const x=await ensureJournal(t1,"shared","playerA",{anonymous:true});
  const y=await ensureJournal(t2,"shared","playerA",{anonymous:true});
  assert.notEqual(x.id,y.id);
  assert.equal(journal.length,2);
});

test("invalid scope, missing user, non-GM cannot create Journal", async () => {
  const a=actor("foo"); const subject={actor:a,subjectUuid:a.uuid};
  await assert.rejects(ensureJournal(subject,"other","playerA"));
  await assert.rejects(ensureJournal(subject,"personal","missing"));
  game.user=users[1];
  await assert.rejects(ensureJournal(subject,"shared","playerA"),/GM/);
  assert.equal(created.length,0);
});

test("journal search ignores unrelated flags and old schema", () => {
  const invalid={getFlag:()=>({schema:0,subjectUuid:"Actor.foo",scope:"shared"})};
  assert.equal(findJournal([invalid],"Actor.foo","shared","playerA"),null);
});
