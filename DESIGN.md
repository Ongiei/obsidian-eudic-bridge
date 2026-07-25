---
name: LexiBridge
description: A native-feeling, local-first vocabulary workbench inside Obsidian.
colors:
  accent: "var(--interactive-accent)"
  accent-hover: "var(--interactive-accent-hover)"
  accent-text: "var(--text-on-accent)"
  surface-primary: "var(--background-primary)"
  surface-secondary: "var(--background-secondary)"
  surface-hover: "var(--background-modifier-hover)"
  field-surface: "var(--background-modifier-form-field)"
  border: "var(--background-modifier-border)"
  text-primary: "var(--text-normal)"
  text-muted: "var(--text-muted)"
  text-error: "var(--text-error)"
  text-warning: "var(--text-warning)"
  text-success: "var(--text-success)"
typography:
  title:
    fontSize: "1.2em"
    fontWeight: 600
    lineHeight: 1.1
  body:
    fontSize: "0.9em"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontSize: "0.8em"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  compact: "3px"
  control: "4px"
  panel: "6px"
  modal: "8px"
  pill: "12px"
spacing:
  hairline: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  control: "10px"
  panel: "12px"
  section: "16px"
  page: "20px"
  spacious: "24px"
components:
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    size: "32px"
  icon-button-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text-primary}"
  tab-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-text}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  search-input:
    backgroundColor: "{colors.field-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  popover:
    backgroundColor: "{colors.surface-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.panel}"
    padding: "12px"
  compact-chip:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: LexiBridge

## Overview

**Creative North Star: "Native Lexicon Workbench"**

LexiBridge is an **Operate** surface embedded in Obsidian. It should feel like a focused vocabulary instrument that has always belonged in the host application: clear, compact, theme-aware, and quiet until the user asks it to act. Product identity comes from careful information structure and safe interaction details rather than a separate decorative layer.

The system is deliberately restrained. Dictionary results remain easy to scan, settings follow Obsidian conventions, and transient previews use just enough depth to establish context. Dense workflows may reveal more detail, but they must retain clear hierarchy, explicit consequences, and recoverable exits.

**Key Characteristics:**

- Native Obsidian color, typography, icon, and control semantics.
- Compact spacing with readable grouping rather than ornamental whitespace.
- Accent color reserved for current state, focus, and primary action.
- Flat surfaces at rest; elevation only for overlays or meaningful interaction state.
- Explicit warning and destructive treatments for consequential operations.

## Colors

LexiBridge has no fixed light or dark palette. Obsidian semantic variables are the normative source so the interface follows the active theme and user customizations.

### Primary

- **Host Accent** (`var(--interactive-accent)`): active tabs, selected source options, progress, focus borders, and primary actions.
- **Host Accent Hover** (`var(--interactive-accent-hover)`): hover feedback where the host theme provides a stronger accent state.
- **On Accent** (`var(--text-on-accent)`): text and icons placed on an accent surface.

### Neutral

- **Primary Surface** (`var(--background-primary)`): popovers and principal content surfaces.
- **Secondary Surface** (`var(--background-secondary)`): chips, grouped controls, cards, and supporting panels.
- **Hover Surface** (`var(--background-modifier-hover)`): low-emphasis interactive feedback.
- **Field Surface** (`var(--background-modifier-form-field)`): text inputs and editable controls.
- **Boundary** (`var(--background-modifier-border)`): separators, field borders, and contained surfaces.
- **Primary Text** (`var(--text-normal)`): main labels and content.
- **Muted Text** (`var(--text-muted)`): helper copy, metadata, and inactive controls.

### Status

- **Error** (`var(--text-error)`): failures and destructive outcomes.
- **Warning** (`var(--text-warning)`): caution and plans requiring review.
- **Success** (`var(--text-success)`): completed or safe positive states.

### Named Rules

**The Host Owns the Palette Rule.** Do not introduce fixed brand colors for ordinary plugin UI. Use Obsidian semantic variables so themes remain authoritative.

**The One Accent Rule.** Accent communicates selection, focus, or the primary next action; it is not general decoration.

## Typography

**Display Font:** Inherit Obsidian's interface font.

**Body Font:** Inherit Obsidian's interface font.

**Label/Mono Font:** Use `var(--font-monospace)` only for code, paths, raw templates, or technical values.

**Character:** Typography is compact and functional. Weight and scale establish hierarchy while the host application supplies the actual typeface.

### Hierarchy

- **Title** (600, `1.2em`, 1.1): dictionary headwords and compact surface titles.
- **Body** (400, `0.9em`, 1.4): definitions, descriptions, preview content, and normal workflow text.
- **Label** (600, `0.8em`, 1.2): chips, metadata, parts of speech, and compact status labels.
- **Technical** (`var(--font-monospace)`): templates, frontmatter previews, paths, and machine-facing content.

### Named Rules

**The Content Leads Rule.** Avoid oversized display typography. The word, definition, decision, or planned change should dominate through structure, not spectacle.

## Layout

