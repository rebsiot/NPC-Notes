# AFT NPC Notes

**v0.2.1 beta** | **Foundry VTT v14 target** | **System independent**

A book icon appears on the **upper-left side** when players hover over a visible NPC token. Click it to open the group's notes about that character. Players do **not** need Limited, Observer or Owner access to the NPC Actor sheet. Notes are real Foundry Journal Entries, not a second character sheet.

**Status:** Automated/mock-tested; not yet verified in a live Foundry world. D&D 5e, PF2e and WoD20 are intended test systems, not live compatibility certifications.

## What you can do

- **Hover over a visible NPC token** and click the book to open **Party Notes**. A new Journal is created on the first visit when a GM is online.
- **Right-click the book** to open your **personal notes** for the NPC. They are visible only to you and GMs by default.
- **Use the regular Token HUD book icon on the left** as GM or token owner. The hover icon exists because Foundry normally does not show the native Token HUD to players for unowned NPCs.
- **Keep one Journal per NPC identity.** Linked tokens use the world Actor UUID; unlinked tokens each use their placed Token UUID. The same NPC's notes reopen on subsequent visits.
- **Edit with Foundry's native Journal editor.** No NPC statistics, descriptions, ownership, flags or game-system data are changed by the module.
- **Recognize NPCs by name:** linked tokens use the actual Actor name; unlinked tokens use `Token Name [seen in Scene Name]`. Journals retain UUID associations, even when titles change.

## Install in Foundry

In Foundry **Setup > Add-on Modules > Install Module**, paste this into **Manifest URL**:

```text
https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/module.json
```

Enable **AFT NPC Notes** in **Manage Modules** inside your world, then reload the clients. Manual ZIP installation is also possible: extract the release ZIP so `Data/modules/player-npc-notes/module.json` exists immediately inside that folder, with no extra nested folder. Stop Foundry before replacing installed module files. For the St. Louis server using Samba, that path is `Z:\Data\modules\player-npc-notes`.

**Before upgrading**, back up `Data/modules/player-npc-notes` and take a recoverable backup of your Foundry world's Journal data. Test this release in a separate world before using important campaign notes.

## How permissions work

Actor permissions and Journal permissions are independent:

- The player needs to be able to **see the NPC token on their current scene**, but receives **no access to the NPC's stat sheet**.
- **New Party Notes** Journals grant Journal **Owner** permission to current player-role users, with default **None**; GMs retain Foundry's normal access. Party notes are intended to be shared across the party. The GM can adjust individual Journal permissions using Foundry's native ownership controls. This does not grant Actor permission.
- **New My Notes** Journals grant Journal Owner to only that player (and implicit GM access).
- **Existing v0.1.0/v0.1.1 Journals retain their original text, flags and ownership.** The module deliberately stops automatic permission synchronization to Actor ownership. If an existing Journal does not allow a player to edit it, the GM must grant Journal Owner access to that particular Journal. Nothing is silently shared or migrated.
- New player accounts added later are not automatically granted Owner on earlier Journals. Manage existing Journal access in Foundry.

The first Journal for an NPC requires an **online GM client** to create the native Journal. Normal players do not need general permission to create Journals; the module uses Foundry v14 `User.query` with a reciprocal, pending-request confirmation and checks the clicked Token UUID, viewed Scene and client-visible Token state. Players need Foundry's **Query Other Users** permission for that first-create request. Existing Journals can be reopened when the GM is offline if the player already has Journal permission.

The Journal title identifies the NPC instead of displaying a short UUID. For a **linked Actor**, the title is based on the Actor name, for example `Detective Marcus Reed - Party Notes`. For an **unlinked Token**, the title uses the placed token's name and the scene where it was seen, for example `Desk Sergeant [seen in Downtown Precinct] - Party Notes`. Personal Journals use the same prefix followed by the user's name and `Notes`.

**GM privacy warning:** For a linked Actor, its **actual Actor name becomes readable in the player-owned Journal title**. If an Actor's name is a secret identity, that secret could be revealed. Name linked Actors accordingly before permitting notes, or use an unlinked Token with a suitably public name. The module does not copy GM biography, Actor statistics or secret fields into notes.

**Previous v0.2.0 Journals:** A previously generated name like `NPC abc123 - Party Notes` is corrected **in place when that Journal is reopened with an online GM**; the original Journal ID, pages, notes, flags and ownership are preserved. Player-renamed/custom titles are never changed by this correction. There is no bulk scan or rename on world startup. With no GM online, the existing Journal still opens under its prior title. Since this is a native Journal name update, a code rollback will not undo the name change. Back up world Journals first.

## Actor UUID and token instances

Association data is stored **only on the module-managed Journal** in flag `player-npc-notes.noteLink`, using `{schema:1, subjectUuid, scope, userId?}`. This matches previous releases.

- **Linked token:** `Actor.<id>`; the same NPC on another scene reopens the same notes.
- **Unlinked token:** `Scene.<sceneId>.Token.<tokenId>`; independent clones of a generic NPC have distinct notes.

If an NPC Actor or unlinked Token is deleted, its Journal is preserved rather than automatically deleted. There is no import/migration of unrelated Journals, no automatic hotbar assignment, and no change to macros or game-system rolls.

## Known limitations

- **Live UI test pending:** Confirm the left-side hover/HUD icon alignment, linked/unlinked titles, token overlay interaction, and native Journal creation in Foundry v14 with real GM and player sessions. Also repeat in D&D 5e, PF2e and WoD20; sheet/HUD customizations may differ by system.
- A token must be on the player's current Scene and visible to that client. Hidden/invisible or different-scene Tokens are rejected by the module's normal UI path. This is a normal game-UI restriction, not a claim of cryptographic protection against a malicious browser client.
- A first-time Journal cannot be created while all GMs are offline. Previously created Journals remain in the world's Journal directory.
- A token's original world UUID may no longer resolve after deletion or replacement. The original Journal remains in the directory and is not silently reassigned.
- For older shared Journals, player access might need a manual Journal ownership change. This is deliberate to prevent retroactive disclosure.
- An outside module that rewrites Journal permissions or hover/HUD rendering might conflict; check those features in a test world.
- This is a GitHub-distributed beta, not an official Foundry listing. The public repository has no adopted open-source reuse license; public download is not permission to relicense or redistribute the code.

## Upgrade and rollback

The module ID remains **`player-npc-notes`**, not `G06` and not the new displayed title **AFT NPC Notes**. The stable manifest URL has not changed.

Back up the module folder and a matching world Journal snapshot. Disable the module and stop Foundry before restoring the v0.1.1 module folder/ZIP. Re-enable and reload. **Existing Journals persist** if you disable or roll back the module; code rollback does not undo Journal edits, generated-title corrections, or permission changes made through the Journal editor. Restore the matching world snapshot only if you need to restore world-document changes.

## Development and testing

From the full source, use Node.js 20+:

```bash
npm test
npm run check
```

See [TEST-PLAN.md](TEST-PLAN.md) for the real Foundry test matrix. Passing Node/mock tests does **not** prove live Foundry behavior.

After Foundry's `ready` hook, `game.modules.get("player-npc-notes").api` exposes `open(actor)`, `openShared(actor)`, `openPersonal(actor)`, `openFromToken(token)` and `openPersonalFromToken(token)`. These are optional direct calls; there is no generated macro or hotbar assignment.

**Repository:** https://github.com/rebsiot/NPC-Notes  
**Manifest:** https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/module.json  
**Pinned beta ZIP:** https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/releases/player-npc-notes-0.2.1.zip
