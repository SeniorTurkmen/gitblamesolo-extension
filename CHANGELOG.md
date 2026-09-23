# Changelog

## Unreleased

- Hover'a "View changed files" linki eklendi; tıklandığında commit'in değiştirdiği tüm dosyaların listesini gösteren bir webview paneli açılıyor (dosyaya tıklayınca açılır).
- Hover'da artık "What changed" başlığı altında, o satırı son değiştiren commit'in tam diff hunk'ı (`git log -L`) gösteriliyor — satırın öncesi/sonrası tek bakışta görülebiliyor.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
