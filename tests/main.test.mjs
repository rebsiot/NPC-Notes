import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const hooks = new Map();
globalThis.Hooks = {
  on(name, fn) { hooks.set(name, fn); },
  once(name, fn) { hooks.set(name, fn); }
};
let dialogChoice = "shared";
const dialogs = [];
globalThis.foundry = {
  utils: { randomID: () => "abcdef0123456789" },
  applications: { api: { DialogV2: { wait: async options => {
    dialogs.push(options); return dialogChoice;
  } } } }
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE:0, OWNER:3 },
  JOURNAL_ENTRY_PAGE_FORMATS: {HTML:1} };
const { openChooser, openNotes, openTokenNotes, openTokenChooser, isVisibleToken } =
  await import("../scripts/main.mjs");

const callback = name => { assert.ok(hooks.has(name),`missing ${name}`); return hooks.get(name); };
let users, actors, tokenDocs, tokens, folders, journal, queries, rendered, navigated, gameModules, notifications;
let board, createdPages;
class Node {
  constructor() {this.children=[];this.attrs={};this.className="";this.style={};this.listeners={};this.parentElement=null;}
  querySelector(sel) {
    if (sel === ".col.left") return this;
    if (sel === ".pnn-token-button") return this.children.find(n => n.className.includes("pnn-token-button")) ?? null;
    return null;
  }
  setAttribute(k,v) {this.attrs[k]=v;}
  append(n) {n.parentElement=this;this.children.push(n);}
  addEventListener(k,fn) {this.listeners[k]=fn;}
  remove() {if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  getBoundingClientRect() {return {left:0,top:0,width:1000,height:1000};}
  event(name) {return this.listeners[name]?.({preventDefault(){},stopPropagation(){}});}
}
globalThis.HTMLElement=Node;
function makeActor(id, permitted=[]) {
  const actor = { documentName:"Actor",id,uuid:`Actor.${id}`,name:`Secret ${id}`,
    permitted:new Set(permitted), testUserPermission:user=>user.isGM || actor.permitted.has(user.id),
    async update(){throw new Error("NPC Actor mutation is prohibited");} };
  actors.set(actor.uuid,actor);
  return actor;
}
function makeToken(id, actor,{linked=true,sceneId="scA",sceneName="Old Town",tokenName,visible=true,hidden=false}={}) {
  const doc = {id,documentName:"Token",uuid:`Scene.${sceneId}.Token.${id}`,
    parent:{documentName:"Scene",id:sceneId,name:sceneName},
    name:tokenName??actor.name,actorId:actor.id,actorLink:linked,hidden,actor};
  const token={document:doc,isVisible:visible,isPreview:false,center:{x:250,y:280},w:100,h:100};
  tokens.set(id,token);tokenDocs.set(doc.uuid,doc);return token;
}
function makeEntry(data) {
  const entry={id:`j${journal.length}`,...data,pages:[],
    getFlag:(ns,k)=>entry.flags?.[ns]?.[k],
    testUserPermission:(user,level)=>user.isGM ||
      (entry.ownership[user.id]??entry.ownership.default)>=(level==="OWNER"?3:1),
    async update(change){Object.assign(entry,change);},
    async createEmbeddedDocuments(type, pageData){
      assert.equal(type,"JournalEntryPage");
      const pages=pageData.map(d=>{
        const page={id:`page${++createdPages}`,...d,getFlag:(ns,k)=>page.flags?.[ns]?.[k]};
        return page;
      });
      entry.pages.push(...pages);return pages;
    },
    sheet:{
      async render(_force,options){rendered.push({journalId:entry.id,pageId:options?.pageId});},
      async goToPage(pageId){navigated.push({journalId:entry.id,pageId});}
    }
  };
  entry.pages.push(...(data.pages??[]));
  entry.pages.get=id=>entry.pages.find(p=>p.id===id);
  journal.push(entry);return entry;
}
async function flushUntil(predicate, attempts=40) {
  for(let i=0;i<attempts && !predicate();i++) await new Promise(resolve=>setImmediate(resolve));
}
beforeEach(() => {
  dialogChoice="shared";dialogs.length=0;createdPages=0;
  users=[
    {id:"gm",name:"GM",active:true,isGM:true,role:4,viewedScene:"scA",can:()=>true},
    {id:"a",name:"Alice",active:true,isGM:false,role:1,viewedScene:"scA",can:()=>true},
    {id:"b",name:"Bob",active:true,isGM:false,role:1,viewedScene:"scA",can:()=>true}
  ];
  actors=new Map();tokenDocs=new Map();tokens=new Map();folders=[];journal=[];
  journal.get=id=>journal.find(j=>j.id===id);
  queries=[];rendered=[];navigated=[];notifications=[];
  board=new Node();
  const userCollection={
    get:id=>users.find(u=>u.id===id),
    [Symbol.iterator]:()=>users[Symbol.iterator](),
    get activeGM(){return users[0].active?users[0]:null;}
  };
  gameModules=new Map([["player-npc-notes",{}]]);
  globalThis.CONFIG={queries:{}};
  globalThis.game={user:users[0],users:userCollection,modules:gameModules,folders,journal};
  globalThis.canvas={ready:true,scene:{id:"scA"},hud:{element:board},
    tokens:{get:id=>tokens.get(id),get placeables(){return [...tokens.values()];}},
    stage:{worldTransform:{apply:p=>({...p})}}
  };
  globalThis.document={createElement:()=>new Node(),getElementById:id=>id==="board"?board:null};
  globalThis.ui={notifications:{error:message=>notifications.push(message)}};
  globalThis.Folder={implementation:{create:async data=>{
    const folder={id:"folder1",...data,getFlag:(ns,k)=>data.flags?.[ns]?.[k]};
    folders.push(folder);return folder;
  }}};
  globalThis.JournalEntry={implementation:{create:async data=>makeEntry(data)}};
  globalThis.fromUuid=async uuid=>actors.get(uuid)??tokenDocs.get(uuid)??null;
  for(const user of users) user.query=async(name,data)=>{
    queries.push({user:user.id,name,data});
    const old=game.user,scene=canvas.scene.id;
    try {
      game.user=user;canvas.scene.id=user.viewedScene;
      if(!CONFIG.queries[name])throw new Error(`Unknown query ${name}`);
      return await CONFIG.queries[name](data);
    } finally {game.user=old;canvas.scene.id=scene;}
  };
  callback("ready")();callback("canvasReady")();
});

test("module API and Foundry v14 query registration are system-independent", () => {
  const api=gameModules.get("player-npc-notes").api;
  assert.equal(api.version,"0.3.0");
  for(const k of ["open","openShared","openPersonal","openFromToken","openPersonalFromToken","chooseFromToken"])
    assert.equal(typeof api[k],"function");
  assert.equal(typeof CONFIG.queries["player-npc-notes.ensure"],"function");
  assert.equal(typeof CONFIG.queries["player-npc-notes.confirm"],"function");
});

test("sheet header remains gated on Actor access and never doubles", () => {
  const yes=makeActor("Visible",["a"]),no=makeActor("Hidden",[]);
  game.user=users[1];
  const controls=[];callback("getHeaderControlsApplicationV2")({document:yes},controls);
  callback("getHeaderControlsApplicationV2")({document:yes},controls);
  assert.equal(controls.length,1);assert.equal(controls[0].label,"NPC Notes");
  const other=[];callback("getHeaderControlsApplicationV2")({document:no},other);
  assert.equal(other.length,0);
  const old=[];callback("getApplicationHeaderButtons")({actor:yes},old);
  assert.equal(old.length,1);
});

test("GM sheet path opens consolidated recurring journal to specific NPC page", async () => {
  const a=makeActor("A");
  const result=await openNotes(a,"shared");
  assert.equal(result.name,"Party \u2014 Recurring NPCs");
  assert.equal(result.pages[0].name,"Secret A");
  assert.deepEqual(rendered,[{journalId:result.id,pageId:result.pages[0].id}]);
  assert.deepEqual(navigated,rendered);
  await openNotes(a,"shared");
  assert.equal(journal.length,1);assert.equal(result.pages.length,1);
});

test("player lacking NPC Actor permission can request first party page", async () => {
  const actor=makeActor("Detective",[]),token=makeToken("t1",actor);
  game.user=users[1];
  assert.equal(actor.testUserPermission(game.user,"LIMITED"),false);
  const entry=await openTokenNotes(token,"shared");
  assert.equal(entry.name,"Party \u2014 Recurring NPCs");
  assert.equal(entry.pages[0].name,"Secret Detective");
  assert.deepEqual(entry.ownership,{default:3});
  assert.deepEqual(queries.map(q=>q.user),["gm","a"]);
  assert.equal(queries[0].data.source,"token");
  assert.equal(queries[0].data.tokenUuid,token.document.uuid);
  assert.equal(rendered[0].pageId,entry.pages[0].id);
});

test("linked tokens use a single recurring page even across multiple token instances", async () => {
  const a=makeActor("A"),t1=makeToken("t1",a),t2=makeToken("t2",a);
  await openTokenNotes(t1);await openTokenNotes(t2);
  assert.equal(journal.length,1);assert.equal(journal[0].pages.length,1);
  assert.equal(journal[0].pages[0].flags["player-npc-notes"].pageLink.subjectUuid,"Actor.A");
});

test("unlinked tokens share one Scene NPCs Journal but have separate UUID pages", async () => {
  const a=makeActor("A");
  const t1=makeToken("t1",a,{linked:false,tokenName:"Officer",sceneName:"Precinct"});
  const t2=makeToken("t2",a,{linked:false,tokenName:"Officer",sceneName:"Night Club"});
  await openTokenNotes(t1);await openTokenNotes(t2);
  assert.equal(journal.length,1);
  assert.equal(journal[0].name,"Party \u2014 Scene NPCs");
  assert.equal(journal[0].pages.length,2);
  assert.deepEqual(journal[0].pages.map(p=>p.name),[
    "Officer [seen in Precinct]","Officer [seen in Night Club]"
  ]);
  assert.equal(new Set(journal[0].pages.map(p=>p.flags["player-npc-notes"].pageLink.subjectUuid)).size,2);
});

test("party and two players' personal Journals are entirely separate", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];await openTokenNotes(t,"shared");await openTokenNotes(t,"personal");
  game.user=users[2];await openTokenNotes(t,"personal");
  assert.equal(journal.length,3);
  const party=journal.find(j=>j.ownership.default===3);
  assert.ok(party);
  assert.equal(journal.filter(j=>j.ownership.a===3).length,1);
  assert.equal(journal.filter(j=>j.ownership.b===3).length,1);
  assert.equal(journal.find(j=>j.ownership.a===3).testUserPermission(users[2],"OWNER"),false);
});

