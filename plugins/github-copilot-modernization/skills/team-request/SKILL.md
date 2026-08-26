---
name: team-request
description: How team members request infrastructure connection info and handle secrets in team mode
---

# Team requests

This skill is automatically loaded for all team members in team mode. It defines the requests that team members can make to each other.

## Requesting Infrastructure Connection Info

When your task requires connection to real Azure resources (databases, queues, storage, etc.), use the `request` tool to ask the **InfrastructureExpert** for connection values.

**What the InfrastructureExpert provides:**
- Connection strings (e.g., for databases, message queues, storage)
- Endpoint URLs with managed identity configuration
- Confirmation of resource changes you requested

**Workflow:**
1. Before performing work that requires real resource connections, call:
   ```
   request(from: "<your-name>", to: "<InfrastructureExpert-name>", taskId: "<your-task-id>", message: "I need the connection string for the PostgreSQL database")
   ```
2. The response contains ONLY the connection values — no subscription/RG/resource IDs.
3. Use the returned values to configure your code or tests.

**Requesting resource changes:**
If you need a resource modification (e.g., create a test database, add a firewall rule, create a queue, assign a role), use the `request` tool with a message describing the change. Do NOT attempt to run `az` commands yourself for resource provisioning.

Example:
```
request(from: "ITTester", to: "InfraExpert", taskId: "003-integrationTest", message: "Create a test database named 'app_test' on the PostgreSQL server and return the connection string with managed identity auth")
```
