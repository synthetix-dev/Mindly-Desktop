# Intelligence Dependency Map & Removal Plan

## 1. Dependency Graph

The `CopilotKit Intelligence` component is deeply integrated into the current architecture of OpenDots. Based on our source code analysis, the dependencies are distributed as follows:

- **@copilotkit/runtime / @copilotkit/runtime/v2**
  - **`CopilotKitIntelligence`**: Instantiated in `src/server/platform.ts` and passed around the application to manage conversations, turns, and agent state.
  - Used in `src/server/learning.ts` for type references and possibly learning mechanisms.

- **@copilotkit/core**
  - **`IntelligenceAgent`**: Imported and utilized in `src/server/headless.ts` for voice compute, server-side orchestration, and scheduled tasks.

- **Application Logic Dependencies (The Impacted Areas):**
  - `src/server/platform.ts`: Holds the core initialization of `CopilotKitIntelligence` and throws setup errors if keys/connections are missing.
  - `src/server/dot-agent.ts`: Heavily relies on Intelligence to instantiate Dot agents and validate model configurations.
  - `src/server/page-service.ts`: Exposes a `PageIntelligence` interface and wraps Intelligence calls, tracking timeouts and conversation state.
  - `src/server/workspace-routes.ts`: Validates legacy tasks and routing logic for Voice/Dot/Space contexts that assume an active Intelligence backend.
  - `src/server/voice.ts` & `src/shared/voice-receipt.ts`: Assumes Intelligence is responsible for transcript sync and relies on it for message ID preservation.
  - `src/server/headless.ts`: Spawns headless `IntelligenceAgent` instances.
  - `src/server/index.ts`: Protects legacy task executions by enforcing the presence of an Intelligence conversation.
  - `src/shared/scheduled-message.ts`: References Intelligence history replays.
  - `src/client/WorkspaceDialog.tsx`: UI tightly coupled to prompting users to enable "delivery in Intelligence".

## 2. Adapter Boundary (Target Architecture)

To remove `CopilotKitIntelligence` while preserving the UI and core OpenDots functionalities (like Spaces, Specialist Dots, and OpenBot), we must establish an **Adapter Boundary**:

- **Core Abstraction Layer:** We will introduce a local interface (e.g., `ConversationBackendProvider`) that our application code relies on instead of the `CopilotKitIntelligence` class directly.
- **Persistence:** Replace the hosted Intelligence store with a local database implementation (starting with SQLite, migrating to PostgreSQL later if needed) storing `conversations`, `messages`, `turns`, `events`, `agent_state`, `tool_calls`, and `approvals`.
- **Event Streaming:** We will use `ag-ui` protocol stream contracts to stream agent events back to the client, replicating the behavior that CopilotKit Intelligence used to provide over SSE/WebSockets.

## 3. Removal Plan (Phase 0)

1. **Phase 0.1: Isolate Core Interfaces**
   - Extract the interfaces used by `src/server/platform.ts`, `src/server/page-service.ts`, and `src/server/dot-agent.ts` into agnostic types (e.g., `Conversation`, `Turn`, `Message`).
   
2. **Phase 0.2: Implement Local Storage (SQLite MVP)**
   - Create schemas for conversations, messages, agent states, and tool approvals.
   - Implement the generic `ConversationBackendProvider` using this local DB.

3. **Phase 0.3: Replace Intelligence Hooks in Server**
   - Swap `new CopilotKitIntelligence({...})` in `platform.ts` with our local backend initialization.
   - Remove `IntelligenceAgent` from `headless.ts` and replace it with a local orchestration queue (laying ground for Phase 2 Approved Task Orchestration).
   - Rewrite `page-routes.ts` and `workspace-routes.ts` to use the local context manager.

4. **Phase 0.4: UI and Client Synchronization**
   - Remove references to "Intelligence project" in `WorkspaceDialog.tsx`.
   - Ensure the client connects via our new event stream (AG-UI protocol) rather than the Intelligence proprietary stream, keeping `@copilotkit/react-core` UI intact if possible, or replacing its state management hooks with generic equivalents if it requires the proprietary backend.

5. **Phase 0.5: Validation**
   - Run the acceptance tests outlined in the TZ: Verify that without any Intelligence API keys, the system starts, chats stream, history reloads, tool approvals trigger, and background tasks run correctly.