The base rhythm uses 4, 6, and 8 px gaps for controls and related content; 12 and 16 px separate groups; 20 and 24 px frame full panels or modals. The dictionary sidebar uses `16px 20px` inset spacing and stacks results vertically. Search and action rows use flex layouts with flexible inputs and fixed-size icon controls.

Settings use horizontally scrollable category tabs with a clear active state, followed by native Obsidian setting rows. Candidate lists and reconciliation details use bounded scrolling so actions remain reachable while large datasets stay manageable.

Desktop popovers anchor near their source and stay within a 12 px viewport margin. At 640 px and below, transient vocabulary previews become fixed bottom surfaces with safe-area spacing, an 8 px outer inset, and a height capped at `min(60vh, 420px)`.

## Elevation & Depth

LexiBridge is flat by default. Borders, tonal surfaces, and spacing define most hierarchy. Only transient overlays use `var(--shadow-l)`; interactive summary cards may use `var(--shadow-s)` as a hover response. Depth must communicate layering or state, never decoration.

### Shadow Vocabulary

- **Overlay** (`var(--shadow-l)`): dictionary and virtual-link popovers above note content.
- **Interactive Lift** (`var(--shadow-s)`): restrained hover feedback for summary cards.

### Named Rules

**The Flat-by-Default Rule.** A surface earns a shadow only when it is floating above content or responding to interaction.

## Shapes

Controls and list items use a compact 4 px radius. Contained panels and standard popovers use 6 px; larger mobile or modal surfaces use 8 px. Three-pixel radii are reserved for nested segmented controls, while 12 px creates pill-shaped pronunciation and metadata chips.

Borders use the host boundary token and remain one pixel unless a three-pixel status edge is needed to distinguish success, warning, or error. Icon buttons are square; compact chips are pill-like; large ornamental shapes are outside the incumbent language.

## Components

### Buttons

- **Shape:** Compact rounded rectangle, usually 4 px; icon-only controls are 28–32 px on desktop and at least 40 px in mobile popovers.
- **Primary:** Use the host accent with on-accent text, relying on Obsidian's native CTA and warning modifiers where available.
- **Hover / Focus:** Move from transparent or neutral to the host hover surface; preserve a visible focus treatment and labeled tooltip for icon-only actions.
- **Destructive:** Use Obsidian warning or danger modifiers and explicit consequence-focused copy.

### Chips

- **Style:** Secondary or transparent surface, muted text, one-pixel host border, and compact 2–8 px internal spacing.
- **State:** Selected source options use the host accent; vocabulary-form and exam chips remain neutral and support scanning rather than acting as decoration.

### Cards / Containers

- **Corner Style:** 6–8 px depending on scale.
- **Background:** Primary for overlays; secondary for grouped supporting content.
- **Shadow Strategy:** Flat at rest, with overlay or interactive lift only as defined above.
- **Border:** One-pixel host boundary, optionally paired with a semantic status edge.
- **Internal Padding:** 8–16 px for compact containers; 20–24 px for full modals.

### Inputs / Fields

- **Style:** Host form-field surface, one-pixel boundary, 4 px radius, and `6px 10px` padding.
- **Focus:** Remove redundant browser outline only when the host accent border or an equally visible focus indicator replaces it.
- **Error / Disabled:** Use native Obsidian states and semantic text tokens; do not rely on opacity or color alone.

### Navigation

Settings categories appear as compact horizontal tabs. Inactive tabs are transparent with muted text; hover uses the host hover surface; the active tab uses accent and on-accent text. Allow horizontal overflow rather than compressing labels until they become illegible.

### Dictionary Result

The dictionary result is the signature component. The headword and pronunciation controls form a compact header, definitions align parts of speech with readable text, and supporting forms, exams, web translations, and examples progressively disclose below. The result favors fast scanning and preserves the surrounding Obsidian theme.

### Virtual-Link Preview

Virtual links inherit surrounding text color so reading remains calm. After the established hover delay, a bounded popover presents the headword, note preview, and three labeled icon actions: open, convert to a real link, and close. The mobile form becomes a bottom surface rather than a narrowly anchored desktop popover.

## Do's and Don'ts

### Do:

- **Do** inherit Obsidian semantic variables for color, typography, depth, and native control states.
- **Do** use the 4/6/8 px compact rhythm inside controls and 12/16/20/24 px spacing between larger groups.
- **Do** keep primary actions, warnings, and destructive consequences visually and verbally distinct.
- **Do** make icon-only controls keyboard reachable and provide accessible labels or tooltips.
- **Do** preserve usable layouts in narrow sidebars, popout windows, and mobile-sized surfaces.

### Don't:

- **Don't** introduce fixed brand colors, gradients, glow effects, or decorative shadows into ordinary plugin UI.
- **Don't** use accent color for every link, label, or piece of metadata.
- **Don't** hide risky synchronization or deletion consequences behind neutral styling.
- **Don't** shrink touch controls, clip long content, or assume a desktop-only viewport.
- **Don't** replace Obsidian-native controls with custom lookalikes unless the workflow requires behavior the host component cannot provide.
