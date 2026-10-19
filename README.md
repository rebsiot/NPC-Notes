# AFT NPC Notes

**Version:** 0.1.1 beta (2026-10-18)  
**Target:** Foundry VTT v14; game-system independent by design  
**Status:** Automated/mock tested. NOT yet verified in a live Foundry world.

Give players a simple place to record what they learn about an NPC, without giving them ownership of its character sheet. Notes use normal Foundry Journal Entries and the native Journal editor.

## What it does

- Adds **Player Notes** to Actor-sheet header controls and the Token HUD where the Actor is accessible.
- **Party Notes:** one Journal associated with that NPC, editable by players who have at least **Limited** permission to the Actor.
- **My Notes:** one separate Journal per player/NPC, visible to that player and all GMs, not to other players by default.
- Creates the Journal automatically on first use through an online GM client using Foundry v14 user queries, **without** giving players general Journal creation permission.
- Never changes NPC stats, descriptions, items, GM notes or ownership to enable note-taking.
- Reuses existing module-created Journals on repeated clicks; one `AFT NPC Notes` folder holds them. Previously created, flagged folders are reused without renaming.

Notes are associated using module flags on the **Journal**, not on the Actor. Linked tokens use the source world Actor identity; unlinked tokens use their own placed Token UUID so separate instances of generic NPCs can have separate notes.

## Install with a manifest (beta)

In Foundry Setup, choose **Add-on Modules > Install Module**, paste this URL into **Manifest URL**, then install:

```text
https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/module.json
```

The manifest downloads the complete v0.1.1 ZIP from this repository. The ZIP and manifest must both be available over HTTPS before trying the URL. After installation, enable the module in **Manage Modules** within the intended world. Keep a backup of your world Journals before testing.

## Manual ZIP installation (alternative)

1. Make a recoverable backup of the test world's Journal Entries and of any existing `player-npc-notes` module folder. Test on a backup/test world first.
2. Stop Foundry before changing module files.
3. Extract the install ZIP so `Data/modules/player-npc-notes/module.json` exists directly in the module folder. There must not be an extra nested `player-npc-notes` folder.
4. Restart Foundry. In the desired world, open **Manage Modules**, enable **AFT NPC Notes**, and reload the clients.
5. The GM should grant players **Limited** (or greater) Actor permission on the NPCs they are meant to annotate. Players do **not** need Actor Owner permission or general Journal creation rights.

For the St. Louis server using Samba, the module directory is `Z:\Data\modules\player-npc-notes`. `Z:\` is the user-data root, not Foundry's `Data` directory.

**Repository:** https://github.com/rebsiot/NPC-Notes  
**Install ZIP:** https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/releases/player-npc-notes-0.1.1.zip

The current beta uses a versioned ZIP stored in the public GitHub repository, not a GitHub Release asset. This is a real distribution URL after publication, but not a claim of Foundry live compatibility.

## Use

1. Open an NPC Actor sheet and use the **Player Notes** header control, or use the book icon on the NPC Token HUD.
2. Click **Party Notes** or **My Notes**.
3. The existing Journal opens, or a new Journal is created if none exists. Edit its **Notes** page with the normal Foundry editor.
4. Open the same NPC again to return to the same Journal. Party notes are shared; personal notes stay in separate Journals.

A GM must be connected for the **first creation** of a Journal unless the GM is opening it themselves. Players must have Foundry's **Query Other Users** permission (normally enabled) to request GM-assisted creation. Once created, players can use their existing Journals even when no GM is online, subject to existing Journal permissions. A player with no Actor permission will not see the module's action even if the token artwork is visible.

## Privacy and permissions

- NPC Actor permission and Journal permission are separate. The module never gives players Actor **Owner** permission.
- Party Journals use explicit **Owner** permission for all non-GM users with at least Actor **Limited** access, and default **None** for other users.
- Personal Journals use **Owner** for the requesting player, default **None** for other players. **GMs can read personal Journals.** They are not secret from the GM.
- The active GM rechecks permissions on managed party Journals at login and when Actor ownership or user roles change. It can grant/revoke Journal access accordingly without changing note content.
- A Journal Owner can edit that Journal under Foundry's normal rules. This module does not replace Foundry's document security model or guarantee that external journal-sharing modules cannot alter visibility.
- **Important:** What a player can see on an NPC Actor with Limited permission differs by game system and sheet. Confirm that system-specific sheets do not disclose GM secrets at Limited permission before enabling this for NPCs.
- The module acts only on Journals with its own association flag. It will not adopt, overwrite or migrate ordinary Journals or automatically attach notes to every NPC.

## Limitations

- Native Actor-sheet headers and Token HUDs may vary across system sheets; exact D&D 5e, PF2e and WoD20 user-interface compatibility is **not yet live-tested**.
- There is no built-in GM migration tool for importing notes from other modules in 0.1.1.
- Notes for deleted Actors or tokens are preserved as orphaned Journals; no automatic deletion or reassociation occurs.
- If an unlinked token is deleted, its instance-specific notes remain in the Journal folder but the original UUID no longer resolves.
- GM-owned shared Journal permission may be affected by independent modules that change Journal permissions or Actor visibility.
- This is a publicly accessible beta repository, **not** an official Foundry package listing. No open-source reuse license has been selected; public read/download access is not an unrestricted license to redistribute or modify it.

## Upgrade and rollback

Before upgrading, back up both the module folder and your **world's Journal Entries**. Replacing source code never substitutes for a world-data backup. Keep the old ZIP and world snapshot.

To roll back a code-only upgrade, disable the module, stop Foundry, restore the former module folder, and restart. Existing note Journals are intentionally **not deleted** if you disable/remove the module. Those Journals remain as normal Foundry documents; players retain whatever permissions were last assigned to them. Reverting code does **not** revert edits to Journal text or ownership; restore the matching world snapshot if that is required. Do not bulk-delete `AFT NPC Notes` or earlier `Player NPC Notes` Journals without individual review and a backup.

## Testing

From source: run `npm test` and `npm run check` with Node.js 20+. These are mock/static tests, **not** a live Foundry verification. See [TEST-PLAN.md](TEST-PLAN.md) for the required GM/player checks before broader use.

## Developer-facing API

After the `ready` hook, `game.modules.get("player-npc-notes").api` exposes `open(actor)`, `openShared(actor)` and `openPersonal(actor)`. Pass a real world/synthetic Actor object. This optional API is for deliberate macro use; the module does not create macros or modify hotbar slots.

## Source and release

AFT NPC Notes is maintained in [rebsiot/NPC-Notes](https://github.com/rebsiot/NPC-Notes). The repository contains the complete installable ZIP as a versioned artifact and a root-level Foundry manifest. The full module source is included in that archive. This beta has not passed a real GM/player Foundry v14 test.
