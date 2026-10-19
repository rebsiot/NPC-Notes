import {
  MODULE_ID, subjectUuidForActor, resolveSubject, playerMayNote,
  findJournal, ensureJournal, syncSharedJournals, isValidScope
} from "./store.mjs";

const QUERY_ENSURE = `${MODULE_ID}.ensure`;
const QUERY_CONFIRM = `${MODULE_ID}.confirm`;
const waitingForConfirmation = new Map();
const requestWindows = new Map();
const QUERY_WAIT_MS = 12000;

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
  ui.notifications.error(error?.message || "Player NPC Notes encountered an error.");
}

function mayOpen(actor) {
  return playerMayNote(actor, game.user);
}

function canRequestNow(userId) {
  // Cap each user as well as the total number of GM-side requests per minute.
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

function matchingRequest(req, candidate) {
  return isRequestId(req?.requestId) && req.requestId === candidate?.requestId &&
    req.subjectUuid === candidate.subjectUuid && req.scope === candidate.scope;
}

/**
 * Query handlers are registered on all clients. Foundry v14's User.query
 * authenticates the TARGET user of each query, but does not expose the
 * caller identity to CONFIG.queries handlers. To avoid trusting the claimed
 * requesting user ID, the GM queries that user's client back and requires a
 * matching pending, random request ID from an actual local button click.
 * A forged caller cannot cause a document to be created for another user.
 */
async function confirmPendingRequest(candidate) {
  const pending = waitingForConfirmation.get(candidate?.requestId);
  return Boolean(matchingRequest(pending, candidate));
}

async function ensureRequestedNotes(message) {
  if (!isActiveGM() || !isRequestId(message?.requestId) ||
      !isValidScope(message?.scope) || typeof message.userId !== "string" ||
      !canRequestNow("*")) return { error: "Invalid NPC notes request." };
  const requester = game.users.get(message.userId);
  if (!requester || !requester.active || !canRequestNow(requester.id)) {
    return { error: "The player is unavailable or the request limit was reached." };
  }
  try {
    // The response comes from the specific logged-in player, not from a
    // caller-supplied socket field. A pending exact match is required.
    const confirmed = await requester.query(QUERY_CONFIRM, {
      requestId: message.requestId, subjectUuid: message.subjectUuid, scope: message.scope
    }, { timeout: 4500 });
    if (confirmed !== true) throw new Error("The player did not confirm this request.");
    const subject = await resolveSubject(message.subjectUuid);
    if (!subject || (subject.sceneId && requester.viewedScene !== subject.sceneId) ||
        !playerMayNote(subject.actor, requester)) {
      throw new Error("You need access to this NPC to create notes.");
    }
    const entry = await ensureJournal(subject, message.scope, requester.id);
    return { journalId: entry.id };
  } catch (error) {
    console.error(`${MODULE_ID} | NPC note creation refused`, error);
    return { error: "Unable to create NPC notes. Check permissions or ask the GM." };
  }
}

async function requestJournal(subjectUuid, scope) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error("A GM must be online the first time a note is created.");
  if (!game.user?.can?.("QUERY_USER")) {
    throw new Error("The GM must allow user queries for NPC note creation.");
  }
  const requestId = foundry.utils.randomID();
  const request = { requestId, subjectUuid, scope };
  waitingForConfirmation.set(requestId, request);
  try {
    const reply = await gm.query(QUERY_ENSURE, {
      ...request, userId: game.user.id
    }, { timeout: QUERY_WAIT_MS });
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
  throw new Error("Your Journal is not yet visible. Reopen notes in a moment.");
}

export async function openNotes(actor, scope) {
  if (!isValidScope(scope)) throw new Error("Choose party notes or personal notes.");
  if (!mayOpen(actor)) throw new Error("You need at least Limited access to this NPC.");
  const subjectUuid = subjectUuidForActor(actor);
  if (!subjectUuid) throw new Error("This NPC must be a saved world Actor or a placed token.");
  let entry = findJournal(game.journal, subjectUuid, scope, game.user.id);
  if (entry && !entry.testUserPermission(game.user, "OWNER")) entry = null;
  if (!entry) {
    if (game.user.isGM) {
      const subject = await resolveSubject(subjectUuid);
      if (!subject) throw new Error("This NPC is no longer in the world.");
      entry = await ensureJournal(subject, scope, game.user.id);
    } else {
      const id = await requestJournal(subjectUuid, scope);
      entry = await waitForJournal(id);
    }
  }
  // Opening the native sheet preserves Foundry's built-in rich text editor.
  entry.sheet.render(true);
  return entry;
}

export async function openChooser(actor) {
  try {
    if (!mayOpen(actor)) throw new Error("You need at least Limited access to this NPC.");
    const name = escapeHtml(actor.name);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `NPC Notes: ${actor.name}` },
      content: `<div class="pnn-chooser"><p>Notes about <strong>${name}</strong> are kept in Foundry Journals, separate from the NPC sheet.</p><p><strong>Party:</strong> editable by players with access to this NPC. <strong>Personal:</strong> visible to you and GMs.</p></div>`,
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
  if (actor?.documentName !== "Actor" || !mayOpen(actor)) return;
  if (controls.some(button => button.action === "pnn-notes")) return;
  controls.push({
    action: "pnn-notes",
    icon: "fas fa-book-open",
    label: "Player Notes",
    onClick: () => openChooser(actor),
    visible: true
  });
}

function addLegacyHeaderControl(app, buttons) {
  const actor = app.actor ?? app.object;
  if (actor?.documentName !== "Actor" || !mayOpen(actor)) return;
  if (buttons.some(button => button.class === "pnn-notes")) return;
  buttons.unshift({
    label: "Player Notes",
    class: "pnn-notes",
    icon: "fas fa-book-open",
    onclick: () => openChooser(actor)
  });
}

function addTokenHUDButton(app, html) {
  const actor = app.object?.actor ?? app.document?.actor;
  if (actor?.documentName !== "Actor" || !mayOpen(actor)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!(root instanceof HTMLElement) || root.querySelector(".pnn-token-button")) return;
  const container = root.querySelector(".col.right") ?? root.querySelector(".col.middle") ?? root;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon pnn-token-button";
  button.title = "Player NPC Notes";
  button.setAttribute("aria-label", "Player NPC Notes");
  const icon = document.createElement("i");
  icon.className = "fas fa-book-open";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void openChooser(actor);
  });
  container.append(button);
}

