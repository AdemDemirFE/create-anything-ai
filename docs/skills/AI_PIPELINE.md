# 🧠 AI & MEDIA PROCESSING PIPELINE

Bu modül `backend/` altında `com.aetherflow.ai` ve `com.aetherflow.media` paketlerinde Java 25 Virtual Threads kullanılarak inşa edilecektir.

## 1. LiteLLM / GLM / OpenAI Compatible Gateway
Backend, tek bir LLM sağlayıcısına bağımlı kalmaz. `application.yml` içindeki `aetherflow.ai.base-url` ve `aetherflow.ai.model` parametreleri üzerinden GLM-4, OpenAI, Claude veya yerel Ollama/vLLM modellerini çağırabilir.

## 2. AI Yetenek Servisleri (`AiContentService.java`)
1. **`generatePlatformAdaptations(String transcript, String coreTopic)`:**
   - Tek bir video transkriptini alır, JSON Schema (Structured Outputs) kullanarak tek seferde 6 platform için ayrı tonlarda içerik üretir:
     - *YouTube Long:* SEO odaklı başlık, detaylı özet, zaman damgaları (Chapters) ve 15 arama etiketi.
     - *Shorts & TikTok:* İlk 3 saniyede merak uyandıran kısa başlık, viral hashtag kombinasyonu.
     - *Instagram Reels:* Etkileşim sorusu içeren açıklama + ilk yorum için 15 niş hashtag.
     - *LinkedIn:* Kurumsal/hikaye anlatımlı (Storytelling) çıkarım metni, maddeli özet ve profesyonel etiketler.
2. **`translateAndLocalize(LocalizationRequest request)`:**
   - Kelimesi kelimesine (literal) çeviri YAPMAZ. Deyimleri, mizahı ve sosyal medya terimlerini hedef dilin yerel kültürüne (Cultural Localization) uyarlar.
   - SRT dosyasındaki zaman damgalarını (`00:00:01,000 --> 00:00:03,500`) kesinlikle bozmadan ve satır başına maksimum karakter sınırını (42 karakter) aşmadan çeviri yapar.

## 3. FFmpeg Media Service (`MediaProcessingService.java`)
- `ProcessBuilder` ile güvenli FFmpeg çağrıları:
  1. **Ses Ayrıştırma:** `ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav` (Whisper/STT modeli için optimize).
  2. **Altyazı Gömme (Burn-in):** ASS/SRT stil dosyası ile 9:16 videolara Apple SF Pro estetiğinde okunaklı altyazı basma.
  3. **Otomatik Kare Yakalama:** Videodan en yüksek netlikteki 5 kareyi thumbnail adayı olarak dışa aktarma.