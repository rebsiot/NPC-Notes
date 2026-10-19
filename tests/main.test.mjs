import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const hooks = new Map();
globalThis.Hooks = {
  on(name,fn) { hooks.set(name,fn); },
  once(name,fn) { hooks.set(name,fn); }
};
globalThis.foundry = {
  utils: { randomID: () => "abcdef0123456789" },
  applications: { api: { DialogV2: { wait: async () => "shared" } } }
};
globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: {NONE:0,OWNER:3},
  JOURNAL_ENTRY_PAGE_FORMATS: {HTML:1}
};
const { openChooser, openNotes } = await import("../scripts/main.mjs");

let users, actors, folders, journal, queries, logErrors, rendered, gameModules, notificationErrors;
const callback = (name) => { assert.ok(hooks.has(name),`missing ${name}`); return hooks.get(name); };

function makeActor(id, authorized = ["a"]) {
  const a = { documentName:"Actor", id, uuid:`Actor.${id}`, name:`NPC ${id}`,
    accessible:authorized,
    testUserPermission: (u) => u.isGM || a.accessible.includes(u.id)
  };
  actors.set(a.uuid,a);
  return a;
}
function makeEntry(data) {
  const entry = {id:`n${journal.length}`,...data,
    getFlag:(scope,key) => data.flags?.[scope]?.[key],
    testUserPermission:(u,level)=> u.isGM || entry.ownership[u.id] >= (level === "OWNER" ? 3 : 1),
    update:async change => Object.assign(entry,change),
    sheet:{ render:()=>rendered.push(entry.id) }
  };
  journal.push(entry);
  return entry;
}

beforeEach(() => {
  users = [
    {id:"gm",name:"GM",active:true,isGM:true,role:4,viewedScene:"scA",can:()=>true},
    {id:"a",name:"Alice",active:true,isGM:false,role:1,viewedScene:"scA",can:()=>true},
    {id:"b",name:"Bob",active:true,isGM:false,role:1,viewedScene:"scB",can:()=>true}
  ];
  actors = new Map(); folders = []; journal = []; journal.get = id => journal.find(e => e.id === id); queries = [];
  logErrors = []; rendered = []; notificationErrors = [];
  const userCollection = {
    [Symbol.iterator]: () => users[Symbol.iterator](),
    get: id => users.find(u => u.id===id),
    get activeGM() { return users[0]; }
  };
  gameModules = new Map([["player-npc-notes",{}]]);
  globalThis.CONFIG = {queries:{}};
  for (const user of users) user.query = async (name, data) => {
    queries.push({target:user.id,name,data});
    const caller = game.user;
    try {
      game.user = user;
      if (!CONFIG.queries[name]) throw new Error(`Unknown query ${name}`);
      return await CONFIG.queries[name](data);
    } finally { game.user = caller; }
  };
  globalThis.game = {
    user:users[0], users:userCollection, modules:gameModules,
    folders,journal
  };
  globalThis.ui = {notifications:{error:(msg)=>notificationErrors.push(msg)}};
  globalThis.Folder = {implementation:{create:async data=>{
    const folder={id:"folder1",...data,getFlag:(scope,key)=>data.flags?.[scope]?.[key]};
    folders.push(folder);return folder;
  }}};
  globalThis.JournalEntry={implementation:{create:async data=>makeEntry(data)}};
  globalThis.fromUuid=async uuid=>actors.get(uuid) ?? null;
  // Hooks.once('ready') is normally fired only once; invoke manually here to test startup.
  callback("ready")();
});

test("registers a working module API without a game-system dependency", () => {
  const api = gameModules.get("player-npc-notes").api;
  assert.equal(typeof api.open,"function");
  assert.equal(typeof api.openShared,"function");
  assert.equal(typeof api.openPersonal,"function");
  assert.equal(api.version,"0.1.0");
  assert.equal(typeof CONFIG.queries["player-npc-notes.ensure"],"function");
  assert.equal(typeof CONFIG.queries["player-npc-notes.confirm"],"function");
});

test("Actor V2 header notes control added once only to visible Actors", () => {
  const visible = makeActor("visible",["a"]);
  const hidden = makeActor("hidden",[]);
  game.user = users[1];
  const controls=[];
  callback("getHeaderControlsApplicationV2")({document:visible},controls);
  callback("getHeaderControlsApplicationV2")({document:visible},controls);
  assert.equal(controls.length,1);
  assert.equal(controls[0].label,"Player Notes");
  assert.equal(controls[0].action,"pnn-notes");
  const other=[];
  callback("getHeaderControlsApplicationV2")({document:hidden},other);
  assert.equal(other.length,0);
});

test("legacy Actor header control is idempotent and actor-specific", () => {
  const npc = makeActor("a");
  game.user=users[1];
  const buttons=[];
  callback("getApplicationHeaderButtons")({actor:npc},buttons);
  callback("getApplicationHeaderButtons")({actor:npc},buttons);
  assert.equal(buttons.length,1);
  assert.equal(buttons[0].class,"pnn-notes");
  assert.equal(buttons[0].icon,"fas fa-book-open");
});

