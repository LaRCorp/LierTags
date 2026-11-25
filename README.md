<div align="center">
  <img src="src-tauri/icons/logo.png" width="96" height="96" alt="LierTags Logo" />
  <h1>🎵🏷️ LierTags v1.1 — Быстрый редактор аудиотегов</h1>
  <p><strong>Локальный высокопроизводительный редактор тегов и обложек музыкальных треков на Rust и Tauri 2</strong></p>

  <p>
    <a href="README.md"><img src="https://img.shields.io/badge/Язык-Русский-8B0000?style=flat-square" alt="Русский" /></a>
    <a href="README_EN.md"><img src="https://img.shields.io/badge/Language-English-39C5BB?style=flat-square" alt="English" /></a>
    <a href="https://github.com/LaRCorp/LierTags/releases"><img src="https://img.shields.io/badge/release-v1.1-6366f1?style=flat-square" alt="Version 1.1" /></a>
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-0ea5e9?style=flat-square" alt="Windows | Linux" />
    <img src="https://img.shields.io/badge/Tauri%202-React%2019%20%7C%20Rust-8b5cf6?style=flat-square" alt="Tauri 2 + React 19 + Rust" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-10b981?style=flat-square" alt="GPLv3 License" /></a>
    <a href="https://github.com/LaRCorp/LierEX-Q"><img src="https://img.shields.io/badge/Companion-LierEX--Q_v1.4%2B-f59e0b?style=flat-square" alt="LierEX-Q v1.4+" /></a>
    <a href="https://github.com/LaRCorp/Lierkour"><img src="https://img.shields.io/badge/Companion-Lierkour_v2.3%2B-8b5cf6?style=flat-square" alt="Lierkour v2.3+" /></a>
    <a href="https://github.com/LaRCorp/LierSync"><img src="https://img.shields.io/badge/Companion-LierSync_v1.2%2B-39C5BB?style=flat-square" alt="LierSync v1.2+" /></a>
  </p>
</div>

**LierTags** — локальное настольное приложение и CLI-инструмент для чтения, редактирования, поиска и упорядочивания метаданных музыкальных аудиофайлов. Построено на быстром аудиодвижке **Rust** (библиотека `lofty`), **Tauri 2** и **React 19**, обеспечивая моментальный запуск и минимальное потребление системных ресурсов даже на огромных библиотеках в десятки тысяч треков.

