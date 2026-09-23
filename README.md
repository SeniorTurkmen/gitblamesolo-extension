# Git Blame Solo

Aktif satırın kenarında, o satırı en son değiştiren commit'i (yazar, tarih, commit mesajı) gösterir. Satır henüz commit'lenmemişse "Uncommitted changes" ve dosyanın son değiştirilme zamanı gösterilir. Herhangi bir satırın üzerine gelindiğinde (hover), o satırın commit'iyle ilgili tam detaylar (hash, yazar, tarih, tam commit mesajı) bir popup'ta gösterilir.

## Özellikler

- Aktif satırda satır sonu inline blame anotasyonu (GitLens'in "current line blame" özelliğine benzer).
- Herhangi bir satırın üzerine gelindiğinde tam commit detayları ve satırın ait olduğu **tüm değişen bloğu** gösteren diff ("What changed") — tek satır değil, aynı hunk'taki tüm ardışık değişiklikler.
- Hover'daki "View changed files" linkiyle, o commit'in değiştirdiği tüm dosyaların listesini ve **her dosyanın renkli diff içeriğini** (eklenen/silinen satırlar net şekilde ayrılmış) gösteren bir webview paneli açılır; dosya başlığına tıklayınca dosya editörde açılır. Panel, hangi satırdan açıldıysa diff içinde **tam o satırı** işaretler ve tıklayınca oraya geri döner.
- Kaydedilmemiş değişiklikler `git blame --contents -` ile canlı buffer'a karşı hesaplanır; commit'lenmemiş satırlar ayrıca işaretlenir.
- Komutlar: `Git Blame Solo: Toggle Inline Blame`, `Show Commit Details`, `Copy Commit Hash`.

## Bilinen Sınırlama

Commit'lenmemiş satırlar için gösterilen zaman, dosyanın diskteki son kaydetme zamanına (`mtime`) dayanır; her tuş vuruşunu değil, en son kaydetmeyi yansıtır.

## Geliştirme

```bash
npm install
npm run watch     # esbuild watch modu
```

`F5` ile "Run Extension" konfigürasyonunu başlatarak Extension Development Host içinde test edebilirsiniz.

## Test

```bash
npm run typecheck   # tsc --noEmit ile tam tip kontrolü
npm run test:unit   # saf fonksiyon testleri (parser, cache, date format)
npm test            # Extension Development Host içinde uçtan uca entegrasyon testleri
```

## Paketleme

```bash
npm run package
npx vsce package
```
