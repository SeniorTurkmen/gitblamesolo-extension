# Changelog

## Unreleased

- Hover'a "View changed files" linki eklendi; tıklandığında commit'in değiştirdiği tüm dosyaların listesini gösteren bir webview paneli açılıyor (dosya başlığına tıklayınca dosya editörde açılır).
- Webview paneli artık her dosyanın **gerçek diff içeriğini** de gösteriyor: eklenen satırlar yeşil, silinen satırlar kırmızı vurgulu, hunk başlıkları ayrı bir bantla ayrılmış. Çok uzun dosya diff'leri 400 satırda kırpılıp not düşülüyor.
- Hover'da artık "What changed" başlığı altında, o satırı son değiştiren commit'in **tüm değişen bloğu** (sadece o satır değil, aynı hunk'taki tüm ardışık satırlar) gösteriliyor — "bu blok şu blokla değiştirildi" görünümü. İlk yaklaşım (`git log -L`) tek satıra kilitlenip komşu satırları kaybediyordu; bunun yerine commit'in tam diff'i alınıp o satırı içeren hunk'ın tamamı çıkarılıyor.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
