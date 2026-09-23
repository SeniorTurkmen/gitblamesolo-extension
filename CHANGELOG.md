# Changelog

## Unreleased

- Hover'a "View changed files" linki eklendi; tıklandığında commit'in değiştirdiği tüm dosyaların listesini gösteren bir webview paneli açılıyor (dosya başlığına tıklayınca dosya editörde açılır).
- Webview paneli artık her dosyanın **gerçek diff içeriğini** de gösteriyor: eklenen satırlar yeşil, silinen satırlar kırmızı vurgulu, hunk başlıkları ayrı bir bantla ayrılmış. Çok uzun dosya diff'leri 400 satırda kırpılıp not düşülüyor.
- Üstteki bant kaldırıldı; bunun yerine, panel açıldığı satırdan geldiyse, ilgili dosyanın diff görünümünde **tam o satır** ("← opened from here" etiketiyle) mavi çerçeveyle işaretleniyor ve tıklanınca o satıra geri dönülüyor. Panel açıldığında otomatik olarak o satıra kaydırılıyor.
- Her hunk'ın başında bir **"Revert Hunk"** butonu eklendi: o hunk'ı `git apply --reverse` ile mevcut çalışma kopyasında geri alıyor. Güvenlik için: dosyada kaydedilmemiş değişiklik varsa engelleniyor, her zaman bir onay penceresi (modal) çıkıyor, ve hunk artık dosyanın güncel haliyle uyuşmuyorsa (o bölge sonradan tekrar değiştirilmişse) dosyaya hiç dokunmadan net bir hata gösteriliyor.
- Hover'da artık "What changed" başlığı altında, o satırı son değiştiren commit'in **tüm değişen bloğu** (sadece o satır değil, aynı hunk'taki tüm ardışık satırlar) gösteriliyor — "bu blok şu blokla değiştirildi" görünümü. İlk yaklaşım (`git log -L`) tek satıra kilitlenip komşu satırları kaybediyordu; bunun yerine commit'in tam diff'i alınıp o satırı içeren hunk'ın tamamı çıkarılıyor.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