test("GM creates one party Journal and opens it in the native sheet", async () => {
  const npc=makeActor("a");
  const result=await openNotes(npc,"shared");
  assert.equal(result.name,"NPC a - Party Notes");
  assert.equal(journal.length,1);
  assert.deepEqual(rendered,[result.id]);
  assert.equal(folders.length,1);
  await openNotes(npc,"shared");
  assert.equal(journal.length,1);
});

test("private notes created by GM have no other player access", async () => {
  const npc=makeActor("a");
  const result=await openNotes(npc,"personal");
  assert.equal(result.ownership.default,0);
  assert.equal(result.ownership.a,undefined);
  assert.equal(result.ownership.b,undefined);
});

test("query rejects spoofed claims without a matching pending client request", async () => {
  makeActor("secret",["a"]);
  const ensure = CONFIG.queries["player-npc-notes.ensure"];
  const forged = {requestId:"abcdef0123456789",subjectUuid:"Actor.secret",scope:"personal",userId:"a"};
  const response = await ensure(forged);
  assert.equal(journal.length,0);
  assert.match(response.error,/Unable to create/);
  assert.deepEqual(queries.map(q=>q.target),["a"]);
});

test("query refuses malformed requests before creating Journals", async () => {
  makeActor("a");
  const ensure = CONFIG.queries["player-npc-notes.ensure"];
  assert.ok((await ensure({requestId:"short",scope:"shared",subjectUuid:"Actor.a",userId:"a"})).error);
  assert.ok((await ensure({requestId:"abcdef0123456789",scope:"admin",subjectUuid:"Actor.a",userId:"a"})).error);
  assert.ok((await ensure({requestId:"abcdef0123456789",scope:"shared",subjectUuid:"Actor.a",userId:"missing"})).error);
  assert.equal(journal.length,0);
});

test("query cannot produce Journals for unauthenticated offline users", async () => {
  makeActor("a");
  users[1].active=false;
  const response=await CONFIG.queries["player-npc-notes.ensure"]({
    requestId:"abcdef0123456789",subjectUuid:"Actor.a",scope:"shared",userId:"a"
  });
  assert.match(response.error,/unavailable/);
  assert.equal(journal.length,0);
});

test("player opening a previously created Journal needs no GM proxy request", async () => {
  const npc=makeActor("a");
  await openNotes(npc,"shared");
  game.user=users[1];
  queries.length=0;
  await openNotes(npc,"shared");
  assert.equal(queries.length,0);
  assert.equal(rendered.length,2);
});

test("Player Notes chooser opens the requested scope", async () => {
  const npc=makeActor("a");
  await openChooser(npc);
  assert.deepEqual(rendered,["n0"]);
  assert.equal(notificationErrors.length,0);
});


test("player creates their first note using a two-way Foundry user query", async () => {
  const npc=makeActor("a");
  game.user=users[1];
  assert.equal(journal.length,0);
  const opened=await openNotes(npc,"shared");
  assert.equal(opened.id,"n0");
  assert.equal(journal.length,1);
  assert.deepEqual(queries.map(q=>q.target),["gm","a"]);
  assert.deepEqual(queries.map(q=>q.name),["player-npc-notes.ensure","player-npc-notes.confirm"]);
  assert.deepEqual(rendered,["n0"]);
});

test("GM refuses a claimed player when their Actor visibility is missing", async () => {
  const npc=makeActor("secret",["b"]);
  game.user=users[1];
  await assert.rejects(openNotes(npc,"shared"),/access/);
  assert.equal(journal.length,0);
});

test("token HUD notes control appears only on accessible NPCs and does not duplicate", () => {
  const npc=makeActor("a");
  game.user=users[1];
  class Element {
    constructor() { this.children=[]; this.attrs={}; this.className=""; }
    querySelector(s) {
      if (s === ".col.right") return this;
      if (s === ".pnn-token-button") return this.children.find(c=>c.className.includes("pnn-token-button")) ?? null;
      return null;
    }
    setAttribute(k,v) {this.attrs[k]=v;}
    append(v) {this.children.push(v);}
    addEventListener(k,fn) {this[k]=fn;}
  }
  globalThis.HTMLElement=Element;
  globalThis.document={createElement:()=>new Element()};
  const root=new Element();
  const callbackHUD=callback("renderTokenHUD");
  callbackHUD({object:{actor:npc}},root);
  callbackHUD({object:{actor:npc}},root);
  assert.equal(root.children.length,1);
  assert.equal(root.children[0].title,"Player NPC Notes");
  const denied=makeActor("denied",[]);
  const root2=new Element();
  callbackHUD({object:{actor:denied}},root2);
  assert.equal(root2.children.length,0);
});