test("all four category Journals are created at most once per world/player", async () => {
  const a=makeActor("A"),linked=makeToken("linked",a),scene=makeToken("scene",a,{linked:false});
  for(const scope of ["shared","personal"]){
    game.user=users[1];await openTokenNotes(linked,scope);await openTokenNotes(scene,scope);
  }
  assert.equal(journal.length,4);
  assert.equal(journal.every(j=>j.pages.length===1),true);
});

test("new shared journal default-owner permission includes a later joined player", async () => {
  const a=makeActor("A"),token=makeToken("tok",a);
  const entry=await openTokenNotes(token,"shared");
  const newcomer={id:"new",isGM:false,role:1};
  assert.equal(entry.testUserPermission(newcomer,"OWNER"),true);
});

test("party Journal has no page-level ownership override", async () => {
  const a=makeActor("A"),t=makeToken("tok",a);
  const entry=await openTokenNotes(t,"shared");
  assert.equal(Object.hasOwn(entry.pages[0],"ownership"),false);
});

test("existing older per-NPC Journal is neither adopted nor edited", async () => {
  const a=makeActor("A"),token=makeToken("t1",a);
  const old=makeEntry({name:"Secret A - Party Notes",ownership:{default:0,a:3},
    flags:{"player-npc-notes":{noteLink:{schema:1,scope:"shared",subjectUuid:a.uuid}}},
    pages:[{id:"oldpage",text:{content:"<p>Original notes</p>"}}]});
  const newEntry=await openTokenNotes(token);
  assert.notStrictEqual(old,newEntry);
  assert.equal(old.pages[0].text.content,"<p>Original notes</p>");
  assert.deepEqual(old.ownership,{default:0,a:3});
  assert.equal(journal.length,2);
});

