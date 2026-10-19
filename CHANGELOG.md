# Changelog

## 0.2.0 - 2026-10-18 (beta, live verification pending)

- Added a hover book shortcut on visible NPC tokens, including tokens players do not own. Left-click opens Party Notes; right-click opens personal notes. The existing owner/GM Token HUD button remains available.
- Journals remain linked by Actor UUID for linked tokens and placed Token UUID for unlinked tokens. Previous `noteLink` flags and existing notes are retained without migration.
- No Actor permission is needed for the token shortcut. New party Journals receive their own explicit Player Journal Owner access; private Journals retain author-only plus GM access. Actor sheets/statistics remain unchanged.
- Existing Journals keep their exact permissions: automatic Actor-to-Journal permission synchronization from previous releases is removed. GMs can adjust Journal ownership manually where needed, avoiding silent disclosure of prior notes.
- GM-side first-create requests validate a same-scene Token UUID and the player's reciprocal client-visible token confirmation. Hidden, out-of-scene and no-visibility UI cases are refused.
- New shared Journals use generic titles to avoid revealing GM-only Actor names. The party can rename its own notes to an identified NPC name.
- Preserved the unchanged Foundry module ID (`player-npc-notes`), manifest URL, folder flag, Journal note flags, Actor-sheet compatibility, existing personal notes and all user content.
- Node.js 22: 35 automated/mock tests pass; syntax checks pass. **No live Foundry v14, D&D 5e, PF2e or WoD20 tests have been run.** The hover control and GM/player permissions must be checked in a test world.
- Back up both your module folder and world Journals before upgrading. For rollback, restore the previous full module folder/ZIP. Code rollback alone does not reverse native Journal edits or permissions.


## 0.1.1 - 2026-10-18 (beta, not live-verified)

- Displayed module name changed to **AFT NPC Notes**. Internal component name is **G06-NPC Notes**.
- New note Journal folders and the Token HUD tooltip use the updated name. Existing module-created folders and Journal notes remain unchanged and continue to be reused by their flags.
- Unchanged module ID `player-npc-notes`, native Journal association flags, Actor permission requirements, and manifest URL. This is a name-only release, not a new permission model.
- Automated/mock tests and syntax checks rerun for v0.1.1; live Foundry v14, D&D 5e, PF2e and WoD20 verification remains pending.
- Upgrade with the same Foundry manifest. Back up the module and world Journals before testing; the previous v0.1.0 ZIP is retained for rollback.


## 0.1.0 - 2026-10-18 (beta, not live-verified)

### Added
- A Player Notes action for supported Actor-sheet headers and Token HUDs.
- Native Foundry party Journals linked to a world Actor or individual unlinked Token UUID.
- Personal Journals restricted to one player plus GMs.
- GM-proxied first Journal creation using Foundry v14 User queries and a verified reciprocal pending-request handshake; no broad player Journal-create permission required.
- Deduplication, one managed Journal folder, and permission reconciliation for module-owned party notes.
- Optional `api.open`, `api.openShared`, `api.openPersonal` helpers.

### Preserved
- Existing Actor/Token values, flags, ownership, item data and game-system sheets.
- All ordinary Journals and previously entered note content. No import, mass adoption or data migration.

### Compatibility and limitations
- Designed for Foundry v14 and not tied to a game-system schema. **Live** D&D 5e, PF2e and WoD20 compatibility is pending.
- Actor Limited permission is required; the sheet-specific content that Limited reveals depends on the system.
- First Journal creation requires a connected GM; existing notes can be edited without one.
- Unlinked tokens keep separate instance notes; orphan notes are not deleted.
- The repository provides a manifest and versioned ZIP; no GitHub Release asset or official Foundry listing is claimed. No open-source license is assigned.

### Verification
- Syntax checks: passed, Node.js 22.
- 28 local mock/automated tests: passed.
- Live Foundry/GM/player/two-client checks: **not run**.

### Install/rollback
- Foundry manifest `https://raw.githubusercontent.com/rebsiot/NPC-Notes/main/module.json` installs the full module ZIP. Back up the existing module folder and world Journals beforehand.
- Restore the previous ZIP for a code rollback. Journal data persists unless the backed-up world data is explicitly restored.
