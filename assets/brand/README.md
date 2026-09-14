# NeonShift brand visuals — v1

Created 2026-09-14 using the built-in image_gen tool.

## Deliverables

- `neonshift-identity-v1.png`: identity concept sheet (primary mark, app icon and mono exploration).
- `neonshift-splash-v1.png`: native launch composition reference.
- `neonshift-loading-v1.png`: bootstrap loading composition reference; illustrated cached/offline state.

These PNGs are visual design references, not Android adaptive-icon resources or interactive screens. The primary sheet explores variants; use its upper-right flat icon as the silhouette reference for final vector artwork. Wordmarks and status text must be rendered as actual accessible UI text during implementation. Native splash uses the system safe area, no forced delay. Bootstrap status comes from actual tasks, no fabricated percentage; show offline action only when cache exists. Follow docs/style.md section 8 for 300 ms / 3 s / 10 s behavior. Animation: 1.6 s gentle 96–104% pulse, disabled for reduced motion. Avoid reproducing the concept sheet's strong text glow in production.

## Design rationale

Geometric N with forward arrow negative space expresses movement, progress and Shift. Its abstract shape works for fitness, community events and NFC touchpoints without limiting the brand to running shoes. Midnight navy #050711; mint #30EBC8, cyan #24C8FF and violet #9B6CFF; white #F4F8FF typography. No official Solana or SKR marks.

## Exact generation prompts

### Identity

Use case: logo-brand. Create a polished original brand identity presentation image for NEONSHIFT, an Android cyber fitness and community sporting event app. Landscape presentation, extremely restrained premium graphic design. Midnight navy #050711 background. Primary symbol a bold geometric letter N constructed from two forward leaning ribbon strokes and a sharp rising diagonal forming a forward shift arrow in negative space. Distinctive simple silhouette, legible at 24px, no sneaker illustration, no generic lightning bolt, no Solana logo. Flat crisp vector-like geometry, mint #30EBC8 through cyan #24C8FF to violet #9B6CFF gradient, no excessive glow or 3D. Large main symbol with precise widely tracked uppercase wordmark NEONSHIFT at left; right side smaller rounded-square app icon and monochrome white mark demonstrating scalability. Spacious professional brand sheet. Only text NEONSHIFT and small labels PRIMARY MARK, APP ICON, MONO. Deliver a beautiful finished visual.

### Splash

Use reference image ONLY as brand identity reference. Create a single finished portrait 9:19.5 Android native splash screen for NEONSHIFT. Use precisely the reference's small APP ICON N symbol (the flat clean variant at upper right), keeping silhouette and mint-cyan-violet colors. Full bleed midnight navy #050711 absolutely clean solid background. Small centered mark at 45% of screen height, 20% of screen width; beneath it NEONSHIFT uppercase widely tracked white wordmark, crisp with NO glow on text. Immense calm negative space. No phone frame, mockup perspective, status bar, spinner, percentage, footer, buttons, labels or extra graphics. Premium quiet confident athletic technology. Flat production UI visual, not poster. Preserve original N identity, minimize bloom.

### Loading

Use reference image ONLY as brand identity reference. Create a single finished portrait 9:19.5 Android bootstrap LOADING screen for NEONSHIFT cyber fitness and community sporting event app. Full bleed #050711 midnight navy, no phone frame. Match precisely the reference's flat N APP ICON symbol at upper right, mint #30EBC8 through cyan #24C8FF to violet #9B6CFF. Generous safe margins, polished typography, exceptionally restrained neon. Top small NEONSHIFT left and tiny outlined amber DEVNET badge right. Main mark centered around upper middle, modest soft mint halo and very thin incomplete elliptical orbit suggesting gentle movement; no elaborate HUD. Below mark exact heading 'Syncing your shift', then 'Getting your space ready'. Lower middle a subtle navy rounded status panel with three spacious rows: mint check and 'Profile ready'; cyan small arc and 'Checking health access'; muted hollow circle and 'Network pending'. These are illustrative states, no fake percentages. Near bottom a low emphasis outline button 'Use offline data'. Bottom quiet text 'Test environment'. Strong hierarchy, crisp readable white #F4F8FF and secondary #AAB7CC, no glow on any text. Calm technical sport aesthetic consistent with reference.