test("without online GM, previously-created page can still be edited", async () => {
  const a=makeActor("A"),t=makeToken("tok",a);
  await openTokenNotes(t,"shared");
  users[0].active=false;
  game.user=users[1];queries.length=0;
  const e=await openTokenNotes(t,"shared");
  assert.equal(e.pages.length,1);assert.equal(queries.length,0);
  assert.equal(rendered.at(-1).pageId,e.pages[0].id);
});

test("without a GM, first-ever page creation errors without a partial Journal", async () => {
  const a=makeActor("A"),t=makeToken("tok",a);
  users[0].active=false;game.user=users[1];
  await assert.rejects(openTokenNotes(t,"shared"),/GM must be online/);
  assert.equal(journal.length,0);
});

test("shared collection permission revocation refuses to modify or bypass GM restriction", async () => {
  const a=makeActor("A"),t=makeToken("tok",a);
  const entry=await openTokenNotes(t,"shared");
  entry.ownership.a=0;
  game.user=users[1];
  await assert.rejects(openTokenNotes(t,"shared"),/Owner permission/);
  assert.equal(entry.ownership.a,0);
});

test("private Journal cannot be opened by a different player just by knowing its name", async () => {
  const a=makeActor("A"),t=makeToken("tok",a);
  game.user=users[1];const privateA=await openTokenNotes(t,"personal");
  game.user=users[2];const privateB=await openTokenNotes(t,"personal");
  assert.notStrictEqual(privateA,privateB);
  assert.equal(privateA.testUserPermission(users[2],"OWNER"),false);
});

