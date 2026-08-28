# @mrpl/dsh-workbench-ui

**Priority: 🔴 Essential**

## Purpose

Secure Workbench chat/workspace/security-indicator client. This is the client plugin for the Sovereign AI Workbench defined in `workbench/DESIGN.md`.

It provides NO backend `ctx` service. It consumes the harness `dsh-sdk`, the harness session/event stream, `wb-audit` read API, and `wb-policy` live decision stream.

## Architecture

This package registers directly into the client framework's `dsh-client-ui-slots`. It replaces the generic harness `ui-conversation` and `ui-sidebar` components by providing specific React components into the `sidebar`, `conversation`, and `details` slots.

- **SidebarRoot**: Replaces the left sidebar with MRPL branding and primary navigation. Includes the Local/Sovereign Security Indicator.
- **ConversationRoot**: Replaces the main chat frame with the Sovereign AI workspace, preset selections, and the customized chat composer.
- **DetailsRoot**: Replaces the details panel with an Activity and Security timeline.
