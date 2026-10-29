# 🍎 SKILL: Apple Human Interface Guidelines (HIG) Web Architecture

This skill governs every component, layout, animation, and color token inside `frontend-web/`. The web application must look and feel like a native macOS Sequoia / iPadOS Pro creative studio application (akin to Final Cut Pro Web, Linear, and Apple Creator Studio).

## 1. Color System & Surface Hierarchy
- **Light Mode (Daylight Studio):**
  - Primary Canvas: `#F5F5F7` (Apple System Gray 6)
  - Elevated Surface / Cards: `#FFFFFF` with border `1px solid rgba(0, 0, 0, 0.06)`
  - Translucent Sidebar / Header: `rgba(255, 255, 255, 0.72)` + `backdrop-filter: blur(20px) saturate(180%)`
  - Primary Text: `#1D1D1F`
  - Secondary Text: `#86868B`
- **Dark Mode (Pro Video Suite - Default for Studio View):**
  - Primary Canvas: `#000000` (True Black) or `#0D0D0F`
  - Elevated Surface / Bento Panel: `#1C1C1E`
  - Glass Overlay / Inspector Panel: `rgba(28, 28, 30, 0.75)` + `backdrop-filter: blur(24px) saturate(190%)`
  - Hairline Border: `1px solid rgba(255, 255, 255, 0.08)`
  - Primary Text: `#F5F5F7`
  - Secondary Text: `#98989D`
- **Semantic Accents (Used Sparingly):**
  - Primary Action / Focus Ring: `#0071E3` (System Blue)
  - Success / Published: `#34C759`
  - Warning / Scheduled: `#FF9F0A`
  - Danger / Failed API: `#FF453A`

## 2. Typography & Scannability
- **Font Stack:** `font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", sans-serif`
- **Monospace (Timecodes, SRT Timestamps, API Logs):** `"SF Mono", "JetBrains Mono", monospace`
- **Rules:**
  - Tight tracking on headings: `tracking-tight` (`-0.022em`).
  - Tabular numerals (`tabular-nums`) MUST be applied to all video timecodes (`00:01:24:12`), character counters, analytics metrics, and countdown timers.

## 3. Spatial Architecture & Layout
- **Three-Pane Studio Layout:**
  1. **Left Navigation Rail (240px collapsible):** Workspace switcher, Content Groups/Series tree, Platform Connections, Settings.
  2. **Center Stage (Fluid):** Bento Grid dashboard, Kanban Pipeline, or Video Timeline/Preview canvas.
  3. **Right Inspector Drawer (340px):** Platform-specific metadata tabs (YouTube, Shorts, TikTok, IG Reels, LinkedIn, Facebook), Hashtag matrix, and AI Localization controls.
- **Border Radius:**
  - Outer Panels / Modals: `rounded-2xl` (`16px`)
  - Inner Cards / Video Thumbnails: `rounded-xl` (`12px`)
  - Buttons / Inputs / Pills: `rounded-lg` (`8px`)

## 4. Motion & Micro-Interactions
- **NO** linear easing (`ease-in-out`). Use spring physics via Framer Motion:
  - `transition={{ type: "spring", stiffness: 380, damping: 30 }}`
- **Command Palette (`⌘K`):** Global spotlight-style modal for jumping to any video group, triggering AI translation, or scheduling a post.