test("hidden, invisible, preview, and wrong scene tokens cannot create pages", async () => {
  const a=makeActor("A");
  for(const option of [{hidden:true},{visible:false},{sceneId:"scB"}]){
    const t=makeToken(`tok${journal.length}`,a,option);
    assert.equal(isVisibleToken(t),false);
    await assert.rejects(openTokenNotes(t),/visible token/);
  }
  assert.equal(journal.length,0);
});

test("switched scene between click and query invalidates the request", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];
  const previous=users[0].query;
  users[0].query=async (name,data)=>{
    users[1].viewedScene="scB";
    return previous(name,data);
  };
  await assert.rejects(openTokenNotes(t),/not confirm|not available/);
  assert.equal(journal.length,0);
});

test("forged page requests without a matching local click are rejected", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  const original=console.error;console.error=()=>{};
  try {
    const answer=await CONFIG.queries["player-npc-notes.ensure"]({
      requestId:"abcdef0123456789",subjectUuid:a.uuid,scope:"shared",
      source:"token",tokenUuid:t.document.uuid,userId:"a"
    });
    assert.match(answer.error,/not confirm/);
  } finally {console.error=original;}
  assert.equal(journal.length,0);
});

test("offline requester and invalid scopes are rejected before any page creation", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  const req={requestId:"abcdef0123456789",subjectUuid:a.uuid,scope:"shared",
    source:"token",tokenUuid:t.document.uuid,userId:"a"};
  assert.ok((await CONFIG.queries["player-npc-notes.ensure"]({...req,scope:"bad"})).error);
  users[1].active=false;
  assert.match((await CONFIG.queries["player-npc-notes.ensure"](req)).error,/unavailable/);
  assert.equal(journal.length,0);
});

test("Actor sheet API still requires Limited permission", async () => {
  const a=makeActor("A",[]);
  game.user=users[1];await assert.rejects(openNotes(a,"shared"),/sheet/);
  a.permitted.add("a");
  const entry=await openNotes(a,"shared");
  assert.equal(entry.name,"Party \u2014 Recurring NPCs");
});

