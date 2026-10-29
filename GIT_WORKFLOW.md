# 🌿 GIT WORKFLOW & REPOSITORY GOVERNANCE

## 1. Git Kimlik Zorunluluğu
Bu depodaki tüm commit işlemleri aşağıdaki kullanıcı kimliği ile yapılmalıdır:
- **User Name:** `Adem Demir`
- **User Email:** `ademdemirfe@gmail.com`

OpenCode ajanları herhangi bir commit atmadan önce `git config user.email` değerini doğrulamalıdır.

## 2. Conventional Commits Standardı
Her commit mesajı aşağıdaki formatta olmalıdır:
`<type>(<scope>): <subject>`

- **Types:** `feat`, `fix`, `refactor`, `style`, `docs`, `chore`, `perf`, `test`
- **Scopes:** `backend`, `web`, `mobile`, `ai-pipeline`, `scheduler`, `db`, `ui-apple`
- **Örnekler:**
  - `feat(db): add flyway migration for content_groups and video_localizations`
  - `feat(ui-apple): implement 3-pane omni-studio workspace with safe-zone overlay`
  - `feat(ai-pipeline): integrate structured output generator for 6 social platforms`
  - `feat(scheduler): add virtual-thread based youtube and tiktok publishing worker`

## 3. Aşamalı (Phased) Geliştirme ve Commit Stratejisi
OpenCode tüm projeyi tek bir devasa commit olarak ATMAMALIDIR. Aşağıdaki 5 fazda geliştirip her faz sonunda derleme testi yapıp commit atmalıdır:
1. **Phase 1 (Foundation & DB):** PostgreSQL Flyway şemaları, JPA Entity'ler, Repository'ler ve temel DTO'lar.
2. **Phase 2 (Core Backend & AI):** ContentGroup CRUD, AI Metadata/Translation servisleri, FFmpeg entegrasyonu, Zamanlayıcı (Scheduler) altyapısı.
3. **Phase 3 (Apple HIG Design System & Shell):** `frontend-web` içinde Apple renk token'ları, Glassmorphism Sidebar, Command Palette (`⌘K`) ve sayfa yönlendirmeleri.
4. **Phase 4 (Studio, Localization & Calendar Screens):** Omni-Studio 3 panelli ekranı, Altyazı/Çeviri matrisi, Sürükle-bırak Takvim ve Bento Dashboard.
5. **Phase 5 (Integration & Verification):** Frontend ve Backend uçlarının tam bağlanması, `verification.md` kontrollerinin güncellenmesi.