function scheduleSync(subjectUuid = null) {
  if (!isActiveGM()) return;
  Promise.resolve().then(() => syncSharedJournals(subjectUuid)).catch(error =>
    console.error(`${MODULE_ID} | Failed to sync shared Journal ownership`, error)
  );
}

Hooks.on("getHeaderControlsApplicationV2", addV2HeaderControl);
Hooks.on("getApplicationHeaderButtons", addLegacyHeaderControl);
Hooks.on("renderTokenHUD", addTokenHUDButton);

Hooks.once("ready", () => {
  CONFIG.queries[QUERY_ENSURE] = ensureRequestedNotes;
  CONFIG.queries[QUERY_CONFIRM] = confirmPendingRequest;
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = Object.freeze({
    open: openChooser,
    openShared: actor => openNotes(actor, "shared"),
    openPersonal: actor => openNotes(actor, "personal"),
    version: "0.1.0"
  });
  // Only existing module-managed shared Journals are touched, and only to
  // enforce the Actor's CURRENT visibility. Note content is never rewritten.
  scheduleSync();
});

Hooks.on("updateActor", (actor, changes) => {
  if (Object.hasOwn(changes ?? {}, "ownership")) scheduleSync(subjectUuidForActor(actor));
});
Hooks.on("createUser", () => scheduleSync());
Hooks.on("updateUser", (_user, changes) => {
  if (Object.hasOwn(changes ?? {}, "role")) scheduleSync();
});
Hooks.on("deleteUser", () => scheduleSync());