import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { hooks.set(name, fn); },
  once(name, fn) { hooks.set(name, fn); }
};
globalThis.foundry = {
  utils: { randomID: () => "abcdef0123456789" },
  applications: { api: { DialogV2: { wait: async () => "shared" } } }
};
globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: {NONE:0,OWNER:3},
  JOURNAL_ENTRY_PAGE_FORMATS: {HTML:1}
};
const { openChooser, openNotes, openTokenNotes, isVisibleToken } =
  await import("../scripts/main.mjs");

let users, actors, tokenDocs, tokens, folders, journal, queries, rendered, gameModules, notifications;
let board;
const callback = name => { assert.ok(hooks.has(name),`missing ${name}`); return hooks.get(name); };

class Node {
  constructor() {
    this.children=[]; this.attrs={}; this.className="";
    this.style={}; this.listeners={}; this.parentElement=null;
  }
  querySelector(selector) {
    if (selector === ".col.right") return this;
    if (selector === ".pnn-token-button") return this.children.find(c => c.className.includes("pnn-token-button")) ?? null;
    return null;
  }
  setAttribute(k,v) { this.attrs[k]=v; }
  append(child) { child.parentElement=this; this.children.push(child); }
  addEventListener(k,fn) { this.listeners[k]=fn; }
  remove() {
    if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(n=>n!==this);
    this.parentElement=null;
  }
  getBoundingClientRect() { return {left:0,top:0,width:1000,height:1000}; }
  event(name) {
    return this.listeners[name]?.({preventDefault(){},stopPropagation(){}});
  }
}

globalThis.HTMLElement=Node;
function makeActor(id, permitted = []) {
  const a = {
    documentName:"Actor", id, uuid:`Actor.${id}`, name:`Secret ${id}`,
    permitted:new Set(permitted),
    testUserPermission:u => u.isGM || a.permitted.has(u.id)
  };
  actors.set(a.uuid,a);
  return a;
}
function makeToken(id, actor, { linked=true, sceneId="scA", visible=true, hidden=false }={}) {
  const doc={
    id,documentName:"Token",uuid:`Scene.${sceneId}.Token.${id}`,
    parent:{documentName:"Scene",id:sceneId},
    actorId:actor.id, actorLink:linked,hidden,actor
  };
  const token={document:doc,isVisible:visible,isPreview:false,
    center:{x:250,y:280},w:100,h:100};
  tokens.set(id,token); tokenDocs.set(doc.uuid,doc);
  return token;
}
function makeEntry(data) {
  const entry={
    id:`j${journal.length}`,...data,
    getFlag:(ns,k)=>entry.flags?.[ns]?.[k],
    testUserPermission:(user,level)=>user.isGM || (entry.ownership[user.id] ?? entry.ownership.default) >=
      (level==="OWNER"?3:1),
    update:async change=>Object.assign(entry,change),
    sheet:{render:()=>rendered.push(entry.id)}
  };
  journal.push(entry); return entry;
}

beforeEach(() => {
  users=[
    {id:"gm",name:"GM",active:true,isGM:true,role:4,viewedScene:"scA",can:()=>true},
    {id:"a",name:"Alice",active:true,isGM:false,role:1,viewedScene:"scA",can:()=>true},
    {id:"b",name:"Bob",active:true,isGM:false,role:1,viewedScene:"scA",can:()=>true}
  ];
  actors=new Map();tokenDocs=new Map();tokens=new Map();folders=[];journal=[];journal.get=id=>journal.find(j=>j.id===id);queries=[];rendered=[];notifications=[];
  board=new Node();
  const userCollection={
    [Symbol.iterator]:()=>users[Symbol.iterator](),
    get:id=>users.find(u=>u.id===id),
    get activeGM(){return users[0];}
  };
  gameModules=new Map([["player-npc-notes",{}]]);
  globalThis.CONFIG={queries:{}};
  globalThis.game={user:users[0],users:userCollection,modules:gameModules,folders,journal};
  globalThis.canvas={
    ready:true,scene:{id:"scA"},hud:{element:board},
    tokens:{get:id=>tokens.get(id),get placeables(){return Array.from(tokens.values());}},
    stage:{worldTransform:{apply:p=>({...p})}}
  };
  globalThis.document={createElement:()=>new Node(),getElementById:id=>id==="board"?board:null};
  globalThis.ui={notifications:{error:message=>notifications.push(message)}};
  globalThis.Folder={implementation:{create:async data=>{
    const f={id:"folderA",...data,getFlag:(ns,k)=>data.flags?.[ns]?.[k]};
    folders.push(f);return f;
  }}};
  globalThis.JournalEntry={implementation:{create:async data=>makeEntry(data)}};
  globalThis.fromUuid=async uuid=>actors.get(uuid) ?? tokenDocs.get(uuid) ?? null;
  for(const user of users) user.query=async(name,data)=>{
    queries.push({user:user.id,name,data});
    const old=game.user,scene=canvas.scene.id;
    try {
      game.user=user;canvas.scene.id=user.viewedScene;
      if(!CONFIG.queries[name])throw new Error(`Missing query ${name}`);
      return await CONFIG.queries[name](data);
    } finally {game.user=old;canvas.scene.id=scene;}
  };
  callback("ready")();
  callback("canvasReady")();
});

