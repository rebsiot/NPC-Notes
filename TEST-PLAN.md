# G06 Live smoke-test plan (not yet performed)

Target Foundry v14; test in an isolated world or restored copy, with one GM and at least two distinct real player logins. Record the exact Foundry and system versions, module 0.1.1, date, each step and result.

1. **Install/start:** enable module, reload clients; confirm no errors and that module.json matches `player-npc-notes` 0.1.1.
2. **Permissions setup:** Create two NPCs: one with Actor Limited for Alice/Bob, another None. Confirm the players cannot edit NPC stats or see protected GM sheet information. Visibility depends on the game system.
3. **First party note:** Alice opens the Limited NPC sheet; click Player Notes > Party Notes. With GM online, an editable native Journal appears. Note is only created once. Confirm sidebar entry is in `AFT NPC Notes` folder.
4. **Shared round-trip:** Alice writes and saves a distinct note. Bob opens the same NPC and sees/edits the same Journal. Alice sees Bob's saved change after reopening. GM can read it.
5. **Personal privacy:** Alice creates My Notes. Bob cannot find/open Alice's Journal by directory, UUID link or attempted direct open. Bob creates his own My Notes with independent contents. GM can view both. Alice can edit her own.
6. **No NPC mutation:** Compare the saved NPC before/after note creation (stats, descriptions, inventory, flags and ownership). Check no unintended change, and confirm standard Foundry Actor controls still work.
7. **Denied access:** Bob opens the inaccessible NPC/token. The module must not expose a notes action or GM-only Actor details. A forged/invalid user query request must not create a note for him.
8. **Permission revocation:** GM removes Alice's Limited permission for an NPC. Confirm Alice loses the party Journal; Bob retains it if permitted. Restore Alice's permission and verify she regains the same Journal, unchanged.
9. **Token HUD:** Repeat from a linked NPC Token. Open two unlinked Token instances from one template; confirm each maintains its own notes and the HUD button does not duplicate after rerender.
10. **GM offline:** After notes exist, disconnect GM; Alice and Bob must still edit Journals they own. Creating a first-ever note must report that a GM is required, without creating a broken placeholder.
11. **Multi-client concurrency:** Two players click first-create near-simultaneously. Confirm there is only one shared Journal per NPC and no client error.
12. **Persistence/rollback:** Reload both browsers, disable module (in test world), and confirm Journals remain readable from sidebar. Re-enable and open the same entries. Restore world snapshot if an unintended permission edit occurs.
13. **Cross-system repeat:** Run steps 2-9 separately in **D&D 5e** (`dnd5e`), **Pathfinder 2e** (`pf2e`) and **World of Darkness 20th** (`worldofdarkness`) using the installed versions. Report system-specific sheet/button issues separately.

**Release status:** Blocked from claiming live compatibility until the above exact workflows are observed. No current Foundry deployment or end-to-end browser test has been executed here.
