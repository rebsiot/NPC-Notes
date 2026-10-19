import {
  MODULE_ID, subjectUuidForActor, subjectUuidForToken, resolveSubject,
  playerMayNote, findJournal, ensureJournal, isValidScope, isLegacyGeneratedTitle
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

/** This must be checked on the PLAYER client, where their vision is evaluated. */
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
 * Foundry User.query authenticates the target but supplies no caller ID to the
 * recipient handler. The GM queries the claimed player back and demands an
 * exact pending, client-local button click, plus visible token evidence.
 */
async function confirmPendingRequest(candidate) {
  if (!matchingRequest(waitingForConfirmation.get(candidate?.requestId), candidate)) return false;
  if (candidate.source === "actor") return true;
  const token = tokenFromUuidOnCanvas(candidate.tokenUuid);
  return isVisibleToken(token) && subjectUuidForToken(token) === candidate.subjectUuid;
}

/** A GM independently verifies the referenced token and its scene. */
async function verifyGMTokenEvidence(message, requester) {
  const tokenDoc = await globalThis.fromUuid(message.tokenUuid);
  if (tokenDoc?.documentName !== "Token" || tokenDoc.hidden ||
      tokenDoc.parent?.documentName !== "Scene" ||
      tokenDoc.parent.id !== requester.viewedScene ||
      tokenDoc.uuid !== message.tokenUuid ||
      subjectUuidForToken(tokenDoc) !== message.subjectUuid) return null;
  return resolveSubject(message.subjectUuid);
}

async function ensureRequestedNotes(message) {
  if (!isActiveGM() || !isRequestId(message?.requestId) ||
      !isValidScope(message?.scope) || typeof message.userId !== "string" ||
      !["actor", "token"].includes(message?.source) ||
      !canRequestNow("*")) return { error: "Invalid NPC notes request." };
  const requester = game.users.get(message.userId);
  if (!requester || !requester.active || !canRequestNow(requester.id)) {
    return { error: "The player is unavailable or the request limit was reached." };
  }
  try {
    const request = {
      requestId: message.requestId, subjectUuid: message.subjectUuid,
      scope: message.scope, source: message.source,
      tokenUuid: message.tokenUuid ?? null
    };
    const confirmed = await requester.query(QUERY_CONFIRM, request, { timeout: 4500 });
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

    const existing = findJournal(game.journal, subject.subjectUuid, message.scope, requester.id);
    if (existing && !existing.testUserPermission(requester, "OWNER")) {
      throw new Error("This Journal exists, but the GM must grant you Journal Owner access.");
    }
    // Reuse the original Journal and correct only an untouched v0.2.0
    // short-UUID title. This never changes permissions, pages, or identity.
    const entry = await ensureJournal(subject, message.scope, requester.id);
    return { journalId: entry.id };
  } catch (error) {
    console.error(`${MODULE_ID} | NPC note creation refused`, error);
    return { error: error?.message || "Unable to open NPC notes." };
  }
}

async function requestJournal(subjectUuid, scope, source, tokenUuid) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error("A GM must be online to create the first NPC Journal.");
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
    if (typeof reply?.journalId === "string") return reply.journalId;
    throw new Error(reply?.error || "The GM did not return an NPC notes Journal.");
  } finally {
    waitingForConfirmation.delete(requestId);
  }
}

async function waitForJournal(id) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const entry = game.journal.get(id);
    if (entry && entry.testUserPermission(game.user, "OWNER")) return entry;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Journal permissions were not granted. Ask the GM for Journal Owner access.");
}

async function openSubjectNotes(subjectUuid, scope, { source, tokenUuid = null } = {}) {
  if (!isValidScope(scope)) throw new Error("Choose party notes or personal notes.");
  let entry = findJournal(game.journal, subjectUuid, scope, game.user.id);
  if (entry && !entry.testUserPermission(game.user, "OWNER")) {
    throw new Error("Ask the GM to grant Journal Owner access to these existing notes.");
  }
  if (!entry) {
    if (game.user.isGM) {
      const subject = await resolveSubject(subjectUuid);
      if (!subject) throw new Error("This NPC is no longer in the world.");
      entry = await ensureJournal(subject, scope, game.user.id);
    } else {
      const id = await requestJournal(subjectUuid, scope, source, tokenUuid);
      entry = await waitForJournal(id);
    }
  } else if (isLegacyGeneratedTitle(entry, subjectUuid, scope, game.user.name)) {
    // A player with Journal Owner permission may not be able to read an NPC's
    // real Actor name. Ask the GM to resolve it rather than guessing from a
    // token label. With no active GM, the old Journal still opens normally.
    if (game.user.isGM) {
      const subject = await resolveSubject(subjectUuid);
      if (subject) entry = await ensureJournal(subject, scope, game.user.id);
    } else if (game.users.activeGM && game.user.can?.("QUERY_USER")) {
      try {
        await requestJournal(subjectUuid, scope, source, tokenUuid);
      } catch (error) {
        console.warn(`${MODULE_ID} | Could not update the generated Journal title; existing notes remain usable.`, error);
      }
    }
  }
  entry.sheet.render(true);
  return entry;
}