test("API is system agnostic and includes token shortcut", () => {
  const api=gameModules.get("player-npc-notes").api;
  assert.equal(api.version,"0.2.0");
  assert.equal(typeof api.openFromToken,"function");
  assert.equal(typeof api.openPersonalFromToken,"function");
  assert.equal(typeof CONFIG.queries["player-npc-notes.ensure"],"function");
  assert.equal(typeof CONFIG.queries["player-npc-notes.confirm"],"function");
});

test("old Actor sheet entry point remains permission-limited", () => {
  const a=makeActor("A",["a"]);
  const b=makeActor("B",[]);
  game.user=users[1];
  const controls=[];
  callback("getHeaderControlsApplicationV2")({document:a},controls);
  callback("getHeaderControlsApplicationV2")({document:a},controls);
  assert.equal(controls.length,1);
  assert.equal(controls[0].label,"NPC Notes");
  const others=[];
  callback("getHeaderControlsApplicationV2")({document:b},others);
  assert.equal(others.length,0);
  const legacy=[];
  callback("getApplicationHeaderButtons")({actor:a},legacy);
  assert.equal(legacy.length,1);
  assert.equal(legacy[0].class,"pnn-notes");
});

test("GM creates existing Actor-sheet party Journal and reuses it", async () => {
  const a=makeActor("A");
  const first=await openNotes(a,"shared");
  assert.equal(first.name,"NPC A - Party Notes");
  await openNotes(a,"shared");
  assert.equal(journal.length,1);
  assert.deepEqual(rendered,[first.id,first.id]);
});

test("player with no NPC Actor permission creates notes from visible token", async () => {
  const a=makeActor("A",[]);
  const token=makeToken("tokA",a);
  game.user=users[1];
  assert.equal(a.testUserPermission(game.user,"LIMITED"),false);
  const entry=await openTokenNotes(token);
  assert.equal(entry.name,"NPC A - Party Notes");
  assert.equal(entry.ownership.a,3);
  assert.equal(entry.ownership.b,3);
  assert.equal(journal.length,1);
  assert.deepEqual(queries.map(q=>q.user),["gm","a"]);
  assert.equal(queries[0].data.source,"token");
  assert.equal(queries[0].data.tokenUuid,token.document.uuid);
  assert.deepEqual(rendered,[entry.id]);
});

test("linked tokens in two scenes share the same Actor UUID Journal", async () => {
  const a=makeActor("NPC",[]);
  const one=makeToken("one",a);
  const two=makeToken("two",a);
  await openTokenNotes(one);
  await openTokenNotes(two);
  assert.equal(journal.length,1);
  assert.equal(journal[0].flags["player-npc-notes"].noteLink.subjectUuid,"Actor.NPC");
});

test("unlinked tokens get independent Journal UUIDs", async () => {
  const a=makeActor("NPC",[]);
  const one=makeToken("one",a,{linked:false});
  const two=makeToken("two",a,{linked:false});
  await openTokenNotes(one);
  await openTokenNotes(two);
  assert.equal(journal.length,2);
  assert.equal(journal[0].flags["player-npc-notes"].noteLink.subjectUuid,one.document.uuid);
  assert.equal(journal[1].flags["player-npc-notes"].noteLink.subjectUuid,two.document.uuid);
});

test("existing Journal access is never automatically broadened", async () => {
  const a=makeActor("NPC",[]);
  const token=makeToken("tok",a);
  journal.push({
    id:"old",ownership:{default:0,a:3},
    getFlag:(ns,k)=>ns==="player-npc-notes"&&k==="noteLink"?{
      schema:1,subjectUuid:"Actor.NPC",scope:"shared"
    }:null,
    testUserPermission:u=>u.isGM||u.id==="a",
    sheet:{render:()=>rendered.push("old")}
  });
  game.user=users[2];
  await assert.rejects(openTokenNotes(token),/Journal Owner access/);
  assert.deepEqual(journal[0].ownership,{default:0,a:3});
  assert.equal(queries.length,0);
  game.user=users[1];
  await openTokenNotes(token);
  assert.deepEqual(rendered,["old"]);
});

test("new personal token notes remain private to one player", async () => {
  const a=makeActor("NPC",[]);const token=makeToken("tok",a);
  game.user=users[1];
  const entry=await openTokenNotes(token,"personal");
  assert.equal(entry.ownership.a,3);
  assert.equal(entry.ownership.b,undefined);
  game.user=users[2];
  await openTokenNotes(token,"personal");
  assert.equal(journal.length,2);
  assert.equal(journal[1].ownership.b,3);
  assert.equal(journal[1].ownership.a,undefined);
});

