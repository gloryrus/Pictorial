# Pictorial patch: compact lock preview fix

Что заменить:

- `src/App.tsx`
- `src/App.css`
- `src/main.tsx`
- `src/useViewer.ts`
- `src/media.ts`
- `src/geometry.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/nsis/hooks.nsh`

Что изменено:

- При закреплении окно становится компактным: физический размер окна равен размеру текущего фото/видео.
- Прозрачный fullscreen-overlay больше не лежит поверх браузера в закрепленном режиме.
- Миниатюра Windows на панели задач показывает само медиа крупно, а не огромное пустое окно.
- При откреплении окно возвращается в большой прозрачный overlay для нормального drag/zoom.
- Горячие F-клавиши и лишние комбинации остаются заблокированы.

После замены:

```powershell
Remove-Item -Recurse -Force .\src-tauri\target
npm run tauri dev
```
