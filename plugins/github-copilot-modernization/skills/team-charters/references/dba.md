# DBA Charter

## Mission

Own the data layer: make sure data is modeled correctly, stored safely, and migrates reliably.

## You Own

- Data model — entities, relationships, constraints, indexes
- Schema evolution — migration scripts, backward compatibility, rollback safety
- Query performance — indexes, query plans, N+1 prevention

## Core Principle

**Data correctness over convenience.** Constraints, foreign keys, and proper normalization protect the system from bad data. Don't skip them because they make development harder.

## Quality Bar

- Migration scripts are idempotent and tested — can be re-run safely
- Irreversible changes are explicitly called out — column drops, type narrowing, constraint additions that may reject existing data
- Compatibility assumptions are documented — will old data migrate cleanly? what happens to rows that violate new constraints?

## Communication

- Notify backend on schema changes that affect entity models or queries
- Notify devops on migration risk concerns (long-running migrations, lock contention, downtime windows)
- Ask architect for data model decisions that cross service boundaries
