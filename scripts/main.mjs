import {
  MODULE_ID, subjectUuidForActor, subjectUuidForToken, resolveSubject,
  playerMayNote, findCollection, findPage, kindForUuid, ensurePage, isValidScope
} from "./store.mjs";

const QUERY_ENSURE = `${MODULE_ID}.ensure`;
const QUERY_CONFIRM = `${MODULE_ID}.confirm`;
const waitingForConfirmation = new Map();
const requestWindows = new Map();
const QUERY_WAIT_MS = 12000;

let hoveredToken = null;
let hoverButton = null;
let hideTimer = null;

function isActiveGM() {
  return Boolean(game.user?.isGM && game.users.activeGM?.id === game.user.id);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function notifyError(error) {
  console.error(`${MODULE_ID} |`, error);
  ui.notifications.error(error?.message || "AFT NPC Notes encountered an error.");
}

function canRequestNow(userId) {
  const now = Date.now();
  const previous = (requestWindows.get(userId) ?? []).filter(t => now - t < 60000);
  if (previous.length >= (userId === "*" ? 50 : 12)) return false;
  previous.push(now);
  requestWindows.set(userId, previous);
  return true;
}

function isRequestId(id) {
  return typeof id === "string" && /^[A-Za-z0-9]{8,32}$/.test(id);
}

/** Local per-player visibility; no NPC Actor permission is required. */
export function isVisibleToken(token) {
  return Boolean(token?.document?.documentName === "Token" &&
    token.document.uuid && !token.document.hidden && token.isVisible === true &&
    !token.isPreview && globalThis.canvas?.ready &&
    canvas.scene?.id === token.document.parent?.id);
}

function tokenFromUuidOnCanvas(tokenUuid) {
  if (typeof tokenUuid !== "string" || !/^Scene\.[A-Za-z0-9]+\.Token\.[A-Za-z0-9]+$/.test(tokenUuid)) {
    return null;
  }
  const id = tokenUuid.split(".").at(-1);
  const token = canvas?.tokens?.get?.(id) ??
    canvas?.tokens?.placeables?.find(t => t.document?.uuid === tokenUuid);
  return token?.document?.uuid === tokenUuid ? token : null;
}

function matchingRequest(req, candidate) {
  return isRequestId(req?.requestId) && req.requestId === candidate?.requestId &&
    req.subjectUuid === candidate?.subjectUuid && req.scope === candidate?.scope &&
    req.source === candidate?.source && req.tokenUuid === candidate?.tokenUuid;
}

/**
 * Foundry User.query authenticates the target, not a claimed request sender.
 * Challenge the specific player's live client, requiring the locally pending
 * random request and (for tokens) their scene visibility before GM creation.
 */
async function confirmPendingRequest(candidate) {
  if (!matchingRequest(waitingForConfirmation.get(candidate?.requestId), candidate)) return false;
  if (candidate.source === "actor") return true;
  const token = tokenFromUuidOnCanvas(candidate.tokenUuid);
  return isVisibleToken(token) && subjectUuidForToken(token) === candidate.subjectUuid;
}

async function verifyGMTokenEvidence(message, requester) {
  const tokenDoc = await globalThis.fromUuid(message.tokenUuid);
  if (tokenDoc?.documentName !== "Token" || tokenDoc.hidden ||
      tokenDoc.parent?.documentName !== "Scene" ||
      tokenDoc.parent.id !== requester.viewedScene ||
      tokenDoc.uuid !== message.tokenUuid ||
      subjectUuidForToken(tokenDoc) !== message.subjectUuid) return null;
  return resolveSubject(message.subjectUuid);
}

async function ensureRequestedPage(message) {
  if (!isActiveGM() || !isRequestId(message?.requestId) ||
      !isValidScope(message?.scope) || typeof message.userId !== "string" ||
      !["actor", "token"].includes(message?.source) ||
      !canRequestNow("*")) return { error: "Invalid NPC notes request." };
  const requester = game.users.get(message.userId);
  if (!requester || !requester.active || !canRequestNow(requester.id)) {
    return { error: "The player is unavailable or the request limit was reached." };
  }
  try {
    const candidate = {
      requestId: message.requestId, subjectUuid: message.subjectUuid,
      scope: message.scope, source: message.source,
      tokenUuid: message.tokenUuid ?? null
    };
    const confirmed = await requester.query(QUERY_CONFIRM, candidate, { timeout: 4500 });
    if (confirmed !== true) throw new Error("The player did not confirm this request.");

    let subject;
    if (message.source === "token") {
      subject = await verifyGMTokenEvidence(message, requester);
    } else {
      subject = await resolveSubject(message.subjectUuid);
      if (!subject || (subject.sceneId && requester.viewedScene !== subject.sceneId) ||
          !playerMayNote(subject.actor, requester)) subject = null;
    }
    if (!subject) throw new Error("NPC notes are not available for this token or Actor.");

    const kind = kindForUuid(subject.subjectUuid);
    const existing = findCollection(game.journal, kind, message.scope, requester.id);
    if (existing && !existing.testUserPermission(requester, "OWNER")) {
      throw new Error("The GM must grant you Owner permission on this notes Journal.");
    }
    const { entry, page } = await ensurePage(subject, message.scope, requester.id);
    return { journalId: entry.id, pageId: page.id };
  } catch (error) {
    console.error(`${MODULE_ID} | NPC page creation refused`, error);
    return { error: error?.message || "Unable to open NPC notes." };
  }
}

async function requestPage(subjectUuid, scope, source, tokenUuid) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error("A GM must be online the first time you add this NPC's page.");
  if (!game.user?.can?.("QUERY_USER")) {
    throw new Error("The GM must allow user queries for NPC note creation.");
  }
  const requestId = foundry.utils.randomID();
  const request = { requestId, subjectUuid, scope, source, tokenUuid: tokenUuid ?? null };
  waitingForConfirmation.set(requestId, request);
  try {
    const reply = await gm.query(QUERY_ENSURE, { ...request, userId: game.user.id }, {
      timeout: QUERY_WAIT_MS
    });
    if (typeof reply?.journalId === "string" && typeof reply?.pageId === "string") return reply;
    throw new Error(reply?.error || "The GM did not return an NPC notes page.");
  } finally {
    waitingForConfirmation.delete(requestId);
  }
}

