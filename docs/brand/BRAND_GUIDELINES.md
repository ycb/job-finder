# Brand Guidelines

Last updated: 2026-03-06

## Purpose

Job Finder helps serious job seekers move from noisy job-board browsing to clear, high-signal decisions and consistent action.

## Audience

Primary audience:

- Experienced product managers (senior, staff, principal) running focused job searches.

Secondary audience:

- Adjacent knowledge workers who want structured, criteria-driven search and review workflows.

Core audience needs:

1. Reduce search noise and duplicate listings.
2. Preserve confidence in ranking/filtering decisions.
3. Move quickly from criteria to vetted opportunities.

## Positioning

Category:

- Decision support for job discovery and prioritization.

Positioning statement:

- For job seekers overwhelmed by fragmented job boards, Job Finder is the local-first workflow that converts broad search into one reliable, ranked queue with transparent attribution.

Brand promise:

- "Clarity, speed, and trust in every job decision."

## Purpose -> Audience -> Design System Mapping

Purpose:

- Clarity under information overload.
Design expression:

- Strong information hierarchy, restrained color usage, and concise status language.

Purpose:

- Confidence in automated recommendations.
Design expression:

- Transparent source attribution, visible scoring rationale, and stable interaction patterns.

Purpose:

- Fast daily execution.
Design expression:

- Prominent primary CTA, reduced control duplication, and in-context feedback (not verbose logs).

## Brand Personality

Attributes:

- Clear
- Practical
- Trustworthy
- Focused
- Calm (never flashy for its own sake)

Avoid:

- Overly playful language
- Hype-driven visuals
- Dense jargon or ambiguous copy

## Verbal Identity

Tone:

- Direct, concise, and operational.

Copy rules:

1. Use action-oriented labels (`Find Jobs`, `Retry`, `Save`).
2. Prefer short status lines near affected controls.
3. Explain failures with next action.
4. Replace internal terms with user language where possible.

## Visual Identity

### Color Roles

Use semantic roles instead of one-off colors:

- `bg`: app background
- `surface`: cards and elevated sections
- `text`: primary content
- `muted`: secondary metadata
- `border`: separators and control boundaries
- `accent`: primary actions and selected states
- `success`: positive outcomes
- `danger`: errors and destructive states

### Typography

Typography should communicate structure quickly:

- Display/title: confident serif or brand headline style.
- Body/UI: highly readable text with clear contrast and spacing.
- Metadata: smaller but still readable; never below legibility threshold.

### Shape and Spacing

- Use consistent radius, spacing scale, and shadows via tokens.
- Keep vertical rhythm predictable in forms, filter rows, and detail panels.

### Iconography and Imagery

- Icons must reinforce meaning, not decorate.
- Use restrained visual accents; avoid decorative noise.

## Interaction and Motion

Motion principles:

1. Communicate state change, never distract.
2. Keep transitions fast and subtle.
3. Respect reduced-motion settings.

Required feedback:

- Primary actions show immediate loading state.
- Errors and success states appear near the triggering control.
- Empty states provide the next best action.

## UX Rules for Core Surfaces

Search criteria:

- One dominant CTA.
- Inputs map directly to user intent (title, keyword, location, salary, recency).

Results and filters:

- Filters represent meaningful user choices (for example source groups, not internal legacy artifacts).
- Counts should match visible data model and avoid contradictory signals.

Review detail:

- Decision actions are clear and always available.
- Attribution and rationale are visible without extra navigation.

## Accessibility Baseline

Required:

1. Keyboard navigation for all interactive controls.
2. Visible focus states.
3. Sufficient contrast for text and controls.
4. Clear labels for form fields and buttons.

## Design Review Checklist

Before shipping UI changes:

1. Purpose-audience alignment is explicit.
2. Primary user flow is clear to a first-time user.
3. Visual system uses reusable roles/tokens.
4. Loading/error/empty states are implemented.
5. Desktop and mobile layouts are validated.

## Governance

When design direction changes:

1. Update this file first.
2. Align component and token changes with this guidance.
3. Record important rationale in `/Users/admin/job-finder/docs/learnings.md`.
