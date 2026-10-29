# 📋 Product Requirements Document (PRD) — AetherFlow

## 1. Ürün Vizyonu
AetherFlow, içerik üreticilerinin, ajansların ve markaların tek bir ham videoyu (Long-form veya Short-form) yükleyip; **YouTube (Long & Shorts), TikTok, Instagram (Reels/Post), Facebook (Reels/Video) ve LinkedIn** platformlarına özel format, başlık, açıklama, hashtag, çok dilli altyazı (SRT/VTT + gömülü) ve zamanlama ile tek merkezden yönetmesini sağlayan kurumsal bir SaaS platformudur.

## 2. Temel Modüller (Core Pillars)

### A. Kampanya, Seri ve Video Gruplama (Content Grouping)
- Kullanıcılar videoları rastgele yüklemez; **Workspace -> Series/Campaign -> Content Group (Master VideoNode)** hiyerarşisinde gruplar.
- Bir "Content Group" içinde şunlar bulunabilir:
  - 1 adet Ana YouTube Videosu (16:9)
  - 3 adet bu videodan türetilmiş Shorts / TikTok / Reels kesiti (9:16)
  - 1 adet LinkedIn/Facebook kare veya yatay duyuru videosu (1:1 veya 16:9)
- Tüm bu varyasyonlar tek bir ağaç yapısında birbirine bağlıdır.

### B. Platform-Spesifik İçerik ve Hashtag Motoru (Multi-Platform Composer)
- Her platformun karakter sınırı, algoritma dinamikleri ve medya kuralları sistemde tanımlıdır:
  - **YouTube Long:** Başlık (max 100), Açıklama (max 5000, zaman damgaları/chapters), Etiketler (virgülle ayrılmış 500 krk), Kategori, Playlist seçimi, Thumbnail yükleme.
  - **YouTube Shorts:** Başlık + `#Shorts` zorunluluğu kontrolü, İlgili Uzun Videoya Bağlantı (Related Video link).
  - **TikTok:** Açıklama (max 4000), Trend Hashtag grupları, Düet/Stitch izin anahtarları, Kapak karesi seçimi.
  - **Instagram Reels & Facebook:** Açıklama (max 2200), İlk Yorum (First Comment) içine otomatik hashtag gömme özelliği, Konum etiketi, Akışta (Feed) paylaşım anahtarı.
  - **LinkedIn:** Profesyonel tonlu metin (max 3000), sektörel etiketler, makale/bülten linki sabitleme.
- **Akıllı Hashtag Kasası (Hashtag Vault):** Kullanıcılar nişlerine göre hashtag grupları kaydedebilir veya AI ile videonun transkriptinden platforma özel yüksek hacimli/düşük rekabetli hashtag setleri üretebilir.

### C. AI Lokalizasyon, Otomatik Çeviri ve Altyazı Stüdyosu
- Videodan otomatik ses ayrıştırma (FFmpeg) ve **Whisper / GLM** tabanlı zaman damgalı transkripsiyon.
- **Çoklu Dil Çevirisi:** Tek tıkla videonun başlığını, açıklamasını, hashtag'lerini ve altyazı dosyasını (`.srt` / `.vtt`) hedef dillere (TR, EN, DE, ES, AR, RU, JP vb.) çevirme.
- **YouTube Multi-Language Metadata API:** Tek bir YouTube videosuna birden fazla dilde başlık, açıklama ve altyazı parçasını API üzerinden otomatik yükleme.
- **Hardcoded Captions (Gömülü Altyazı):** Shorts/TikTok/Reels için Apple tarzı temiz tipografili altyazıyı FFmpeg üzerinden videoya gömme (Burn-in).

### D. Zamanlı Paylaşım ve OAuth Dağıtım Motoru (Omnichannel Scheduler)
- Resmi API entegrasyonları (YouTube Data API v3, TikTok Content Posting API, Meta Graph API, LinkedIn Marketing API).
- Görsel Takvim (Apple Calendar estetiğinde Gün/Hafta/Ay görünümü).
- **Timezone-Aware Scheduling:** Hedef kitlenin saat dilimine göre otomatik kuyruklama (Örn: TR versiyonu 19:00 GMT+3'te, EN versiyonu 19:00 EST'de yayınlansın).
- Hata durumunda üstel geri çekilme (Exponential Backoff) ile yeniden deneme ve mobil/web bildirim gönderimi.