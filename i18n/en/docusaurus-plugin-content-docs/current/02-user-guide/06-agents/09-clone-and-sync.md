---
title: Clone and Sync
description: Clone agents, choose private data scope, and resolve remote sync conflicts.
keywords: [Clone, agent clone, sync, conflicts, Agent Git]
---

# Clone and Sync

Clone creates a new agent from an existing one. Use it for experiments, project-specific variants, or personalizing a marketplace agent.

## Clone Modes

| Scenario | Behavior |
|----------|----------|
| Local agent | Copies AgentFS and creates a new agent ID |
| Agent with remote source | Can keep remote relation, fork, or become local-only |
| Marketplace agent | Copies core configuration and can still check updates |

The primary DesireCore agent is usually not cloneable.

## Private Data

You can choose whether to copy memory, preferences, relationship data, and local resources. Avoid copying private data when sharing an agent with others.

## Conflict Resolution

When local and remote changes touch the same file, DesireCore opens a conflict resolver. You can keep local, use remote, manually merge, or keep both. The resolved result is committed automatically.

