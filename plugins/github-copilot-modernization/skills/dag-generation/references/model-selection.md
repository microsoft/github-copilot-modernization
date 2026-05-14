# Model Selection by Task Phase

When dispatching workers, set the `model` parameter based on the task's tier to optimize cost vs quality.

## Guiding Principle

- **Plan phase** needs deep reasoning, architectural analysis → strongest available model within budget
- **Execute phase** needs reliable code generation and tool use → cost-efficient
- **Review phase** needs deep understanding of architecture and security → strong reasoning
- **Test phase** needs test execution and verification → prefer free/low-cost models
- **Cost ceiling**: prefer models at 3x multiplier or below. Avoid 7.5x+ models unless no alternative.

## Tier Fallback Lists

Priority-ordered. Pick the **first available**. 0x = included/free.

### Tier 1 — Deep Reasoning (Plan phase, architecture, quality gates)

1. Claude Opus 4.6 (3x)
2. GPT-5.4 (1x)
3. GPT-5.2 (1x)
4. GPT-4.1 (0x)

### Tier 2 — Backend Implementation (Execute phase, backend)

1. Claude Sonnet 4.6 (1x)
2. GPT-5.3-Codex (1x)
3. Claude Sonnet 4.5 (1x)
4. GPT-5.4 mini (0.33x)
5. GPT-4.1 (0x)

### Tier 3 — Frontend & UI (Execute phase, frontend/UX)

1. GPT-5.4 (1x)
2. Claude Sonnet 4.6 (1x)
3. Claude Sonnet 4.5 (1x)
4. GPT-5.4 mini (0.33x)
5. GPT-4.1 (0x)

### Tier 4 — Code Review (Architecture review, security audit)

1. Claude Opus 4.6 (3x)
2. Claude Sonnet 4.6 (1x)
3. GPT-5.4 (1x)
4. GPT-4.1 (0x)

### Tier 5 — Testing (Runtime validation, conformance, test generation)

1. GPT-5 mini (0x)
2. GPT-4.1 (0x)
3. Claude Haiku 4.5 (0.33x)
4. GPT-5.4 mini (0.33x)

## How the Coordinator Uses This

1. At first dispatch, resolve each tier to the first available model from the fallback list
2. Set `model` on each worker based on the task's tier field
3. If dispatch fails with "model not available", try the next in the list

## Notes

- Model name format varies by platform — use whatever the platform requires.
- 0x models don't consume premium quota — tier-5 defaults to these.
- Recommendations based on May 2026 benchmarks. Update periodically.
