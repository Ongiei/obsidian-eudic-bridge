# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

LexiBridge serves English learners and knowledge workers who read, collect vocabulary, and maintain durable vocabulary notes inside Obsidian. They need quick lookup while reading, predictable note generation, and a way to connect vocabulary work with existing study tools without giving up ownership of their Markdown.

## Product Purpose

LexiBridge turns Obsidian into a local-first vocabulary workspace. It combines offline English-Chinese lookup, structured vocabulary-note creation, safe links and previews, optional online enrichment, selected Eudic wordbook synchronization, and one-way Anki export.

Success means a user can move from encountering a word to understanding, recording, linking, and reviewing it while keeping Obsidian and the vault as the source of truth.

## Positioning

LexiBridge is not a generic dictionary panel or a cloud-first vocabulary service. Its distinctive mechanism is the bridge between an offline dictionary, user-owned Markdown notes, non-destructive reading assistance, guarded synchronization, and optional review-tool export. Networked services extend the local workflow only when the user explicitly enables or invokes them.

## Operating Context

- The product runs as an Obsidian Community Plugin on desktop and mobile.
- Users work primarily in Markdown notes, the LexiBridge dictionary side panel, plugin settings, preview modals, Reading view, and Live Preview.
- ECDICT data is downloaded and indexed locally in IndexedDB rather than stored in the vault.
- Vocabulary notes live in a user-configured vault folder and may contain protected headings whose handwritten content must survive regeneration.
- Optional connectors include Youdao for user-initiated enrichment, the official Eudic Open API for selected wordbooks, and AnkiConnect for one-way export to Anki Desktop.
- Destructive or divergent synchronization plans are reviewed before execution and remain subject to deletion limits.

## Capabilities and Constraints

- Offline ECDICT lookup is the default dictionary path.
- Youdao enrichment is optional, serialized, rate-limited, and never used for automatic batch processing.
- Virtual links assist reading without modifying Markdown; users can preview, open, or deliberately convert matching words to real short WikiLinks.
- Automatic linking previews proposed edits and avoids protected Markdown regions.
- Eudic synchronization is optional and scoped to selected wordbooks.
- Anki export is one-way: Obsidian owns content, while Anki owns scheduling and review history.
- Dictionary, note, and reading features support desktop and mobile. Anki export requires Anki Desktop and AnkiConnect.
- The plugin currently targets Obsidian 1.8.7 or later and remains in `0.x` development, so features and stored data structures may still evolve.
- The product contains no telemetry. Tokens and connector settings stored in plugin data must not be exposed or committed.

## Brand Commitments

- The product name is **LexiBridge**.
- Voice is clear, restrained, task-oriented, and honest about network access, destructive actions, and product maturity.
- The interface remains recognizably native to Obsidian rather than imposing a separate visual brand over the host application.
- Existing English and Chinese product documentation should remain factual and aligned.

## Evidence on Hand

- `README.md` and `README.zh-CN.md` document the current feature set, operating model, privacy boundaries, and setup flows.
- `manifest.json` and `package.json` record product identity, compatibility, and development status.
- `styles.css`, `src/view.ts`, `src/settings.ts`, and `src/ui/` contain the incumbent interface and interaction system.
- Automated tests under `scripts/`, the repository lint configuration, and the Community-readiness check provide implementation evidence.
- The integration vault and Obsidian CLI workflow provide a place for real runtime verification.
- There are no confirmed testimonials, customer logos, adoption metrics, performance benchmarks, or press claims; future work must not invent them.

## Product Principles

1. **Local first, network by choice.** Core lookup and vocabulary work remain useful without optional online services.
2. **User content stays authoritative.** Preserve handwritten Markdown and make generated or synchronized changes reviewable.
3. **Assist reading without taking over it.** Keep virtual links quiet, contextual, and non-destructive.
4. **Make risky operations explicit.** Preview changes, name consequences, enforce deletion limits, and prefer recoverable actions.
5. **Fit the Obsidian workflow.** Respect vault conventions, themes, mobile constraints, and familiar host interactions.

## Accessibility & Inclusion

Interfaces must remain usable with keyboard and pointer input, support Obsidian light and dark themes, preserve visible focus states, expose labels for icon-only controls, and avoid relying on color alone to communicate status. Touch layouts and controls must remain practical on mobile-sized Obsidian surfaces.
