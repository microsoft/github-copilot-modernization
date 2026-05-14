Analyze the codebase for complexity and migration risk. Focus on:
- Business logic complexity per module (lines of code, cyclomatic complexity, coupling)
- Framework-specific patterns tightly intertwined with business logic (hard to extract)
- Session and auth patterns (how user state is managed, security enforcement points)
- Test coverage gaps in high-complexity areas
- Risk classification per module: LOW / MEDIUM / HIGH / CRITICAL

> ⚠️ **Assess complexity and risk of the existing code only.** Do not suggest how to rewrite or refactor.

Output: `./migration-risks.md`