> 🧩 **Импорт метаданных из браузера в 1 клик:** для быстрого извлечения тегов, релизов и качественных обложек с MusicBrainz, Discogs, Last.fm, Bandcamp и Яндекс.Музыки установите браузерное расширение **[LierEX-Q](https://github.com/LaRCorp/LierEX-Q)** (порт `8766`).

Приложение работает в автономном режиме на **Windows** и **Linux**, не требует аккаунтов, облачных подписок или постоянного подключения к сети. Все изменения вносятся напрямую в файлы треков на вашем компьютере.

---

## Возможности

### 🎵 Редактирование аудиотегов и форматов
- **Широкая поддержка аудиоформатов:** MP3 (ID3v1, ID3v2.3, ID3v2.4), FLAC (Vorbis Comments), M4A / AAC / ALAC (MP4 Atoms), OGG Vorbis, Opus, WAV / AIFF (RIFF INFO / ID3), APE.
- Редактирование основных и расширенных полей: название трека, исполнитель, альбом, год, жанр, номер трека и диска, комментарии.
- Пакетное и индивидуальное сохранение изменений по нажатию `Ctrl+S` или кнопке в панели.
- Безопасная запись тегов без повреждения аудиопотока на базе проверенной библиотеки `lofty`.

### 🖼️ Управление обложками (Cover Art)
- Автоматическое извлечение встроенных обложек треков (JPEG, PNG, WebP).
- Предпросмотр обложки в реальном времени с отображением MIME-типа и размера.
- Замена обложки в один клик: выбор файла через диалог, **Drag-and-Drop** файла прямо в карточку обложки или **вставка из буфера обмена** (`Ctrl+V`).
- Удаление повреждённых или ненужных обложек.
- Автоматическая загрузка обложек релизов высокого качества из **Cover Art Archive**.

### 📜 Тексты песен (Lyrics)
- Поддержка синхронизированных текстов песен в формате **LRC** (`[mm:ss.xx]`) и обычных несинхронизированных текстов.
- Автоматическое определение синхронизированных тайм-кодов.
- Опция сохранения текстового файла `.lrc` рядом с треком или внедрения текста непосредственно в метаданные файла.

### ⚡ Высокая скорость и низкое потребление ОЗУ
- **Виртуализированный рендеринг таблицы:** на базе `@tanstack/react-virtual` интерфейс плавно скроллит 10 000+ треков без создания тысяч DOM-узлов и без утечек памяти WebView.
- **Многопоточное сканирование:** обход директорий на пуле потоков `rayon` с быстрым параллельным чтением тегов.
- **Встроенный SQLite-кэш:** при повторном открытии папки метаданные загружаются мгновенно без повторного чтения файлов с диска.
- Моментальный регистронезависимый поиск и фильтрация по названию, артисту, альбому или жанру.

### 🗂️ Органайзер и групповое переименование файлов
- Вкладка **Organizer** позволяет автоматически переименовывать и структурировать файлы по настраиваемым паттернам.
- Гибкие шаблоны путей: `{artist}/{album}/{track:02} - {title}.{ext}`, `{genre}/{artist} - {title}.{ext}` и другие.
- Предпросмотр плана переименования перед применением для предотвращения случайных ошибок.

### 🔍 Поиск и очистка дубликатов треков
- Вкладка **Duplicates** автоматически находит повторяющиеся композиции в коллекции.
- Режимы сопоставления: по точным хешам аудиоданных (SHA-256) либо по схожести метаданных (артист + название + длительность).
- Сравнение битрейтов, частоты дискретизации и качества для сохранения лучшей копии.

### 🌐 Интеграция с MusicBrainz API
- Интерактивный поиск треков и релизов в глобальной открытой базе MusicBrainz.
- Подтягивание года, альбома, номеров треков и обложек релиза в один клик.

### 🖱️ Drag-and-Drop и эргономика
- Перетаскивание папок или файлов аудио прямо из проводника Windows или файлового менеджера Linux в окно LierTags.
- Индикация несохранённых изменений (dirty state).
- Удобное переключение между вкладками: «Библиотека», «Органайзер» и «Дубликаты».

---

## Расширение для браузера LierEX-Q

Для мгновенного импорта метаданных треков прямо со страниц стримингов и музыкальных баз данных используется официальное расширение **[LierEX-Q](https://github.com/LaRCorp/LierEX-Q)** (порт `8766`).

### Поддерживаемые музыкальные сервисы
| Площадка | Домен | Что извлекается в LierTags |
| --- | --- | --- |
| **MusicBrainz** | `musicbrainz.org` | Название трека/релиза, исполнитель, альбом, год, жанровые теги, обложка (Cover Art Archive) |
| **Discogs** | `discogs.com` | Название, исполнитель, альбом, год релиза, стили/жанры, обложка из галереи/мета |
| **Last.fm** | `last.fm` | Название, исполнитель, альбом, год, жанровые теги, качественный арт исполнителя/альбома |
| **Bandcamp** | `bandcamp.com` | Название трека, исполнитель, альбом, год релиза, теги, качественный popup-арт обложки |
| **Яндекс.Музыка** | `music.yandex.ru` / `.com` | Название трека/альбома, исполнители, альбом, год выпуска, жанры, HD-обложка |

### Инструкция подключения
1. Установите расширение **[LierEX-Q](https://github.com/LaRCorp/LierEX-Q)** в браузер (Chrome, Edge, Opera, Яндекс.Браузер, Brave).
2. Запустите настольное приложение **LierTags** (или фоновый сервер `cargo run -p liertags-cli -- serve --port 8766`). Встроенный HTTP-сервер автоматически слушает `http://127.0.0.1:8766/api/import`.
3. Откройте страницу любого трека или альбома на поддерживаемом сайте.
4. Нажмите иконку расширения **LierEX-Q** и выберите **«Добавить в LierTags»** (токен авторизации не требуется, локальный мост работает напрямую).
5. В интерфейсе LierTags мгновенно откроется модальное окно предпросмотра с предложением применить полученные метаданные и обложку к текущему выбранному треку.

---

## CLI-утилита (liertags-cli)

Для автоматизации, скриптов и работы в терминале без графической оболочки проект включает утилиту `liertags-cli`:

### 1. Чтение тегов аудиофайла
```bash
cargo run -p liertags-cli -- read "C:\Music\track.mp3"
```

### 2. Запись тегов вручную
```bash
cargo run -p liertags-cli -- write "C:\Music\track.mp3" --title "Новый трек" --artist "Исполнитель" --album "Альбом" --year 2024 --genre "Electronic"
```

### 3. Импорт метаданных из JSON (формат LierEX-Q)
```bash
cargo run -p liertags-cli -- import-json "C:\Music\track.mp3" "metadata.json"
```

### 4. Рекурсивное сканирование каталога
```bash
cargo run -p liertags-cli -- scan "C:\Music" --recursive
```

### 5. Автономный запуск HTTP-сервера импорта (порт 8766)
```bash
cargo run -p liertags-cli -- serve --port 8766
```

---

## Архитектура проекта

Проект организован по модульной схеме:

```text
LierTags/
├── crates/
│   ├── core/                  # Ядро: модели, парсинг тегов (lofty), axum-сервер, SQLite-кэш, API
│   │   ├── src/models.rs      # Структуры Track, TrackMetadata, ImportPayload, SaveTrackPayload
│   │   ├── src/tags.rs        # Чтение и запись аудиотегов и обложек через lofty
│   │   ├── src/cache.rs       # Локальный кэш библиотеки на SQLite (WAL-режим)
│   │   ├── src/organizer.rs   # Движок реорганизации файлов по шаблонам путей
│   │   ├── src/duplicates.rs  # Алгоритмы обнаружения дубликатов по хешам и полям
│   │   ├── src/lyrics.rs      # Парсинг и сохранение текстов LRC
│   │   ├── src/server.rs      # Axum HTTP-сервер на 127.0.0.1:8766 (мост LierEX-Q)
│   │   └── src/api.rs         # Клиенты MusicBrainz и Cover Art Archive
│   └── cli/                   # Автономный CLI для терминальной работы и скриптов
│       └── src/main.rs        # Команды read, write, import-json, scan, serve
├── src-tauri/                 # Хост Tauri 2 (команды, файловые диалоги, события UI)
│   ├── src/commands.rs        # Команды управления треками, сканированием и MusicBrainz
│   └── src/lib.rs             # Инициализация приложения Tauri и фонового сервера
└── frontend/                  # Интерфейс на React 19 + TypeScript + Vite 8 + Tailwind CSS v4
    └── src/
        ├── App.tsx            # Главный каркас приложения и роутинг вкладок
        ├── components/
        │   ├── TrackTable.tsx # Виртуализированная таблица аудиофайлов (@tanstack/react-virtual)
        │   ├── EditPanel.tsx  # Панель редактирования тегов, обложки, текстов и MusicBrainz
        │   ├── ImportModal.tsx# Модальное окно предпросмотра данных от LierEX-Q
        │   ├── OrganizerTab.tsx# Вкладка пакетной реорганизации и переименования
        │   └── DuplicatesTab.tsx# Вкладка поиска и очистки дубликатов
        └── types.ts           # Интерфейсы данных
```

---

## Стек технологий

| Компонент | Технология |
| --- | --- |
| Оболочка десктопа | Tauri 2 |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4 |
| Таблица и виртуализация | `@tanstack/react-virtual` v3 |
| Иконки | Lucide React |
| Backend | Rust 2024 (`liertags-core`, `liertags-app`, `liertags-cli`) |
| Аудиодвижок тегов | `lofty` 0.25 (чтение/запись ID3v1, ID3v2, Vorbis, MP4, FLAC, APE) |
| Локальный кэш | `rusqlite` 0.41 (встроенный SQLite engine с WAL) |
| HTTP-сервер (мост LIER) | `axum` 0.8 + `tokio` (`127.0.0.1:8766`, `/api/lier/info`, `/api/ost/from-lierkour`) |
| HTTP-клиент | `ureq` 3.5 с `rustls` (MusicBrainz, Cover Art и мосты экосистемы LIER) |
| Обработка изображений | `image` 0.25 (валидация, масштабирование обложек) |
| Параллелизм | `rayon` 1.10 (быстрое параллельное сканирование директорий) |

---

## Быстрый старт (Разработка)

### Требования
- **Rust stable** (edition 2024)
- **Node.js 22+** и npm
- **Tauri CLI 2**:
  ```bash
  cargo install tauri-cli --version "^2" --locked
  ```

### Запуск в режиме разработки
```bash
git clone https://github.com/LaRCorp/LierTags.git
cd LierTags

cd frontend
npm ci
cd ..

cargo tauri dev
```

Tauri автоматически скомпилирует бэкенд, запустит Vite-сервер на `http://127.0.0.1:5173` и откроет окно приложения с поддержкой горячей перезагрузки (HMR).

---

## Сборка релизов

### Windows

Из корня репозитория выполните скрипт сборки:
```powershell
powershell -ExecutionPolicy Bypass -File packaging/windows/build.ps1
```

Скрипт соберёт продакшен frontend, скомпилирует release-бинарник на Rust и сформирует автономный пакет:
```text
dist/LierTags-windows-x64/
├── liertags-app.exe     # Обычный запуск приложения
└── run-portable.bat     # Портативный запуск (кэш в локальной папке ./data)
```

---

## Портативный режим

В портативном режиме локальный SQLite-кэш и временные файлы сохраняются в локальной подпапке `data` рядом с исполняемым файлом.

Для запуска в портативном режиме:
- **Windows:** запустите `run-portable.bat` или задайте переменную окружения `LIERTAGS_DATA_DIR=./data`.

---

## Расположение системных данных

В стандартном режиме кэш библиотеки и настройки хранятся по системным путям:
- **Windows:** `%APPDATA%\LierTags\`
- **Linux:** `${XDG_DATA_HOME:-~/.local/share}/LierTags/`

Структура каталога данных:
```text
LierTags/
└── library_cache.db     # База данных SQLite с индексами треков и метаданных
```

---

## Проверка качества и тесты

```bash
# Тесты ядра, парсинга тегов, lyrics и кэша
cargo test --workspace

# Сборка и проверка типов фронтенда
cd frontend
npm run build
```

---

## Лицензия

Проект распространяется под свободной лицензией **GNU General Public License v3.0 (GPLv3)** — см. [LICENSE](LICENSE).

Copyright (c) 2026 LaRevole.

Сделано с любовью к музыке и Rust.

---

### Связанные проекты экосистемы
- ⚡🔄 **[LaRCorp/LierSync](https://github.com/LaRCorp/LierSync)** — быстрая P2P-передача файлов, синхронизация папок и буфера обмена между ПК и Android.
- 🌐 **[LaRCorp/LierEX-Q](https://github.com/LaRCorp/LierEX-Q)** — браузерное расширение для извлечения треков, фильмов, видеоигр и быстрой отправки в LierSync.
- 🎮🎬 **[LaRCorp/Lierkour](https://github.com/LaRCorp/Lierkour)** — локальный кроссплатформенный каталогизатор фильмов, сериалов, аниме и видеоигр.
