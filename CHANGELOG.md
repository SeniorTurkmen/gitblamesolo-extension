# Changelog

## Unreleased

- Hover'a "View changed files" linki eklendi; tıklandığında commit'in değiştirdiği tüm dosyaların listesini gösteren bir webview paneli açılıyor (dosyaya tıklayınca açılır).
- Hover'da artık "What changed" başlığı altında, o satırı son değiştiren commit'in **tüm değişen bloğu** (sadece o satır değil, aynı hunk'taki tüm ardışık satırlar) gösteriliyor — "bu blok şu blokla değiştirildi" görünümü. İlk yaklaşım (`git log -L`) tek satıra kilitlenip komşu satırları kaybediyordu; bunun yerine commit'in tam diff'i alınıp o satırı içeren hunk'ın tamamı çıkarılıyor.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
