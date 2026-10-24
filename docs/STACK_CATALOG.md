# Stack Catalog — 40 Proposed Combinations

This catalog preserves the 40 combinations proposed for Create Anything AI. Version strings below are **requested targets to validate**, not blanket claims of current support or compatibility. Before a stack is marked `verified`, confirm versions from official sources and run its acceptance suite.

Maturity default for new entries: `proposed`.

| ID | Stack directory | Category | Maturity | Backend / core | Web | Mobile / desktop | Data / infrastructure |
|---:|---|---|---|---|---|---|---|
| 01 | `01-java25-springboot-react-flutter` | enterprise-cross-platform | `proposed` | Java 25 / Spring Boot 3.4 | React 19 / Vite | Flutter 3.27 | PostgreSQL 17 / Redis |
| 02 | `02-java25-springboot-angular-ionic` | enterprise-cross-platform | `proposed` | Java 25 / Spring Boot 3.4 | Angular 19 | Ionic 8 | PostgreSQL 17 / Docker |
| 03 | `03-dotnet9-blazor-react-maui` | enterprise-cross-platform | `proposed` | .NET 9 Web API | React 19 / Blazor WASM | .NET MAUI | SQL Server 2022 / Redis |
| 04 | `04-go-fiber-htmx-flutter` | enterprise-cross-platform | `proposed` | Go 1.24 / Fiber v3 | HTMX 2 / Alpine.js | Flutter | PostgreSQL 17 / GORM |
| 05 | `05-nestjs-typeorm-nextjs-reactnative` | enterprise-cross-platform | `proposed` | NestJS 11 / TypeORM | Next.js 15 App Router | React Native / Expo | PostgreSQL 17 / Redis |
| 06 | `06-kotlin-ktor-compose-multiplatform` | enterprise-cross-platform | `proposed` | Kotlin 2.1 / Ktor 3 | Compose Web (validate status) | Compose Multiplatform | PostgreSQL 17 / Exposed |
| 07 | `07-rust-actix-leptos-tauri` | enterprise-cross-platform | `proposed` | Rust 1.85 / Actix Web | Leptos 0.7 WASM | Tauri v2 | PostgreSQL 17 / Diesel |
| 08 | `08-supabase-react-vite` | baas | `proposed` | Supabase Edge Functions | React 19 / Vite / Tailwind 4 | PWA | PostgreSQL / RLS |
| 09 | `09-supabase-nextjs-tailwind` | baas | `proposed` | Supabase | Next.js 15 | Responsive web | PostgreSQL / Realtime |
| 10 | `10-supabase-flutter-dart` | baas | `proposed` | Supabase | Flutter Web admin | Flutter iOS/Android | PostgreSQL / Supabase Auth |
| 11 | `11-supabase-react-native-expo` | baas | `proposed` | Supabase Edge Functions | React admin | React Native / Expo | PostgreSQL / Storage |
| 12 | `12-firebase-angular-ionic` | baas | `proposed` | Firebase Cloud Functions | Angular 19 | Ionic 8 | Firestore / Firebase Auth |
| 13 | `13-appwrite-vue3-quasar` | baas | `proposed` | Appwrite | Vue 3 / Quasar | Quasar mobile/desktop packaging | Appwrite storage / database service |
| 14 | `14-pocketbase-sveltekits-tailwind` | baas | `proposed` | PocketBase | SvelteKit 2 / Tailwind | Svelte PWA | SQLite / realtime |
| 15 | `15-laravel12-vue3-inertia-flutter` | classic-web | `proposed` | PHP 8.4 / Laravel 12 | Vue 3 / Inertia | Flutter | PostgreSQL 17 / Redis |
| 16 | `16-laravel12-livewire-alpine-tailwind` | classic-web | `proposed` | PHP 8.4 / Laravel 12 | Livewire 3 / Alpine / Tailwind | PWA | PostgreSQL 17 / MySQL 8.4 |
| 17 | `17-laravel12-react-inertia-reactnative` | classic-web | `proposed` | PHP 8.4 / Laravel 12 | React 19 / Inertia | React Native / Expo | PostgreSQL 17 / Redis |
| 18 | `18-mern-typescript-express-react-native` | classic-web | `proposed` | Node.js 22 / Express TS | React 19 / Vite TS | React Native / Expo TS | MongoDB 8 / Mongoose |
| 19 | `19-pevn-express-vue3-capacitor` | classic-web | `proposed` | Node.js 22 / Express TS | Vue 3 / Vite TS | Capacitor 6 (validate maintenance status) | PostgreSQL 17 / Prisma |
| 20 | `20-fastapi-react-vite-pwa` | classic-web | `proposed` | Python 3.12 / FastAPI | React 19 / Vite | PWA | PostgreSQL 17 / SQLAlchemy 2 |
| 21 | `21-django5-htmx-alpine-tailwind` | classic-web | `proposed` | Python 3.12 / Django 5.1 | HTMX 2 / Alpine | Responsive web / PWA | PostgreSQL 17 / Redis |
| 22 | `22-rails8-hotwire-tailwind-kamal` | classic-web | `proposed` | Ruby 3.4 / Rails 8 | Hotwire / Tailwind | Turbo Native (validate requirements) | PostgreSQL / Kamal |
| 23 | `23-fastapi-langchain-qdrant-nextjs` | ai-native | `proposed` | FastAPI / LangChain / LlamaIndex | Next.js 15 / Tailwind 4 | Responsive web | Qdrant / PostgreSQL |
| 24 | `24-springboot-springai-pgvector-react` | ai-native | `proposed` | Spring Boot 3.4 / Spring AI | React 19 / Vite | Web | PostgreSQL 17 / pgvector |
| 25 | `25-nextjs-verceled-ai-sdk-pinecone` | ai-native | `proposed` | Next.js Route Handlers | Next.js 15 | Responsive web / PWA | Pinecone / PostgreSQL |
| 26 | `26-litellm-ollama-python-chainlit` | ai-native | `proposed` | Python 3.12 / LiteLLM Proxy | Chainlit | Web console | Ollama / ChromaDB |
| 27 | `27-mastra-typescript-agents-nextjs` | ai-native | `proposed` | Mastra / TypeScript | Next.js 15 | Responsive web | LibSQL / PostgreSQL / vector |
| 28 | `28-flutter-local-rag-onnx-objectbox` | ai-native | `proposed` | Flutter / ONNX Runtime (validate platform support) | Flutter | Flutter iOS/Android | ObjectBox local vector store |
| 29 | `29-flutter-go-grpc-protobuf` | mobile-first | `proposed` | Go / gRPC | Flutter web admin | Flutter mobile / gRPC | PostgreSQL / Redis |
| 30 | `30-react-native-expo-supabase-tamagui` | mobile-first | `proposed` | Supabase | React admin | React Native / Expo / Tamagui | PostgreSQL / Realtime |
| 31 | `31-tauri2-rust-react-vite-desktop` | desktop | `proposed` | Rust / Tauri v2 | React 19 / Vite | Windows/macOS/Linux desktop | SQLite local |
| 32 | `32-electron-typescript-react-sqlite` | desktop | `proposed` | Node.js 22 / Electron (validate version) | React 19 / TypeScript | Windows/macOS/Linux desktop | SQLite / ORM |
| 33 | `33-swiftui-vapor-postgresql` | native | `proposed` | Swift 6 / Vapor 4 | SwiftUI (web support must be validated; do not assume) | iOS/macOS/iPadOS | PostgreSQL / Fluent |
| 34 | `34-jetpack-compose-ktor-postgres` | native | `proposed` | Kotlin / Ktor | Compose web admin (validate status) | Android / Compose | PostgreSQL / Exposed |
| 35 | `35-dotnet9-signalr-react-redis` | realtime | `proposed` | .NET 9 / SignalR | React 19 / Vite | PWA | SQL Server / Redis Streams |
| 36 | `36-go-gorilla-websockets-vue3` | realtime | `proposed` | Go / Gorilla WebSocket | Vue 3 / Vite TS | Web / PWA | PostgreSQL / Redis Pub/Sub |
| 37 | `37-elixir-phoenix-liveview-postgres` | realtime | `proposed` | Elixir 1.18 / OTP 27 | Phoenix LiveView 1.0 | Web / PWA | PostgreSQL / Ecto |
| 38 | `38-node-socketio-express-react-kafka` | realtime | `proposed` | Node.js 22 / Express / Socket.IO | React 19 / Vite | Responsive web | Kafka / PostgreSQL |
| 39 | `39-rust-tokio-axum-websockets-yew` | realtime | `proposed` | Rust / Axum / Tokio | Yew 0.21 WASM | Web client | PostgreSQL / SQLx |
| 40 | `40-python-fastapi-websockets-threejs` | realtime-3d | `proposed` | Python 3.12 / FastAPI | Three.js / React Three Fiber | Web / mobile 3D | PostgreSQL / Redis |

