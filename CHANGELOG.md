# Changelog - AFT NPC Notes

## 0.3.0 - 2026-10-18 (beta, live unverified)

### Players
- Left-click the book on the upper-left side of a visible NPC token to choose **Party Notes** or **My Notes**. Right-click still opens **My Notes** directly.
- NPC notes now use **one page per UUID** inside consolidated native Journals, instead of one Journal per NPC.
- Party notes live in **Party - Recurring NPCs** (linked world Actor UUIDs) and **Party - Scene NPCs** (unlinked placed Token UUIDs).
- Each player gets a private **Recurring NPCs** and **Scene NPCs** Journal as needed; personal pages are separate from shared pages.
- Clicking an NPC opens that NPC's exact page, using the Foundry v14 Journal page-navigation API.

### Permission and data behavior
- New party Journals use `default: Owner` for automatic access by existing and future world players. Everyone with Journal access can browse and edit all its pages. New personal Journals use `default: None`, explicit Owner only for the intended player; GMs retain normal access.
- Page access inherits the containing Journal's permissions; no page-specific ACLs or GM approval workflow.
- GM-mediated first page creation reuses the confirmed two-way user query and scene/visibility checks; subsequent openings do not require GM presence.
- New `collectionLink` flags on Journal Entries and `pageLink` flags on Pages (schema 2). A linked Actor UUID persists across scenes; an unlinked Token UUID identifies one token instance.
- Old `noteLink` schema-1 Journals are ignored, **not migrated, deleted, copied, renamed or edited**. No automatic legacy cleanup. Existing notes remain in the world and can be reviewed/deleted manually after backup.
- Existing module ID and manifest URL are unchanged. NPC Actor/Token/Scene documents, owned macros/hotbars, and other Journals are never written by the module.

### Testing
- 49 automated/mock Node tests pass (storage, duplicates, privacy, token/scene checks, chooser, navigation and old-document preservation); JS syntax checks pass. **No live Foundry v14 GM/two-player test has run**, and D&D 5e/PF2e/WoD20 system compatibility remains unverified.

### Before updating
- Back up the existing module folder and Foundry world Journals.
- New pages do not point at old per-NPC note content; older Journals must be accessed from the sidebar. Do not delete them until you review their contents.
- Restoring older module source leaves new Journals in the world but old code cannot open their pages from a token. Restore matching world backup to revert content changes.

## 0.2.1 - 2026-10-18 (beta)
- Linked Actor titles use their Actor name; unlinked Token titles use Token name and scene.
- Hover book moved to the token's upper-left; native HUD control moved left.
- Old short-UUID-generated Journal titles may be corrected on access by GM, custom titles preserved.
- Automated/mock-tested only; no live system verification.

## 0.2.0 - 2026-10-18 (beta)
- Visible-token notes shortcut without Actor sheet permissions; left-click party, right-click personal.
- UUID identity for linked/unlinked tokens; player/GM two-way creation confirmation.
- Existing Journal permissions left unchanged; no NPC Actor writes.

## 0.1.1 - 2026-10-18 (beta)
- Renamed user-visible module to AFT NPC Notes, with internal name G06-NPC Notes.
- Preserved `player-npc-notes` ID and original manifest.

## 0.1.0 - 2026-10-18 (beta)
- Initial Journal-based shared and private notes linked to NPC Actor/Token UUIDs.
- Actor-sheet and Token HUD shortcuts; GM-mediated Journal creation.
