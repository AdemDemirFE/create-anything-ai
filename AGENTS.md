# 🤖 AGENTS.md — OpenCode & GLM Agentic Coding Directives

## 1. Project Identity & Core Stack
- **Project Name:** AetherFlow (Omnichannel Video Content & Distribution SaaS)
- **Base Stack:** `01-java25-springboot-react-flutter`
- **Backend:** Java 25 (Virtual Threads enabled), Spring Boot 3.4+, PostgreSQL 16, Redis (Job Queue & Cache), Qdrant (Semantic Hook/Tag Search), FFmpeg (Media Processing).
- **Frontend Web:** React 19, TypeScript, Vite, Tailwind CSS, Zustand (State), TanStack Query, Framer Motion (Spring physics), Lucide Icons (1.5px stroke).
- **Git Identity:** All commits MUST be executed under `ademdemirfe@gmail.com` (Adem Demir).

## 2. STRICT ANTI-AI-SLOP MANIFESTO (CRITICAL)
You are strictly forbidden from generating "AI Slop". Violation of these rules requires immediate refactoring:
1. **NO** generic purple/indigo/pink neon gradients (`from-purple-500 to-indigo-600` is BANNED).
2. **NO** generic SaaS marketing hero sections with floating 3D blobs or fake statistics.
3. **NO** placeholder code comments like `// TODO: implement logic here` or `// Add API call`. Write the complete, production-ready implementation.
4. **NO** unstyled or overly shadowed Material-UI-style cards. Follow `docs/skills/APPLE_DESIGN_SKILL.md` strictly.
5. **NO** mock `setTimeout` pretending to be an API call in the final step; wire every frontend action to its corresponding Spring Boot `@RestController` endpoint.

## 3. Mandatory Reading Order Before Coding
Before modifying any code in `backend/` or `frontend-web/`, the Agent MUST read:
1. `docs/skills/APPLE_DESIGN_SKILL.md` (For all UI/UX tasks)
2. `docs/DATABASE_API.md` (For entities, migrations, and DTOs)
3. `docs/SCREENS_AND_FLOWS.md` (For page layouts and user journeys)
4. `docs/AI_PIPELINE.md` (For subtitle, translation, and hashtag generation services)
5. `GIT_WORKFLOW.md` (Before running any `git` command)

## 4. Execution Protocol for OpenCode / GLM Models
- **Step-by-Step Atomic Execution:** Build Backend Entity -> Repository -> Service -> Controller -> Verification Test -> Frontend API Client -> Zustand Store -> UI Component.
- **Java 25 Standards:** Use `record` for all DTOs, Pattern Matching for `switch`, and Virtual Threads (`spring.threads.virtual.enabled=true`) for all I/O bound social media API uploads and AI translation calls.
- **Verification:** After every feature module, run `mvn clean compile` in `backend/` and `npm run build` in `frontend-web/` to ensure zero type or compilation errors.