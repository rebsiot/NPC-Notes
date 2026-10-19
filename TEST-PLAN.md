# G06-NPC Notes: Foundry v14 live test plan

**Target build:** AFT NPC Notes 0.2.0 beta, module ID `player-npc-notes`.  
**Status:** None of these live steps have yet been performed. Automated/mock tests are not a substitute.

In a backed-up test world, use one GM and at least two ordinary players. Record exact Foundry, system and module versions, scene, date and pass/fail for each step.

1. **Install:** Install from the published manifest, enable it in the world, and reload GM/player clients. Verify title, version, no console errors and no changed Actor/Journals.
2. **NPC with zero Actor permission:** Set an NPC Actor's default/player access to **NONE**, place a visible token, and confirm a player cannot open its sheet or inspect statistics. Hover over that token and confirm a clickable book icon appears **without** granting Actor ownership.
3. **First party note:** Player clicks book with the GM online. Confirm exactly one editable native Journal opens, with a generic name, one `Notes` text page, and its association flag pointing to the correct Actor/Token UUID. Confirm no Actor updates.
4. **Collaboration:** Player A enters a note; Player B opens the same visible NPC and can read/edit it. GM can read it. Confirm the Journal has a separate ownership model from the Actor.
5. **Personal notes:** Right-click the hover book and enter a private note as Player A. Player B must not see it from the Journal directory, UUID direct link or token; a GM may read it. Personal/party content must stay separate.
6. **Legacy Journals:** Use a test copy of a v0.1.1 module-generated shared Journal accessible only to A. Upgrade and confirm its text and flags are unchanged and Player B is **not** automatically granted permission. Manually grant B Journal Owner and reopen, without altering the NPC Actor.
7. **Visibility:** Verify no hover icon for a token hidden from a player, not visible through current vision or on a different Scene. Try moving away/panning/zooming and confirm the icon follows correctly, disappears promptly and cannot be clicked after it becomes hidden.
8. **Linked/unlinked identity:** Put one linked NPC Actor on two Scenes and verify the same Journal UUID link; put two unlinked token copies of one template on one Scene and verify they get separate Journals.
9. **Normal HUD:** As GM or token owner, right-click token and confirm native HUD still shows the book once; all normal controls still work. A player without token ownership need not see the normal HUD, but must still see the hover shortcut.
10. **GM offline:** After Journals have been created, disconnect the GM and confirm existing notes still open for permitted players. First-time note creation should give an explanatory error rather than a damaged Journal.
11. **Concurrent first clicks:** A and B create/open notes almost simultaneously. Confirm a single shared Journal and no duplicate entries or unexpected permissions.
12. **Persistence/rollback:** Reload all clients, disable G06, and confirm Journals remain normal Foundry world documents. Restore code from saved v0.1.1 folder if needed. World text/ownership changes require the matching world snapshot to undo.
13. **Cross-system:** Repeat the NPC token visibility/HUD, party Journal, privacy, and linked/unlinked tests under actual installed D&D 5e (`dnd5e`), PF2e (`pf2e`) and WoD20 (`worldofdarkness`). Record per-system compatibility independently.

Do not mark a system live-compatible until its player/GM workflow actually passes in the specified build.