test("hidden token cannot open notes even with UUID known", async () => {
  const a=makeActor("NPC",[]);
  const token=makeToken("hidden",a,{hidden:true});
  game.user=users[1];
  assert.equal(isVisibleToken(token),false);
  await assert.rejects(openTokenNotes(token),/visible token/);
  assert.equal(journal.length,0);
});

test("token outside player vision cannot open notes", async () => {
  const a=makeActor("NPC",[]);
  const token=makeToken("unseen",a,{visible:false});
  game.user=users[1];
  await assert.rejects(openTokenNotes(token),/visible token/);
  assert.equal(journal.length,0);
});

test("token on another Scene cannot open notes", async () => {
  const a=makeActor("NPC",[]);
  const token=makeToken("remote",a,{sceneId:"scB"});
  game.user=users[1];
  await assert.rejects(openTokenNotes(token),/visible token/);
  assert.equal(journal.length,0);
});

test("GM refuses a scene-switched token before Journal creation", async () => {
  const a=makeActor("NPC",[]);
  const token=makeToken("tok",a);
  game.user=users[1];
  const originalQuery=users[0].query;
  users[0].query=async (name,data) => {
    users[1].viewedScene="scB";
    return originalQuery(name,data);
  };
  await assert.rejects(openTokenNotes(token),/did not confirm|not available/);
  assert.equal(journal.length,0);
});

test("GM refuses forged query without genuine pending request", async () => {
  const a=makeActor("NPC",[]);makeToken("tok",a);
  const response=await CONFIG.queries["player-npc-notes.ensure"]({
    requestId:"abcdef0123456789",subjectUuid:a.uuid,scope:"shared",
    userId:"a",source:"token",tokenUuid:"Scene.scA.Token.tok"
  });
  assert.match(response.error,/did not confirm/);
  assert.equal(journal.length,0);
});

test("GM refuses offline user and malformed requests", async () => {
  const a=makeActor("NPC",[]);makeToken("tok",a);
  const request={
    requestId:"abcdef0123456789",subjectUuid:a.uuid,scope:"shared",
    userId:"a",source:"token",tokenUuid:"Scene.scA.Token.tok"
  };
  assert.ok((await CONFIG.queries["player-npc-notes.ensure"]({...request,scope:"x"})).error);
  users[1].active=false;
  assert.match((await CONFIG.queries["player-npc-notes.ensure"](request)).error,/unavailable/);
  assert.equal(journal.length,0);
});

test("sheet API still uses authenticated Actor LIMITED access",async () => {
  const a=makeActor("NPC",[]);
  game.user=users[1];
  await assert.rejects(openNotes(a,"shared"),/sheet/);
  a.permitted.add("a");
  const e=await openNotes(a,"shared");
  assert.equal(e.flags["player-npc-notes"].noteLink.subjectUuid,a.uuid);
});

test("hover icon appears for a visible NPC not owned by player", () => {
  const a=makeActor("NPC",[]);const token=makeToken("tok",a);
  game.user=users[1];
  callback("hoverToken")(token,true);
  assert.equal(board.children.length,1);
  assert.equal(board.children[0].className,"pnn-hover-button");
  assert.equal(board.children[0].attrs["aria-label"],"Open NPC Party Notes");
  assert.equal(board.children[0].style.left,"279px");
  callback("hoverToken")(token,true);
  assert.equal(board.children.length,1);
  callback("canvasTearDown")();
  assert.equal(board.children.length,0);
});

test("hidden and invisible tokens do not gain a hover icon", () => {
  const a=makeActor("NPC",[]);
  const x=makeToken("hidden",a,{hidden:true});
  const y=makeToken("invisible",a,{visible:false});
  callback("hoverToken")(x,true);
  callback("hoverToken")(y,true);
  assert.equal(board.children.length,0);
});

test("hover icon click directly opens party notes, not an NPC sheet", async () => {
  const a=makeActor("NPC",[]);const token=makeToken("tok",a);
  game.user=users[1];
  callback("hoverToken")(token,true);
  const button=board.children[0];
  button.event("click");
  for(let i=0;i<10 && !rendered.length;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rendered.length,1);
  assert.equal(board.children.length,0);
  assert.equal(notifications.length,0);
});

test("token HUD button remains available and does not duplicate", () => {
  const a=makeActor("NPC",[]);const token=makeToken("tok",a);
  const root=new Node();
  callback("renderTokenHUD")({object:token},root);
  callback("renderTokenHUD")({object:token},root);
  assert.equal(root.children.length,1);
  assert.equal(root.children[0].title,"AFT NPC Notes: Party Notes");
});

test("failed visibility confirmation after hovering never creates a Journal",async () => {
  const a=makeActor("NPC",[]);const token=makeToken("tok",a);
  game.user=users[1];
  const originalQuery=users[0].query;
  users[0].query=async(name,data)=>{
    token.isVisible=false;
    return originalQuery(name,data);
  };
  await assert.rejects(openTokenNotes(token),/confirm/);
  assert.equal(journal.length,0);
});
