# Architecture Decision Record: Conversation Backend Adapter

## 1. Context and Problem Statement
OpenDots currently relies on `CopilotKit Intelligence` as its conversation backend, which handles chat streams, persistence, message orchestration, and tool execution tracking. To achieve data ownership, limit lock-in, and support custom "Digital Company" workflows (like meeting minutes and rigorous approval processes), we need to replace this external dependency with our own managed backend without breaking the existing UI and agent features.

## 2. Decision Options

### Storage: SQLite vs PostgreSQL
- **SQLite:** 
  - *Pros:* Zero-configuration, local file, very fast for single-tenant, already capable of handling moderate MVP traffic, easy to backup and isolate per workspace.
  - *Cons:* Limited concurrency for high write volume, lacks advanced features like logical replication for scaling, not ideal for a massive multi-tenant SaaS architecture.
- **PostgreSQL:**
  - *Pros:* Enterprise-grade, high concurrency, JSONB support, robust multi-tenancy.
  - *Cons:* Operational overhead, requires dedicated infrastructure, overkill for a Phase 0 / Gate 1 trial.

### Stream Contracts: Proprietary vs AG-UI
- **Proprietary (CopilotKit native):**
  - *Pros:* No need to adapt the client; works out of the box with the SDK.
  - *Cons:* Locked into their format, difficult to intercept or modify without maintaining a complex bridge.
- **AG-UI Protocol:**
  - *Pros:* Well-documented protocol for agentic events, supports custom rendering events, built for exactly this type of orchestration.
  - *Cons:* Requires a specific adapter boundary on the client to map AG-UI events to the React UI components.

## 3. Decision
- **Storage:** We will use **SQLite** for the MVP. It meets the requirement for a single owner pilot deployment. We will design the schema with a `tenant_id` column to prepare for future migrations, but we will not invest in multi-tenant PostgreSQL infrastructure until Gate 1 (3 paid pilots) is successfully passed.
- **Streaming & Contracts:** We will implement the **AG-UI stream contracts** as the communication layer between our local server and the client. The adapter will translate these events so the `CopilotKit` UI components can continue rendering smoothly, preserving the existing OpenDots UI look and feel.

## 4. Implementation Details (Persistence & Migration)
We will create a local persistence layer handling:
- `conversations` (id, title, created_at)
- `messages` (id, conversation_id, role, content, tool_calls, created_at)
- `turns` (id, conversation_id, status)
- `events` (for event sourcing and replay)
- `agent_state` (snapshot of the agent's memory)
- `approvals` (for the Gate 2 orchestrated tasks)

**Migration Strategy:**
1. Implement the generic `ConversationBackendProvider` interface.
2. Build the SQLite implementation of this interface.
3. Switch the dependency injection in `platform.ts` from `CopilotKitIntelligence` to our local implementation.
4. Verify reconnection logic (idempotency, no duplicate turns) without any `CPK_INTELLIGENCE_API_KEY`.
