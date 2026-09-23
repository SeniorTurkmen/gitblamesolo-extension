# Changelog

## Unreleased

- Hover'ın "What changed" bölümü yeniden tasarlandı: VS Code'un native codicon'ları ile ($(git-commit), $(account), $(clock), $(diff) vb.) ikonlaştırılmış başlıklar, `+N`/`-N` şeklinde bir diff istatistik özeti, ve bölümleri ayıran ince çizgiler eklendi.
- (Denendi, geri alındı) Diff satırlarını tek tek ikonlu blockquote satırları olarak göstermeyi denedim — VS Code hover'ı `\n>` ile ayrılan satırları tek bir paragrafta birleştirip hepsini yan yana sıkıştırdı, okunaksız hale geldi. Diff gövdesi tekrar düz bir ` ```diff ` kod bloğuna (`appendCodeblock`) döndürüldü; sadece ikonlu başlık ve +/- sayaç korunuyor.
- Hover'daki "What changed" bölümüne **"Open in Diff Editor"** linki eklendi — tıklandığında VS Code'un **gerçek, native diff editörü** açılıyor (o commit'in bir öncesi ↔ kendisi karşılaştırması, `vscode.diff` komutu ile). Hover içinde markdown ile VS Code'un diff arayüzünü taklit etmek yerine, doğrudan asıl diff editörüne yönlendiriyor — böylece syntax highlighting, yan yana/satır içi görünüm gibi her şey birebir VS Code'un kendi tasarımı oluyor. İçerik `git show <sha>:<path>` ile sanal salt-okunur belgeler üzerinden geliyor (`GitShowContentProvider`).
- Commit detay panelindeki her dosya başlığına da aynı **"Open Diff"** butonu eklendi — hover'dakiyle aynı native VS Code diff editörünü açıyor. Rename edilen dosyalarda karşılaştırmanın sol tarafı doğru şekilde eski dosya yolunu kullanıyor.

- Hover'a "View changed files" linki eklendi; tıklandığında commit'in değiştirdiği tüm dosyaların listesini gösteren bir webview paneli açılıyor (dosya başlığına tıklayınca dosya editörde açılır).
- Webview paneli artık her dosyanın **gerçek diff içeriğini** de gösteriyor: eklenen satırlar yeşil, silinen satırlar kırmızı vurgulu, hunk başlıkları ayrı bir bantla ayrılmış. Çok uzun dosya diff'leri 400 satırda kırpılıp not düşülüyor.
- Üstteki bant kaldırıldı; bunun yerine, panel açıldığı satırdan geldiyse, ilgili dosyanın diff görünümünde **tam o satır** ("← opened from here" etiketiyle) mavi çerçeveyle işaretleniyor ve tıklanınca o satıra geri dönülüyor. Panel açıldığında otomatik olarak o satıra kaydırılıyor.
- Her hunk'ın başında bir **"Revert Hunk"** butonu eklendi: o hunk'ı `git apply --reverse` ile mevcut çalışma kopyasında geri alıyor. Güvenlik için: dosyada kaydedilmemiş değişiklik varsa engelleniyor, her zaman bir onay penceresi (modal) çıkıyor, ve hunk artık dosyanın güncel haliyle uyuşmuyorsa (o bölge sonradan tekrar değiştirilmişse) dosyaya hiç dokunmadan net bir hata gösteriliyor.
- Hover'da artık "What changed" başlığı altında, o satırı son değiştiren commit'in **tüm değişen bloğu** (sadece o satır değil, aynı hunk'taki tüm ardışık satırlar) gösteriliyor — "bu blok şu blokla değiştirildi" görünümü. İlk yaklaşım (`git log -L`) tek satıra kilitlenip komşu satırları kaybediyordu; bunun yerine commit'in tam diff'i alınıp o satırı içeren hunk'ın tamamı çıkarılıyor.

## 0.0.1

- İlk sürüm: aktif satır için inline git blame anotasyonu, tüm satırlar için hover'da tam commit detayı, commit'lenmemiş satırlar için mtime tabanlı zaman gösterimi.
