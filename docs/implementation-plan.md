# Implementation Plan

## Overview
This document outlines the ordered pull requests (PRs) and acceptance criteria required to build the Digital Company product, replacing CopilotKit Intelligence with a local backend and implementing the strict textual workflow. 

**Critical Rule:** The sequence is immutable. No voice, LiveKit, 3D characters, or dynamic islands are to be implemented before Gate 1 is passed.

---

## 0. Smoke Test Baseline (Completed)
- **Status:** PASS
- **Result:** `npm run test` completed with 302 tests passing. The existing OpenDots fork functions correctly with its current dependencies, setting a reliable baseline before migration.

---

## Phase 0: Replacing Intelligence (Conversation Backend)
**Goal:** Remove `CopilotKit Intelligence` dependency while keeping UI and OpenBot functionality.

- **PR 0.1: Database Schema & Interfaces**
  - Define `ConversationBackendProvider`.
  - Create SQLite schema migrations for `conversations`, `messages`, `turns`, `agent_state`.
  - *Acceptance:* Interfaces are defined, typechecks pass, SQLite database initializes locally.
- **PR 0.2: Server Integration (Local Backend)**
  - Replace `new CopilotKitIntelligence()` with local SQLite backend in `src/server/platform.ts`.
  - Refactor `src/server/page-service.ts` and `src/server/workspace-routes.ts` to use local storage.
  - *Acceptance:* Server boots without `CPK_INTELLIGENCE_API_KEY`.
- **PR 0.3: Client AG-UI Adapter**
  - Implement a stream adapter mapping the local backend events to the AG-UI protocol expected by the client.
  - *Acceptance:* Chat streams load in the UI; reload restores history; no duplicate turns on reconnect.

---

## Phase 1: Text Team Room & Minutes
**Goal:** Implement a group chat where agents wait their turn and summarize outcomes.

- **PR 1.1: Room Entity & Membership**
  - Create `Team Room` UI component (reusing OpenDots styles).
  - Add `+ Add Employee` dynamic functionality.
  - *Acceptance:* User can add/remove multiple Dots dynamically.
- **PR 1.2: Agent Routing & Arbitration**
  - Implement `@agent` routing, `Ask all` sequential turns.
  - *Acceptance:* Agents do not speak out of turn.
- **PR 1.3: Meeting Minutes & Drafts**
  - Implement the `Summarize` command generating `Minutes`.
  - Implement `Convert to proposed tasks` creating drafts.
  - *Acceptance:* Draft tasks are created but NOT executed. Competing edits to minutes do not silently overwrite.

---

## Phase 2: Approved Task Orchestration (Company Orchestrator)
**Goal:** Guarantee that agents only execute tasks with explicit human approval.

- **PR 2.1: Task FSM & UI**
  - Implement state machine (`draft -> pending_approval -> approved -> queued -> running -> needs_review/failed/completed`).
  - Create `Tasks/Approvals` UI.
  - *Acceptance:* Tasks cannot transition to `running` without user explicitly clicking "Approve".
- **PR 2.2: Execution Engine & OpenBot Integration**
  - Implement durable queue (checkpointing, timeouts).
  - Connect task execution to isolated OpenBot contexts.
  - *Acceptance:* Parallel tasks execute in isolated containers. Crash mid-task results in recovery without duplicate side-effects.

---

## Phase 3: Catalog Change Pack (The Wedge)
**Goal:** Deliver the first concrete e-commerce product use case.

- **PR 3.1: CSV Input & Artifact Manifests**
  - Build CSV parser and output formatter for the table: `before → proposed → evidence/source → risk → approval status`.
  - *Acceptance:* System parses user CSV, processes it, and generates output CSV and `artifact_manifest.json` without modifying the original.
- **PR 3.2: Evidence & Quality Constraints**
  - Implement strict instruction layers ensuring agents mark `needs_source` if no evidence is found.
  - *Acceptance:* 5 test catalogs result in 0 undetected hallucinated critical fields.

---

## Gate 1: Commercial Validation
*(No PRs. This is a business evaluation gate requiring 3 paid pilots from 10 demos.)*

---

## Post-Gate 1 (Blocked for now)
- **Phase 4:** Operational Reliability (Backups, multi-tenant RBAC).
- **Phase 5:** Voice Meetings (LiveKit PoC).
- **Phase 6:** 3D Characters & Dynamic Island.
