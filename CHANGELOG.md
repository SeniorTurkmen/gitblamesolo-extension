# Changelog

## Unreleased

## 0.1.0

- Hover'daki "What changed" bölümü yeniden tasarlandı: VS Code codicon'ları, `+N`/`-N` diff istatistiği ve bölümleri ayıran çizgiler. Diff gövdesi renkli bir kod bloğu olarak kalıyor.
- Hover, satırı son değiştiren commit'in yalnızca o satırını değil, aynı hunk'taki tüm ardışık değişikliği gösteriyor.
- Hover'dan **"Open in Diff Editor"** ve commit panelindeki her dosyadan **"Open Diff"** ile VS Code'un native diff editörü açılıyor (önceki commit ↔ bu commit). Yeniden adlandırılan dosyalarda sol taraf eski yolu kullanıyor.
- **"View changed files"** commit'in değiştirdiği dosyaları renkli diff'leriyle bir panelde listeliyor. Panel bir satırdan açıldıysa o satır işaretlenip kendisine kaydırılıyor. Uzun diff'ler 400 satırda kırpılıyor.
- Her hunk için **"Revert Hunk"**: `git apply --reverse` ile yalnızca o bloğu geri alır. Kaydedilmemiş değişiklik varsa veya hunk güncel dosyayla uyuşmuyorsa dosyaya dokunmadan hata verir; her seferinde onay ister.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
