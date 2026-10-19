# AFT NPC Notes

**v0.3.0 beta** | **Foundry VTT v14 target** | **System-independent module**

Take notes on NPCs directly from their tokens without opening an NPC character sheet. A book icon appears on the upper-left side of any visible token. Click the book, choose **Party Notes** or **My Notes**, and edit the NPC's page in a normal Foundry Journal.

**Status:** Automated/mock tested. Live Foundry v14 testing (including D&D 5e, PF2e, and WoD20) has not yet been completed.

## How it works

1. Hover over a visible token and click the book icon on its **left** side. This works for a player who has no permission to the Actor sheet.
2. Choose **Party Notes** (shared with all players) or **My Notes** (only you and the GMs).
3. Foundry opens the right page in a native Journal; edit and save it normally.
4. Reopen the same NPC to revisit the same page. **Right-click the book** to open My Notes immediately without the chooser.

The book control in the standard Token HUD and the Actor-sheet header (when available) also opens this chooser. Those controls retain native Foundry access requirements; the hover shortcut is the main player workflow.

## Journal structure

The module creates only the Journals needed by actual use; there is no empty-Journal bulk setup.

Inside the **AFT NPC Notes** folder:

- **Party - Recurring NPCs:** one shared Journal, one page for each linked world Actor UUID.
- **Party - Scene NPCs:** one shared Journal, one page for each unlinked placed Token UUID.
- **Player Name - Recurring NPCs (Personal):** one private Journal for that player, with pages per linked Actor UUID.
- **Player Name - Scene NPCs (Personal):** one private Journal for that player, with pages per unlinked placed Token UUID.

In Foundry the Journal names use an em dash between the label and NPC category. A linked Actor's page is named for that Actor (e.g. `Detective Marcus Reed`). An unlinked token's page is named `Token Name [seen in Scene Name]` (e.g. `Security Guard [seen in Nightclub]`). Names are presentation only; the UUID flags identify the pages. Custom page names and page content are not overwritten.

A linked NPC has the same notes page regardless of which scene its token appears in. Two unlinked guards can have the same displayed name but retain distinct UUID-linked pages inside the Scene NPCs Journal.

## Install or update

In Foundry **Setup > Add-on Modules > Install Module**, use this **Manifest URL**:

```text
https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/module.json
```

Enable **AFT NPC Notes** for the world under **Manage Modules**, then reload player clients.

For a manual installation, stop Foundry and extract the complete ZIP so `Data/modules/player-npc-notes/module.json` exists immediately in that folder (no extra nested folder). The module ID **`player-npc-notes`** is unchanged. On the St. Louis server's Samba share, the corresponding directory is `Z:\Data\modules\player-npc-notes`.

**Before upgrading:** Back up both the entire existing `player-npc-notes` module directory and the **world's Journals**. Test with a backup/test world before enabling it for a live campaign. A module-folder backup alone does not preserve world notes.

## Access and privacy

- **NPC Actor permissions are never changed.** A player who sees the token can use the hover shortcut even if Actor permission is None. NPC stats and GM descriptions remain in the NPC Actor, not in player notes.
- **Party Journals:** Journal `default: Owner` allows all current and future world players to read, edit and navigate **every page** in that Journal, including pages for tokens not currently visible to them. This is intentional party collaboration. A GM may restrict a user via native Journal ownership controls; the module does not automatically override existing Journal permissions.
- **Personal Journals:** Journal `default: None`, with an explicit Owner grant only to that player. Other players should not be able to browse them. Foundry GMs can read and manage all personal Journals; My Notes are **not private from the GM**.
- **Page-level permissions:** Not managed by this module. A page inherits access from its Journal. We deliberately do not depend on or enforce page-by-page ACLs.
- **First creation:** An active GM must be connected when a player's first page for a particular NPC/scope is created, even if the parent Journal already exists. The request is verified against the player's locally visible token and the GM's scene check before creating native documents. After a page exists, its Journal Owner can open and edit it without a GM connected. Foundry's Query Other Users permission must be available for first creation.
- **Names:** Recurring NPC pages use the linked Actor's actual name; this may reveal a secret NPC identity in the party Journal even though NPC stats stay protected. Use a player-safe Actor name if that matters.
- **Trust model:** Players with Journal Owner access can edit/delete shared pages using native Foundry controls. Back up Journals if this matters; the module is not a GM approval or revision-control system.

## Upgrading from v0.2.1: no migration

Version 0.3.0 starts a **new** consolidated Journal/page structure (`collectionLink` and `pageLink` flags, schema 2). The module **does not** migrate, copy, delete, archive, re-title or adopt v0.2.1 per-NPC Journals (`noteLink` schema 1). Old Journals remain in the world and can be read manually through the Journal Directory. Clicking a token creates or opens its new consolidated page instead. If you want to remove older Journals, inspect and back them up first, then delete only the entries you no longer want **yourself**.

The module also avoids taking over unrelated Journals with similar names: it identifies its own consolidated storage strictly by namespaced flags, not by title.

**Code rollback:** Disable the module, stop Foundry and restore the prior full version of `Data/modules/player-npc-notes`. Journals created by v0.3.0 remain native Foundry documents, but v0.2.1 will not navigate them via the token shortcut. To roll back world Journal content or permissions, restore a corresponding **world data backup**, not just the module ZIP.

## Limitations and tests

- No live Foundry v14 installation or GM/two-player session has been verified for this release. Test the left-side hover and right-click flow, native Journal page rendering/editor, GM-mediated creation, player permissions, and reopening after refresh in an isolated world.
- D&D 5e (`dnd5e`), Pathfinder 2e (`pf2e`) and WoD20 (`worldofdarkness`) are intended targets, but system-specific UI compatibility remains unverified.
- This release does not offer migration/legacy import, a global NPC notes search, a bulk page organizer or automatic removal of notes for deleted tokens.
- Notes remain on their original page when an NPC/token is renamed. This preserves user-customized titles rather than attempting to guess which titles should be updated.

See [TEST-PLAN.md](TEST-PLAN.md) for live checks and [CHANGELOG.md](CHANGELOG.md) for version history.

## Developer API

After `ready`, `game.modules.get("player-npc-notes").api` exposes:

- `chooseFromToken(token)` - show the Party/My Notes chooser for a visible token
- `openFromToken(token)` - open shared notes directly (backward-compatible macro API)
- `openPersonalFromToken(token)` - open personal notes directly
- `open(actor)`, `openShared(actor)`, `openPersonal(actor)` - Actor-sheet-oriented helpers that honor the Actor access check

No macros or hotbar slots are added automatically.

**Repository:** https://github.com/rebsiot/NPC-Notes  
**Direct v0.3.0 install ZIP:** https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/releases/player-npc-notes-0.3.0.zip  
**Support:** https://github.com/rebsiot/NPC-Notes/issues

This public repository has not been assigned an open-source software license. Public availability is not blanket permission to redistribute or modify. It is not an official Foundry package listing.