async function waitForPage(journalId, pageId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const entry = game.journal.get(journalId);
    const page = entry?.pages?.get?.(pageId) ?? Array.from(entry?.pages ?? []).find(p => p.id === pageId);
    if (entry?.testUserPermission(game.user, "OWNER") && page) return { entry, page };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("The Journal page is not visible or editable. Ask the GM to check permissions.");
}

async function openPageInJournal(entry, page) {
  // Foundry v14 JournalEntrySheet can render and navigate to a given page ID.
  const sheet = entry.sheet;
  await sheet.render(true, { pageId: page.id });
  if (typeof sheet.goToPage === "function") await sheet.goToPage(page.id);
}

async function openSubjectNotes(subjectUuid, scope, { source, tokenUuid = null } = {}) {
  if (!isValidScope(scope) || !kindForUuid(subjectUuid)) throw new Error("Invalid NPC notes request.");
  const kind = kindForUuid(subjectUuid);
  let entry = findCollection(game.journal, kind, scope, game.user.id);
  if (entry && !entry.testUserPermission(game.user, "OWNER")) {
    throw new Error("The GM must grant you Journal Owner permission to edit these notes.");
  }
  let page = entry && findPage(entry, subjectUuid);
  if (!page) {
    if (game.user.isGM) {
      const subject = await resolveSubject(subjectUuid);
      if (!subject) throw new Error("This NPC is no longer in the world.");
      ({ entry, page } = await ensurePage(subject, scope, game.user.id));
    } else {
      const ids = await requestPage(subjectUuid, scope, source, tokenUuid);
      ({ entry, page } = await waitForPage(ids.journalId, ids.pageId));
    }
  }
  await openPageInJournal(entry, page);
  return entry; // Preserve the v0.2.1 API return type for macros/callers.
}

