# Security & Threat Model

## 1. Introduction
This threat model addresses the risks associated with the Phase 0 (and subsequent) architecture of the OpenDots Digital Company fork, focusing on local conversation backends, isolated execution environments, and user-provided inputs like CSVs.

## 2. Key Components
1. **Conversation Backend (Local SQLite via Adapter):** Handles chat, approval state, and persistent records.
2. **OpenBot Execution Environment:** Used by agents (Dots) to browse, read, and write in isolation.
3. **Company Orchestrator:** Manages Task Approval, queues, and dependencies (Phase 2).
4. **Input Pipeline (CSVs & external references):** Untrusted data streams (Phase 3).

## 3. Threat Scenarios & Mitigations

### 3.1 Prompt Injection via User Input (CSVs & URLs)
- **Risk:** A malicious user or an attacker controlling an external reference link inserts prompt injection commands into the `description` or `category` fields of a CSV, tricking the Product Fact Checker agent into skipping approvals, granting admin roles, or writing malicious scripts.
- **Mitigation:** 
  - Strictly typed input parsing. 
  - Agents operate with minimal privileges. 
  - **Crucial:** Tools never execute mutations against external systems directly. The Orchestrator forces a strict `proposed_task -> user_approval` state machine. Even if an agent hallucinates an approval, the cryptographic/system-owned task state cannot be advanced by the agent.

### 3.2 Environment Breakout & Data Exfiltration (OpenBot)
- **Risk:** Agents using OpenBot to execute tasks might download malicious scripts or exfiltrate the provided catalog data to external servers.
- **Mitigation:**
  - Network egress filtering on the OpenBot containers (allowlisting specific needed domains like Shopify/WooCommerce staging APIs only if required, otherwise block all).
  - Hardening of Docker containers (no privileged mode, readonly root filesystem where possible).
  - Secrets (like real CMS API keys) are never injected into the generic OpenBot environment unless explicitly scoped to a final, human-approved publishing step.

### 3.3 Access Control & Multi-tenancy (Future Risk)
- **Risk:** In a multi-tenant deployment, Dot A acting on behalf of Tenant 1 accesses the CSV or SQLite rows of Tenant 2.
- **Mitigation:**
  - MVP is strictly Single-Tenant. 
  - The SQLite schema introduces `tenant_id`, and row-level security or explicit API filtering must be applied before Gate 1 if scaling beyond a dedicated instance per pilot.

### 3.4 Unpredictable Cloud Costs
- **Risk:** Agents get stuck in an infinite loop (e.g., trying to read an unparseable webpage), burning tokens and compute hours.
- **Mitigation:**
  - Implement a `budget` (token limit & depth limit) per task.
  - No unlimited loops: after X tool errors or retries, task automatically transitions to `needs_review` / `failed`.

### 3.5 Secrets Leakage in Transcripts
- **Risk:** An agent logs a CMS password in its reasoning process, which gets saved to the local SQLite and exposed in the `meeting_minutes.md`.
- **Mitigation:**
  - Never provide raw passwords to the agent's context. Use an OAuth token flow or generic publishing service where the agent only sends the payload.
  - Scrub known secret patterns before saving to the local event stream.