/** Backward-compatible API for sheet-based access where Actor LIMITED is granted. */
export async function openNotes(actor, scope) {
  if (!playerMayNote(actor, game.user)) throw new Error("You need access to this Actor's sheet.");
  const subjectUuid = subjectUuidForActor(actor);
  if (!subjectUuid) throw new Error("The NPC must be a saved Actor or placed token.");
  return openSubjectNotes(subjectUuid, scope, { source: "actor" });
}

/** Primary player workflow: no NPC Actor permission or sheet needed. */
export async function openTokenNotes(token, scope = "shared") {
  if (!isVisibleToken(token)) throw new Error("Notes can only be opened from a visible token on your scene.");
  const subjectUuid = subjectUuidForToken(token);
  if (!subjectUuid) throw new Error("This token has no saved UUID.");
  return openSubjectNotes(subjectUuid, scope, {
    source: "token", tokenUuid: token.document.uuid
  });
}

export async function openChooser(actor) {
  try {
    if (!playerMayNote(actor, game.user)) throw new Error("You need access to this Actor's sheet.");
    const name = escapeHtml(actor.name);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `NPC Notes: ${actor.name}` },
      content: `<div class="pnn-chooser"><p>Notes for <strong>${name}</strong> are stored in Foundry Journals, separate from the NPC Actor.</p><p><strong>Party:</strong> shared notes. <strong>Personal:</strong> visible only to you and GMs.</p></div>`,
      buttons: [
        { action: "shared", label: "Party Notes", icon: "fas fa-users", default: true },
        { action: "personal", label: "My Notes", icon: "fas fa-lock" },
        { action: "cancel", label: "Cancel" }
      ],
      close: () => null,
      rejectClose: false
    });
    if (isValidScope(choice)) await openNotes(actor, choice);
  } catch (error) { notifyError(error); }
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

/** Native Token HUD button remains for GMs and owners who can open the HUD. */
function addTokenHUDButton(app, html) {
  const token = app.object?.document?.documentName === "Token" ? app.object : null;
  if (!isVisibleToken(token)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!(root instanceof HTMLElement) || root.querySelector(".pnn-token-button")) return;
  const container = root.querySelector(".col.left") ?? root.querySelector(".col.middle") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon pnn-token-button";
  button.title = "AFT NPC Notes: Party Notes";
  button.setAttribute("aria-label", "AFT NPC Notes: Party Notes");
  const icon = document.createElement("i");
  icon.className = "fas fa-book-open";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void openTokenNotes(token, "shared").catch(notifyError);
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

/** Player shortcut on hover, including NPC tokens the player does not own. */
function showHoverButton(token) {
  if (!isVisibleToken(token)) return;
  // Foundry v14 exposes a public HTML HUD container above the Pixi canvas.
  // Do not append HTML to #board: on some versions that element is a canvas.
  const board = canvas?.hud?.element ?? globalThis.document?.getElementById?.("hud");
  if (!(board instanceof HTMLElement)) return;
  clearHideTimer();
  if (!hoverButton || hoverButton.parentElement !== board) {
    removeHoverButton();
    hoverButton = document.createElement("button");
    hoverButton.type = "button";
    hoverButton.className = "pnn-hover-button";
    hoverButton.title = "Open NPC Party Notes (right-click for personal notes)";
    hoverButton.setAttribute("aria-label", "Open NPC Party Notes");
    hoverButton.innerHTML = '<i class="fas fa-book-open" aria-hidden="true"></i>';
    hoverButton.addEventListener("pointerenter", clearHideTimer);
    hoverButton.addEventListener("pointerleave", scheduleHide);
    hoverButton.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      const selected = hoveredToken;
      removeHoverButton();
      if (selected) void openTokenNotes(selected, "shared").catch(notifyError);
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
  CONFIG.queries[QUERY_ENSURE] = ensureRequestedNotes;
  CONFIG.queries[QUERY_CONFIRM] = confirmPendingRequest;
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = Object.freeze({
    open: openChooser,
    openShared: actor => openNotes(actor, "shared"),
    openPersonal: actor => openNotes(actor, "personal"),
    openFromToken: token => openTokenNotes(token, "shared"),
    openPersonalFromToken: token => openTokenNotes(token, "personal"),
    version: "0.2.1"
  });
});
