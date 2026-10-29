# 🖥️ SCREENS & USER FLOWS (Apple Studio UI)

OpenCode MUST implement the following 6 primary screens inside `frontend-web/src/pages/` with zero placeholder UI.

## Screen 1: Command Center (Bento Dashboard) — `/dashboard`
- **Top Bar:** Breadcrumb (`Workspace / Command Center`), Global Search Trigger (`⌘K`), Quick Action `+ New Content Group` (Primary System Blue `#0071E3`).
- **Bento Grid Layout:**
  1. **Active Production Pipeline (Col-span-8):** Yatay kaydırılabilir mini Kanban özeti (`Scripting`, `Editing`, `Ready to Schedule`).
  2. **Today's Broadcast Queue (Col-span-4):** Bugün yayınlanacak videoların geri sayım sayaçları (`tabular-nums`), platform ikonları ve anlık durum pill'leri (`Queued`, `Uploading 64%`, `Published`).
  3. **Connected Channels Health (Col-span-6):** YouTube, TikTok, Instagram, Facebook, LinkedIn OAuth token durumları (Yeşil nokta: Aktif, Turuncu: Yenilenmeli).
  4. **AI Localization Quota & Recent Jobs (Col-span-6):** Son tamamlanan altyazı ve çeviri işlemleri.

## Screen 2: Content Groups Explorer (Finder-Style View) — `/groups`
- **Görünüm Seçenekleri:** Segmented Control ile `Grid View`, `Table View` (macOS Finder List görünümü) ve `Kanban Board` arasında anlık geçiş.
- **Grup Kartı Detayı:**
  - Kapak görseli (16:9 ve yanında küçük 9:16 kesit rozeti).
  - Grup başlığı ve renk etiketi.
  - **Platform Matrix Badges:** Kartın altında `YT` `SHORTS` `TT` `IG` `FB` `IN` ikonları. Hazır olanlar parlak, taslak olanlar yarı saydam, yayınlananlar yeşil onaylı görünür.
  - **Dil Bayrakları/Kodları:** `TR` `EN` `DE` rozetleri.

## Screen 3: The Omni-Studio Workspace (En Kritik Ekran) — `/groups/:id/studio`
Bu ekran üç sütunlu profesyonel bir stüdyodur:
- **Sol Panel (Asset & Variant Tree - 260px):**
  - Grubun içindeki videolar: `Master_16_9.mp4`, `Hook_Cut_01_9_16.mp4`, `Teaser_LinkedIn.mp4`.
  - Altında "Hashtag Presets" ve "AI Prompt Templates" çekmecesi.
- **Orta Panel (Interactive Video Player & Timeline - Fluid):**
  - Seçili videonun HTML5 özel oynatıcısı (9:16 seçildiyse dikey telefon çerçevesi simülasyonu, 16:9 ise sinematik çerçeve).
  - **Safe-Zone Overlay Toggle:** TikTok/Reels/Shorts arayüz butonlarının (Beğen, Yorum, Açıklama metni) videonun neresini kapattığını gösteren yarı saydam rehber katmanı (Altyazıların butonların altında kalmasını önler).
  - Oynatıcının hemen altında senkronize akan **Canlı Altyazı Şeridi**.
- **Sağ Panel (Multi-Platform Inspector - 420px):**
  - **En Üstte Platform Sekmeleri (Segmented Tabs):** `[YouTube] [Shorts] [TikTok] [IG Reels] [Facebook] [LinkedIn]`.
  - Sekme değiştikçe form alanları o platformun kurallarına göre dinamik değişir:
    - *Master Sync Toggle:* "Başlık ve açıklamayı tüm kısa video platformlarına senkronize et, sadece hashtag'leri özelleştir" anahtarı.
    - *Başlık Alanı:* Canlı karakter sayacı ve "✨ AI Hook Öner" butonu.
    - *Açıklama & Chapters Alanı:* Zengin metin/markdown editörü, YouTube için otomatik `00:00 Giriş` zaman damgası çıkarıcı.
    - *Hashtag Pill Builder:* Etiketleri chip olarak ekleme, rekabet/hacim skoru gösterimi, tek tıkla "İlk Yoruma Taşı" (Instagram/LinkedIn için) seçeneği.
    - *Zamanlama Seçici:* Tarih/Saat + "En İyi Etkileşim Saatini Seç" önerisi.

## Screen 4: AI Subtitle & Polyglot Localization Lab — `/groups/:id/localization`
- **Sol Taraf (Master Transcript Editor):**
  - Zaman damgalı (`00:01.200 -> 00:04.500`) satır satır düzenlenebilir transkript.
  - Satıra tıklandığında video tam o saniyeye sarar.
  - Kelime bazlı vurgulu altyazı stili seçici (Apple Minimal, Hormozi Clean, Cinema Yellow).
- **Sağ Taraf (Multi-Language Translation Matrix):**
  - Üstte `+ Dil Ekle` (EN, DE, ES, FR, AR, RU...) seçici.
  - Yan yana karşılaştırmalı görünüm: Sol sütunda Türkçe orijinal başlık/açıklama/altyazı satırı, sağ sütunda seçilen hedef dildeki AI çevirisi.
  - "Tüm Dillere Uygula ve YouTube/Platform Lokalizasyonlarına Bağla" aksiyon butonu.

## Screen 5: Omnichannel Calendar & Queue — `/calendar`
- Apple Calendar (macOS) tasarımında haftalık ve aylık zaman çizelgesi.
- Sürükle-bırak (Drag & Drop) ile zamanlanmış bir videoyu başka bir güne veya saate taşıma (Backend'de otomatik zaman güncellemesi tetikler).
- Platform bazlı filtreleme (Örn: Sadece Shorts ve TikTok yayınlarını göster).

## Screen 6: Channels, API Keys & AI Engine Settings — `/settings`
- Sosyal medya hesaplarını OAuth2 ile bağlama/yenileme kartları.
- AI Model Ayarları: OpenAI / GLM / Yerel Ollama / Whisper endpoint ve API anahtarı yapılandırması.
- Varsayılan Marka Kuralları (Her YouTube açıklamasının altına sabit eklenecek sosyal medya linkleri, telif metinleri vb.).