## Category summary

Counts and number ranges are generated from `stacks/catalog.json` (source of truth).

| Category | Stacks | Numbers |
|---|---:|---|
| `enterprise-cross-platform` | 7 | 01–07 |
| `baas` | 7 | 08–14 |
| `classic-web` | 8 | 15–22 |
| `ai-native` | 6 | 23–28 |
| `mobile-first` | 2 | 29–30 |
| `desktop` | 2 | 31–32 |
| `native` | 2 | 33–34 |
| `realtime` | 5 | 35–39 |
| `realtime-3d` | 1 | 40 |

## Catalog policy

- The stack directory name is its immutable ID unless a migration is approved.
- Stack IDs are unique and stable.
- `stacks/catalog.json` is the source of truth; this table should eventually be generated from it. The catalog is validated against `schemas/catalog.schema.json`; the structural rules that JSON Schema cannot express (exactly 40 stacks, unique IDs, contiguous 1–40 numbering, ID/number agreement) are enforced by the catalog validator.
- Every stack `maturity` must be a member of the catalog's `maturityPolicy` (`proposed`, `spec-ready`, `scaffolded`, `verified`, `production-reference`, `blocked`) and every `category` must be a member of `categoryPolicy`. Both vocabularies are mirrored in the JSON Schemas.
- Version validation must include framework/runtime compatibility, security support window, and platform limitations.
- If a version is obsolete or incompatible, propose a documented replacement rather than silently changing it.
- “Production-ready” requires the evidence listed in `docs/QUALITY_GATES.md`.
- Do not implement all 40 stacks in one giant agent task. Start with the generator and one reference stack, then validate the reusable pattern.
