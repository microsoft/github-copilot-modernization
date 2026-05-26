# Frontend Clarification Kit — v1

Each field below is evaluated during the Clarification Gate to determine whether the user prompt provides sufficient context for a frontend rewrite or migration.

---

## Field Definitions

### target.framework
- **Importance**: required
- **Label**: Target frontend framework & version
- **Accepted evidence**: explicit name + major version in prompt, package.json diff, Figma tech note (e.g., "React 18", "Vue 3", "Svelte 5", "Angular 17")
- **Default if skipped**: ❌ no default — always prompt
- **Why it matters**: determines component model, lifecycle hooks, SSR strategy, and which component-library pairings are compatible

---

### target.component_library
- **Importance**: required
- **Label**: Target component / UI library
- **Accepted evidence**: explicit library name + major version (e.g., "shadcn/ui", "MUI v5", "Ant Design v5", "Radix UI", "Chakra UI v3", "Vuetify 3", "PrimeNG", "DaisyUI")
- **Default if skipped**: ❌ no default — always prompt (the single most impactful missing piece in internal test failures)
- **Why it matters**: drives accessibility baseline, theming API, import patterns, bundle size, and the entire component-mapping table in the spec

---

### visual.screenshots
- **Importance**: required (when existing UI is in scope)
- **Label**: Screenshots or screen recordings of current UI
- **Accepted evidence**: file paths attached to session, URL to staging/prod, description like "Figma already has all screens" with a Figma link
- **Default if skipped**: ❌ no default when UI pages are in scope; becomes optional for backend-only or purely-API brownfield work
- **Why it matters**: without a visual reference the spec cannot describe "what" to reproduce, leading to hallucinated layouts and missed edge states (empty state, error state, loading skeleton)

---

### visual.design_system
- **Importance**: required
- **Label**: Design system / design token source
- **Accepted evidence**: Figma link, Storybook URL, tokens file path (e.g., `design-tokens.json`, `tailwind.config.ts` with custom theme), or explicit instruction ("match existing pixel-by-pixel", "use brand colors in `src/theme.ts`")
- **Default if skipped**: `"match existing pixel-by-pixel using extracted CSS custom properties"`
- **Why it matters**: color, spacing, typography, and motion tokens must be consistent across old and new; without this the new UI will look visually divergent

---

### compliance.accessibility
- **Importance**: recommended
- **Label**: Accessibility standard to target
- **Accepted evidence**: "WCAG 2.1 AA", "WCAG 2.2 AA", "Section 508", "none / not required", or a link to internal a11y policy
- **Default if skipped**: `"WCAG 2.1 AA"`
- **Why it matters**: affects ARIA roles, keyboard navigation patterns, color-contrast ratios, focus management — all must be spec'd before task breakdown

---

### compatibility.browsers
- **Importance**: recommended
- **Label**: Browser / runtime compatibility targets
- **Accepted evidence**: explicit list ("Chrome, Firefox, Safari, Edge latest 2"), "modern evergreen", "IE11", browserslist string, `.browserslistrc` file path
- **Default if skipped**: `"modern evergreen (Chrome, Firefox, Safari, Edge — latest 2 major versions)"`
- **Why it matters**: affects transpilation targets, CSS feature usage (`:has()`, container queries), polyfill decisions, and test matrix

---

### responsive.breakpoints
- **Importance**: recommended
- **Label**: Responsive / adaptive strategy
- **Accepted evidence**: "mobile-first", "desktop-only", breakpoint list (`sm: 640px, md: 768px, lg: 1024px`), existing Tailwind config reference, or "match current layout exactly"
- **Default if skipped**: `"mobile-first using existing breakpoints detected from codebase"`
- **Why it matters**: determines grid system, layout component choices, and whether separate mobile views are needed

---

### i18n.locales
- **Importance**: optional
- **Label**: Internationalization — locales in scope
- **Accepted evidence**: list of locale codes ("en, fr, de, ja"), "none", "same as current", i18n library name
- **Default if skipped**: `"preserve current locales; keep existing i18n library if present"`
- **Why it matters**: i18n-aware component libraries have specific patterns for RTL, plural rules, and date formatting that must be accounted for in task breakdown

---

### state_mgmt.preference
- **Importance**: optional
- **Label**: Client-side state management preference
- **Accepted evidence**: library name ("Redux Toolkit", "Zustand", "Jotai", "Pinia", "NgRx", "signals"), "server state only (React Query / SWR)", "none / component state is enough"
- **Default if skipped**: `"preserve existing pattern if identifiable; otherwise recommend minimal (component state + server-state library)"`
- **Why it matters**: state topology affects component boundaries and data-fetching task decomposition

---

### routing.preference
- **Importance**: optional
- **Label**: Routing library / strategy
- **Accepted evidence**: explicit name ("React Router v7", "TanStack Router", "Next.js App Router", "Vue Router 4", "file-system routing"), or "match existing"
- **Default if skipped**: `"use the de-facto router for the chosen target framework"`
- **Why it matters**: determines code-splitting strategy and URL-contract preservation requirements