/** Legacy sheet entry point still requires the system's Actor LIMITED right. */
export async function openNotes(actor, scope) {
  if (!playerMayNote(actor, game.user)) throw new Error("You need access to this Actor's sheet.");
  const subjectUuid = subjectUuidForActor(actor);
  if (!subjectUuid) throw new Error("The NPC must be a saved Actor or placed token.");
  return openSubjectNotes(subjectUuid, scope, { source: "actor" });
}

/** Main player workflow: visible token and no NPC Actor sheet permission. */
export async function openTokenNotes(token, scope = "shared") {
  if (!isVisibleToken(token)) throw new Error("Notes can only be opened from a visible token on your scene.");
  const subjectUuid = subjectUuidForToken(token);
  if (!subjectUuid) throw new Error("This token has no saved UUID.");
  return openSubjectNotes(subjectUuid, scope, {
    source: "token", tokenUuid: token.document.uuid
  });
}

async function chooseNotes(name, onSelect) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "NPC Notes" },
    content: `<div class="pnn-chooser"><p><strong>${escapeHtml(name)}</strong></p>` +
      "<p>Where do you want to write your notes?</p></div>",
    buttons: [
      { action: "shared", label: "Party Notes", icon: "fas fa-users", default: true },
      { action: "personal", label: "My Notes", icon: "fas fa-lock" },
      { action: "cancel", label: "Cancel" }
    ],
    close: () => null, rejectClose: false
  });
  if (isValidScope(choice)) return onSelect(choice);
  return null;
}

export async function openChooser(actor) {
  try {
    if (!playerMayNote(actor, game.user)) throw new Error("You need access to this Actor's sheet.");
    return await chooseNotes(actor.name, scope => openNotes(actor, scope));
  } catch (error) { notifyError(error); return null; }
}

export async function openTokenChooser(token) {
  try {
    if (!isVisibleToken(token)) throw new Error("The NPC token is no longer visible.");
    // Use the player-visible token label, never a hidden Actor name, in the chooser.
    return await chooseNotes(token.document.name ?? "NPC", scope => openTokenNotes(token, scope));
  } catch (error) { notifyError(error); return null; }
}

function addV2HeaderControl(app, controls) {
  const actor = app.actor ?? app.document;
  if (actor?.documentName !== "Actor" || !playerMayNote(actor, game.user)) return;
  if (controls.some(button => button.action === "pnn-notes")) return;
  controls.push({
    action: "pnn-notes", icon: "fas fa-book-open", label: "NPC Notes",
    onClick: () => openChooser(actor), visible: true
  });
}

function addLegacyHeaderControl(app, buttons) {
  const actor = app.actor ?? app.object;
  if (actor?.documentName !== "Actor" || !playerMayNote(actor, game.user)) return;
  if (buttons.some(button => button.class === "pnn-notes")) return;
  buttons.unshift({
    label: "NPC Notes", class: "pnn-notes", icon: "fas fa-book-open",
    onclick: () => openChooser(actor)
  });
}

/** Native Token HUD control for token owners; hover icon serves other players. */
function addTokenHUDButton(app, html) {
  const token = app.object?.document?.documentName === "Token" ? app.object : null;
  if (!isVisibleToken(token)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!(root instanceof HTMLElement) || root.querySelector(".pnn-token-button")) return;
  const container = root.querySelector(".col.left") ?? root.querySelector(".col.middle") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon pnn-token-button";
  button.title = "AFT NPC Notes (right-click: My Notes)";
  button.setAttribute("aria-label", "AFT NPC Notes");
  const icon = document.createElement("i");
  icon.className = "fas fa-book-open";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("click", event => {
    event.preventDefault(); event.stopPropagation();
    void openTokenChooser(token);
  });
  button.addEventListener("contextmenu", event => {
    event.preventDefault(); event.stopPropagation();
    void openTokenNotes(token, "personal").catch(notifyError);
  });
  container.append(button);
}

