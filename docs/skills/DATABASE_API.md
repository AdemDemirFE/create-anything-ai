# 🗄️ DATABASE & API SPECIFICATION

## 1. PostgreSQL Core Schema (Flyway Migrations: `V1__init_aetherflow_schema.sql`)

### `workspaces` (Multi-Tenancy SaaS)
- `id` (UUID, PK)
- `name` (VARCHAR)
- `slug` (VARCHAR, UNIQUE)
- `owner_id` (UUID, FK -> users.id)
- `plan_tier` (ENUM: `FREE`, `PRO`, `AGENCY`)
- `created_at` (TIMESTAMPTZ)

### `social_accounts` (OAuth Connections)
- `id` (UUID, PK)
- `workspace_id` (UUID, FK)
- `platform` (ENUM: `YOUTUBE`, `TIKTOK`, `INSTAGRAM`, `FACEBOOK`, `LINKEDIN`)
- `account_name` (VARCHAR)
- `external_account_id` (VARCHAR)
- `access_token_encrypted` (TEXT)
- `refresh_token_encrypted` (TEXT)
- `token_expires_at` (TIMESTAMPTZ)
- `status` (ENUM: `ACTIVE`, `EXPIRED`, `REVOKED`)

### `content_groups` (Campaigns / Video Bundles)
- `id` (UUID, PK)
- `workspace_id` (UUID, FK)
- `title` (VARCHAR) — Örn: "Bölüm 14: Yapay Zeka Mimarisi"
- `campaign_tag` (VARCHAR)
- `status` (ENUM: `IDEA`, `SCRIPTING`, `PRODUCTION`, `READY`, `PARTIALLY_PUBLISHED`, `COMPLETED`)
- `color_label` (VARCHAR) — Apple Finder etiket renkleri (`blue`, `green`, `orange`, `red`)
- `created_at`, `updated_at` (TIMESTAMPTZ)

### `video_assets` (Media Files inside a Group)
- `id` (UUID, PK)
- `content_group_id` (UUID, FK)
- `aspect_ratio` (ENUM: `RATIO_16_9`, `RATIO_9_16`, `RATIO_1_1`, `RATIO_4_5`)
- `storage_key` (VARCHAR) — S3 / MinIO / Local path
- `thumbnail_key` (VARCHAR)
- `duration_ms` (BIGINT)
- `resolution` (VARCHAR)
- `master_language` (VARCHAR, ISO 639-1, e.g., `tr`, `en`)

### `platform_posts` (Platform-Specific Adaptations)
- `id` (UUID, PK)
- `content_group_id` (UUID, FK)
- `video_asset_id` (UUID, FK)
- `social_account_id` (UUID, FK)
- `platform` (ENUM: `YOUTUBE_LONG`, `YOUTUBE_SHORTS`, `TIKTOK`, `INSTAGRAM_REELS`, `FACEBOOK_REELS`, `LINKEDIN`)
- `title` (VARCHAR)
- `description` (TEXT)
- `first_comment` (TEXT) — IG/LinkedIn/YT ilk yorum otomasyonu için
- `hashtags` (JSONB) — `["#yazılım", "#yapayzeka"]`
- `platform_settings` (JSONB) — `{ "privacy": "public", "madeForKids": false, "allowDuet": true, "categoryId": "28" }`
- `scheduled_at` (TIMESTAMPTZ)
- `published_at` (TIMESTAMPTZ)
- `external_post_url` (VARCHAR)
- `publish_status` (ENUM: `DRAFT`, `SCHEDULED`, `QUEUED`, `PUBLISHING`, `PUBLISHED`, `FAILED`)
- `error_log` (TEXT)

### `video_localizations` (Multi-Language & Subtitles)
- `id` (UUID, PK)
- `video_asset_id` (UUID, FK)
- `language_code` (VARCHAR, e.g., `en-US`, `de-DE`, `es-ES`)
- `translated_title` (VARCHAR)
- `translated_description` (TEXT)
- `translated_hashtags` (JSONB)
- `subtitle_srt_content` (TEXT)
- `subtitle_vtt_content` (TEXT)
- `burned_video_storage_key` (VARCHAR, Nullable)
- `ai_verification_score` (NUMERIC)

### `hashtag_presets` (Saved Hashtag Bundles)
- `id` (UUID, PK)
- `workspace_id` (UUID, FK)
- `name` (VARCHAR)
- `platform` (VARCHAR)
- `tags` (JSONB)

---

## 2. Core REST API Endpoints (`backend/src/main/java/.../controller`)

### Content Groups & Assets
- `GET /api/v1/groups` — Filtrelenebilir grup listesi (durum, etiket, tarih).
- `POST /api/v1/groups` — Yeni içerik grubu oluştur.
- `GET /api/v1/groups/{id}` — Grup detayı, bağlı medya dosyaları, tüm platform postları ve lokalizasyonlar.
- `POST /api/v1/groups/{id}/assets/upload-url` — Presigned Multipart Upload URL üretir (Büyük video dosyaları için).

### Multi-Platform Composer & Scheduling
- `POST /api/v1/groups/{id}/posts/batch` — Tek seferde YT, TikTok, IG, LinkedIn post taslaklarını oluşturur/günceller.
- `POST /api/v1/posts/{postId}/schedule` — Belirtilen `scheduled_at` zamanı için Redis/Spring Quartz kuyruğuna alır.
- `POST /api/v1/posts/{postId}/publish-now` — Java 25 Virtual Thread üzerinde anında ilgili platform API'sine yüklemeyi başlatır.

### AI & Localization Engine
- `POST /api/v1/ai/transcribe/{assetId}` — Videodan sesi ayırır ve zaman damgalı SRT üretir.
- `POST /api/v1/ai/translate/{assetId}` — Payload: `{ "targetLanguages": ["en", "de", "es"], "adaptTone": true }`. Başlık, açıklama, hashtag ve SRT'yi çevirir.
- `POST /api/v1/ai/generate-metadata` — Transkriptten her platformun algoritmasına uygun viral başlık, açıklama, YouTube zaman damgaları (Chapters) ve hashtag üretir.