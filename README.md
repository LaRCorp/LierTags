# LierTags 🎵

**LierTags** — быстрый, легковесный локальный редактор метаданных (тегов) музыкальных треков на Rust (Tauri 2 + React + lofty) с прямой интеграцией с браузерным расширением **LierEX-Q**.

Лицензия: **GPL-3.0**.

---

## 🚀 Архитектура проекта

Проект организован по модульной схеме:

```
LierTags/
├── crates/
│   ├── core/                  # Ядро: модели, работа с тегами (lofty), axum сервер, API
│   │   ├── src/models.rs      # Структуры Track, TrackMetadata, ImportPayload
│   │   ├── src/tags.rs        # Чтение/запись аудиотегов и обложек через lofty
│   │   ├── src/server.rs      # Axum HTTP-сервер на 127.0.0.1:8766
│   │   └── src/api.rs         # Клиенты MusicBrainz и Cover Art
│   └── cli/                   # CLI-прототип (Этап 1) для тестирования и отладки
│       └── src/main.rs        # Команды read, write, import-json, scan, serve
├── src-tauri/                 # Хост Tauri 2 (команды, трей, мост событий к UI)
│   ├── src/commands.rs        # Команды scan_folder, read_track, save_tags, search_musicbrainz
│   └── src/lib.rs             # Инициализация Tauri и фонового axum-сервера
└── frontend/                  # Современный UI на React 19 + TypeScript + Tailwind CSS v4
    └── src/
        ├── App.tsx            # Главный интерфейс и обработчики событий
        ├── components/
        │   ├── TrackTable.tsx # Таблица аудиофайлов с фильтрацией и статусом
        │   ├── EditPanel.tsx  # Панель ручного редактирования + обложка + MusicBrainz
        │   └── ImportModal.tsx# Модальное окно предпросмотра данных от LierEX-Q
```

---

## 🛠️ Этап 1: CLI-прототип (Проверка работы тегов и JSON)

Для тестирования чтения, записи и парсинга без запуска графического интерфейса используется `liertags-cli`:

### 1. Чтение тегов трека
```bash
cargo run -p liertags-cli -- read "C:\Music\track.mp3"
```

### 2. Запись тегов вручную
```bash
cargo run -p liertags-cli -- write "C:\Music\track.mp3" --title "Новый трек" --artist "Исполнитель" --album "Альбом" --year 2024 --genre "Electronic"
```

### 3. Импорт метаданных из JSON (формат LierEX-Q)
```bash
cargo run -p liertags-cli -- import-json "C:\Music\track.mp3" "test_import.json"
```

### 4. Сканирование папки
```bash
cargo run -p liertags-cli -- scan "C:\Music" --recursive
```

### 5. Автономный запуск HTTP-сервера для LierEX (порт 8766)
```bash
cargo run -p liertags-cli -- serve --port 8766
```

---

## 🌐 Этап 2: Интеграция с расширением LierEX-Q

Сервер слушает `http://127.0.0.1:8766/api/import` и принимает POST-запросы:

```json
{
  "type": "track",
  "title": "Название трека",
  "artist": "Исполнитель",
  "album": "Альбом",
  "year": 2024,
  "genre": "Electronic",
  "artwork_url": "https://...",
  "source_url": "https://..."
}
```

* Поле `type` строго проверяется (`track`). Другие типы (фильмы/игры для Lierkour) корректно отклоняются со статусом 400.
* При получении события сервер отправляет его через Tauri Event `track_imported` в графический интерфейс, открывая модальное окно предпросмотра.

---

## 💻 Сборка и запуск GUI (Tauri 2)

### Запуск в режиме разработки:
```bash
# 1. Установка зависимостей фронтенда
cd frontend
npm install

# 2. Запуск сборки
cargo build
```

При запуске Tauri приложения (`liertags-app`):
- Автоматически поднимается axum HTTP-сервер на `127.0.0.1:8766`.
- Фронтенд на React готов принимать треки, сканировать папки, искать данные в MusicBrainz и сохранять теги по `Ctrl+S`.