function clearHideTimer() {
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = null;
}
function removeHoverButton() {
  clearHideTimer();
  hoverButton?.remove();
  hoverButton = null;
  hoveredToken = null;
}
function scheduleHide() {
  clearHideTimer();
  hideTimer = setTimeout(removeHoverButton, 250);
}
function positionHoverButton() {
  if (!hoveredToken || !hoverButton) return;
  if (!isVisibleToken(hoveredToken)) { removeHoverButton(); return; }
  const transform = canvas?.stage?.worldTransform;
  if (typeof transform?.apply !== "function") { removeHoverButton(); return; }
  const token = hoveredToken;
  const point = transform.apply({
    x: token.center.x - token.w * 0.43,
    y: token.center.y - token.h * 0.43
  });
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    removeHoverButton(); return;
  }
  const hostRect = hoverButton.parentElement?.getBoundingClientRect?.();
  const canvasElement = canvas?.app?.canvas ?? canvas?.app?.renderer?.canvas ??
    globalThis.document?.getElementById?.("board");
  const canvasRect = canvasElement?.getBoundingClientRect?.();
  const offsetX = (canvasRect?.left ?? 0) - (hostRect?.left ?? 0);
  const offsetY = (canvasRect?.top ?? 0) - (hostRect?.top ?? 0);
  hoverButton.style.left = `${Math.round(point.x + offsetX - 14)}px`;
  hoverButton.style.top = `${Math.round(point.y + offsetY - 14)}px`;
}

function showHoverButton(token) {
  if (!isVisibleToken(token)) return;
  const board = canvas?.hud?.element ?? globalThis.document?.getElementById?.("hud");
  if (!(board instanceof HTMLElement)) return;
  clearHideTimer();
  if (!hoverButton || hoverButton.parentElement !== board) {
    removeHoverButton();
    hoverButton = document.createElement("button");
    hoverButton.type = "button";
    hoverButton.className = "pnn-hover-button";
    hoverButton.title = "Choose NPC Notes (right-click for My Notes)";
    hoverButton.setAttribute("aria-label", "Choose NPC Notes");
    hoverButton.innerHTML = '<i class="fas fa-book-open" aria-hidden="true"></i>';
    hoverButton.addEventListener("pointerenter", clearHideTimer);
    hoverButton.addEventListener("pointerleave", scheduleHide);
    hoverButton.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      const selected = hoveredToken;
      removeHoverButton();
      if (selected) void openTokenChooser(selected);
    });
    hoverButton.addEventListener("contextmenu", event => {
      event.preventDefault(); event.stopPropagation();
      const selected = hoveredToken;
      removeHoverButton();
      if (selected) void openTokenNotes(selected, "personal").catch(notifyError);
    });
    board.append(hoverButton);
  }
  hoveredToken = token;
  positionHoverButton();
}

Hooks.on("getHeaderControlsApplicationV2", addV2HeaderControl);
Hooks.on("getApplicationHeaderButtons", addLegacyHeaderControl);
Hooks.on("renderTokenHUD", addTokenHUDButton);
Hooks.on("hoverToken", (token, hovered) => {
  if (hovered) showHoverButton(token);
  else if (hoveredToken === token) scheduleHide();
});
Hooks.on("canvasPan", positionHoverButton);
Hooks.on("refreshToken", token => {
  if (token === hoveredToken) positionHoverButton();
});
Hooks.on("visibilityRefresh", positionHoverButton);
Hooks.on("destroyToken", token => {
  if (token === hoveredToken) removeHoverButton();
});
Hooks.on("canvasTearDown", removeHoverButton);
Hooks.on("canvasReady", removeHoverButton);

Hooks.once("ready", () => {
  requestWindows.clear();
  waitingForConfirmation.clear();
  CONFIG.queries[QUERY_ENSURE] = ensureRequestedPage;
  CONFIG.queries[QUERY_CONFIRM] = confirmPendingRequest;
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = Object.freeze({
    open: openChooser,
    openShared: actor => openNotes(actor, "shared"),
    openPersonal: actor => openNotes(actor, "personal"),
    openFromToken: token => openTokenNotes(token, "shared"),
    openPersonalFromToken: token => openTokenNotes(token, "personal"),
    chooseFromToken: openTokenChooser,
    version: "0.3.0"
  });
});
