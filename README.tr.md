# Kod Akışı

**Claude kodunu yazarken sohbetin yanındaki panelde canlı izle.** [Claude Code](https://claude.com/claude-code) için bir mod. · [English](README.md)

![Kod Akışı paneli: akış hızı grafiği, akan düşünce metni, satır satır yazılan kod ve olay günlüğü](assets/onizleme.svg)

<sub>Önizleme temsilidir; panel Claude Code'un kendi yazı tipi ve renk temasıyla çizilir.</sub>

Claude bir dosya yazarken ekranda çoğu zaman bir bekleme animasyonu ve tıklayınca açılan satırlar olur. Kod Akışı, modelin ürettiği kodu üretildiği anda konuşmanın yanındaki panelde akıtır. Dosyalar satır numarasıyla ve renkli gelir, düzenlemeler eksi/artı fark olarak görünür, komutlar çıktılarıyla birlikte durur. Düşünce metni gönderiliyorsa o da kendi kutusunda akar; alt ajanlar çalışıyorsa her biri kendi şeridinde izlenir.

Modelden ek bir şey istemez, zaten gelen yanıt akışını çizer. Bu yüzden fazladan token harcamaz.

## Kurulum

Claude Code'un terminal oturumunda, yazma satırına şunu yaz:

```
/plugin install kod-akisi --marketplace Ilyas-jpg/kod-akisi
```

Pazar yerini eklemek için `y` de, sonra kapsamı seç. Aynısı kabuktan:

```bash
claude plugin install kod-akisi --marketplace Ilyas-jpg/kod-akisi
```

Masaüstü uygulamasında `/plugin` çalışmaz: yazma kutusunun yanındaki **+** düğmesine, ardından **Plugins**'e tıkla; **Add marketplace** ile `Ilyas-jpg/kod-akisi` ekle, sonra **Add plugin**.

Ardından yeni bir oturum aç. Modlar terminalde Claude Code 2.1.287, masaüstü uygulamasında 2.1.286 ve sonrasında çalışır. Kod Akışı en son 2.1.325 sürümünde denendi.

## Kullanım

Panel oturum başlarken kendiliğinden gelir. Claude bir dosya yazmaya, düzenlemeye ya da komut çalıştırmaya başladığında kod panelde akar.

| Komut | Ne yapar |
|---|---|
| `/kod-akisi` | Paneli açar. |
| `/kod-akisi kapat` | Paneli kapatır ve kendiliğinden açılmasını durdurur. `/kod-akisi` yazınca geri gelir. |
| `/kod-akisi tr` | Paneli Türkçeye çevirir. |
| `/kod-akisi en` | İngilizceye geri döndürür. |

Terminaldeki Claude Code'da panel geniş pencerede kendiliğinden, dar pencerede `/kod-akisi` yazınca açılır.

## Dil

Panel varsayılan olarak İngilizce açılır; `/kod-akisi tr` yazınca Türkçe olur. Tercih oturumlar arasında saklanır, sayılar da dile uyar: İngilizcede `3.4 s`, Türkçede `3,4 sn`.

## Panelde ne var

- **Sahne.** Yazılan dosya satır numarasıyla ve sözdizimi renkleriyle akar, son satırlar izlenir, uçta imleç durur. Düzenlemeler canlı fark olarak gelir; araç bitince gerçek satır numaralı yamaya döner. Komutlar altlarında çıktılarının son satırlarıyla görünür.
- **Başlık.** Claude'un o an ne yaptığı (düşünüyor, yazıyor, çalıştırıyor, anlatıyor), çalışan alt ajan sayısı, araç sayısı, üretilen token ve süre. Altında akış hızının grafiği: çubuklar sağda doğar, sola yürürken solar.
- **Düşünce.** Modelin düşünce metni mor çerçeveli kutuda akar, son satırlar izlenir. Araç çalışırken son düşünce soluk hâlde okunur kalır.
- **Ajanlar.** Çalışan her alt ajan için bir satır: türü, o an yaptığı iş, araç sayısı ve süresi.
- **Akış satırı.** Anlatım metninin canlı ucu.
- **Günlük.** Son araç çağrıları, en yenisi üstte. Alt ajanın çağrıları ajanın rengiyle işaretlenir.

Yalnız `Write` ve `Edit` değil; SQL sorgusu, HTML, uzun bir istem gibi çok satırlı her araç argümanı sahneye çıkar.

## Düşünceyi görmek

Claude Code, düşünce metnini yalnız istenirse gönderir. İstenmediğinde model yine düşünür ama metni akışta yer almaz; panel de çizecek bir şey bulamaz.

- **Masaüstü uygulaması:** konuşmanın başlık menüsünden Transcript view › Thinking (ya da Verbose) seç. Yeni oturumların varsayılan görünümü Ayarlar'dan değişir.
- **Terminal:** `~/.claude/settings.json` içine `"showThinkingSummaries": true` ekle.

Gelen metin modelin ham iç konuşması değil, Claude Code'un sunduğu düşünce özetidir. Düşünce gizli akıyorsa panel ilk birkaç turda bunu nasıl açacağını söyleyen soluk bir not gösterir, sonra susar.

## Alt ajanlar

Claude işi alt ajanlara dağıttığında her ajan panelde kendi satırını alır. Sahne, o an kod yazan döngüyü gösterir ve başlığına ajanın adını yazar. Ana konuşma her zaman önceliklidir; paralel ajanlar birbirinin akışını yarıda kesmez, sahne bir akış durulunca öbürüne geçer.

Ana konuşma bitse de arka planda çalışan ajan izlenmeye devam eder; başlık kaç ajanın çalıştığını söyler. Terminalde görev listesinden bir ajanın konuşmasını açtığında panel yalnız o ajanı çizer.

Motorun kendi iç döngüleri (konuşmayı sıkıştırma, hafıza gibi) ajan sayılmaz ve panele karışmaz.

## Güncelleme ve kaldırma

```bash
claude plugin marketplace update ilyassaltay
claude plugin update kod-akisi@ilyassaltay
```

Ardından yeni bir oturum aç. Kaldırmak için: `claude plugin uninstall kod-akisi@ilyassaltay`.

Eski bir sürümü `git clone` ile `~/.claude/skills/kod-akisi` klasörüne kurduysan `git -C ~/.claude/skills/kod-akisi pull` ile güncelle ya da o klasörü silip yukarıdaki gibi kur.

## Neye dokunur, neye dokunmaz

Mod, senin yetkinle çalışan koddur; neye dokunduğunu sormak hakkındır.

Kod Akışı, modelin yanıt akışını `turn.step` olayında dinler, araç argümanlarının JSON'unu parça parça çözer ve paneli çizer. Akışı ve araç sonuçlarını değiştirmez, her parçayı geldiği gibi geçirir; panelin kendi kodundaki bir hata araç çağrısını durduramaz.

Ağa çıkmaz, dosya okumaz ya da yazmaz, süreç başlatmaz. Motordan istediği şeylerin tamamı şunlardır: panel açma ve kapama, kendi durumunu ve üç küçük tercihi saklama (kendiliğinden açılma, dil, düşünce ipucunun kaç kez gösterildiği), zamanlayıcı, komut kaydı, bildirim, alt ajan listesini okuma ve hata ayıklama günlüğüne tek satır. Buna güvenmek zorunda değilsin:

```bash
claude plugin validate .claude-plugin/plugin.json
```

bütün kancaları ve motor çağrılarını kaynaktan okuyup listeler.

## Sınırlar

- Mod arayüzü bir Claude Code güncellemesiyle değişebilir. Böyle bir durumda panel gelmez, oturumun kendisi etkilenmez.
- Windows'taki masaüstü uygulamasında kullanılarak, terminal yüzeyinde ise Claude Code'un test takımıyla denendi. Kod işletim sistemine özgü bir şey kullanmıyor, bu yüzden macOS ve Linux'ta da çalışması beklenir; orada ve VS Code eklentisinde henüz denenmedi.

## Geliştirme

```bash
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

İlk komut kancaları ve motor çağrılarını Claude Code'un gözünden okur. İkincisi sahte bir model akışıyla paneli masaüstü ve terminal yüzeyinde, iki dilde çizer; `tests/yerlesim.test.ts` panelin düz metin önizlemesini de basar.

Terminal bir hücre ızgarasıdır, masaüstü ise yazıyı orantılı yazı tipiyle çizer. Bu yüzden satırlar hem sütuna göre kırpılır hem esnek kutularla dizilir; hız grafiği terminalde blok karakterlerle, öbür yüzeylerde genişliğe esneyen vektörle çizilir.

Kaynak dört dosyadır: `hooks/register.tsx` (kancalar ve çizim), `hooks/akis.ts` (akan JSON okuyucu, kuyruk tamponu, fark üretimi), `hooks/dil.ts` (arayüz dili) ve `types/index.d.ts` (panelin durum sözleşmesi). Her sürümde ne değiştiği [CHANGELOG.md](CHANGELOG.md) dosyasında.

## Lisans

[MIT](LICENSE). Yapan: İlyas Saltay · [ilyassaltay.com](https://ilyassaltay.com)

Claude Code ile birlikte geliştirildi; doğrulama ve testler depoda.