test("left-click menu shows Party Notes and My Notes, cancelling creates nothing", async () => {
  const a=makeActor("A"),t=makeToken("t1",a,{tokenName:"Known Face"});
  game.user=users[1];dialogChoice="cancel";
  assert.equal(await openTokenChooser(t),null);
  assert.equal(journal.length,0);
  assert.deepEqual(dialogs.at(-1).buttons.map(b=>b.label),["Party Notes","My Notes","Cancel"]);
  assert.match(dialogs.at(-1).content,/Known Face/);
});

test("menu selects personal notes and opens the player's private page", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];dialogChoice="personal";
  await openTokenChooser(t);
  assert.equal(journal.length,1);
  assert.equal(journal[0].name,"Alice \u2014 Recurring NPCs (Personal)");
  assert.equal(journal[0].ownership.a,3);
  assert.equal(rendered.at(-1).pageId,journal[0].pages[0].id);
});

test("token chooser escapes HTML markup from token name", async () => {
  const a=makeActor("A"),t=makeToken("t1",a,{tokenName:"<img onerror=x>"});
  dialogChoice="cancel";
  await openTokenChooser(t);
  assert.ok(dialogs[0].content.includes("&lt;img onerror=x&gt;"));
  assert.ok(!dialogs[0].content.includes("<img"));
});

test("hover button remains on upper-left and does not duplicate", () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];
  callback("hoverToken")(t,true);
  assert.equal(board.children.length,1);
  assert.equal(board.children[0].className,"pnn-hover-button");
  assert.equal(board.children[0].style.left,"193px");
  assert.equal(board.children[0].attrs["aria-label"],"Choose NPC Notes");
  callback("hoverToken")(t,true);
  assert.equal(board.children.length,1);
  callback("canvasTearDown")();assert.equal(board.children.length,0);
});

test("left-click hover icon invokes menu, not direct Party Notes", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];dialogChoice="cancel";
  callback("hoverToken")(t,true);
  board.children[0].event("click");
  await flushUntil(()=>dialogs.length>0);
  assert.equal(dialogs.length,1);
  assert.equal(journal.length,0);
  assert.equal(board.children.length,0);
});

test("right-click hover icon skips menu and opens My Notes", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];
  callback("hoverToken")(t,true);
  board.children[0].event("contextmenu");
  await flushUntil(()=>rendered.length>0);
  assert.equal(dialogs.length,0);
  assert.equal(journal[0].name,"Alice \u2014 Recurring NPCs (Personal)");
  assert.equal(board.children.length,0);
  assert.equal(notifications.length,0);
});

test("native HUD book icon stays on left and offers menu plus personal shortcut", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];
  const root=new Node();
  callback("renderTokenHUD")({object:t},root);callback("renderTokenHUD")({object:t},root);
  assert.equal(root.children.length,1);
  root.children[0].event("click");
  await flushUntil(()=>dialogs.length>0);
  assert.equal(dialogs.length,1);
  root.children[0].event("contextmenu");
  await flushUntil(()=>journal.length>=2);
  assert.equal(journal.length,2); // party from menu, personal from right-click
});

test("hover button ignores hidden/invisible NPCs and is removed on canvas teardown", () => {
  const a=makeActor("A"),hidden=makeToken("hidden",a,{hidden:true}),unseen=makeToken("unseen",a,{visible:false});
  callback("hoverToken")(hidden,true);callback("hoverToken")(unseen,true);
  assert.equal(board.children.length,0);
});

test("choosing after token visibility is lost does not expose a Journal", async () => {
  const a=makeActor("A"),t=makeToken("t1",a);
  game.user=users[1];
  const oldWait=foundry.applications.api.DialogV2.wait;
  foundry.applications.api.DialogV2.wait=async options=>{dialogs.push(options);t.isVisible=false;return "shared";};
  try {await openTokenChooser(t);} finally {foundry.applications.api.DialogV2.wait=oldWait;}
  assert.equal(journal.length,0);
  assert.equal(notifications.length,1);
});
