import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Track, SaveTrackPayload, MusicBrainzRecording, LrcLibLyrics, LierkourOstCandidate } from '../types';
import {
  Save,
  Search,
  Image as ImageIcon,
  Trash2,
  RefreshCw,
  RotateCcw,
  Disc,
  ClipboardPaste,
  FileText,
  CheckCircle2,
  AlertCircle,
  Film,
} from 'lucide-react';

interface EditPanelProps {
  track: Track | null;
  onSave: (payload: SaveTrackPayload) => Promise<void>;
  onSearchMusicBrainz: (query: string) => Promise<MusicBrainzRecording[]>;
  onReload: () => Promise<void>;
  isSaving: boolean;
  isReloading?: boolean;
}

export const EditPanel: React.FC<EditPanelProps> = ({
  track,
  onSave,
  onSearchMusicBrainz,
  onReload,
  isSaving,
  isReloading = false,
}) => {
  const [formData, setFormData] = useState<Partial<SaveTrackPayload>>({});
  const [artworkPreview, setArtworkPreview] = useState<string | null>(null);
  const [removeArtwork, setRemoveArtwork] = useState<boolean>(false);
  const [mbResults, setMbResults] = useState<MusicBrainzRecording[]>([]);
  const [isSearchingMb, setIsSearchingMb] = useState<boolean>(false);
  const [showMbDropdown, setShowMbDropdown] = useState<boolean>(false);
  const [ostResults, setOstResults] = useState<LierkourOstCandidate[]>([]);
  const [isSearchingOst, setIsSearchingOst] = useState<boolean>(false);
  const [showOstDropdown, setShowOstDropdown] = useState<boolean>(false);
  const [ostError, setOstError] = useState<string | null>(null);
  const [isDraggingOverCover, setIsDraggingOverCover] = useState<boolean>(false);
  const [isSearchingLyrics, setIsSearchingLyrics] = useState<boolean>(false);
  const [saveLrcFile, setSaveLrcFile] = useState<boolean>(false);
  const [lyricsStatus, setLyricsStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (track) {
      setFormData({
        file_path: track.file_path,
        title: track.metadata.title || '',
        artist: track.metadata.artist || '',
        album: track.metadata.album || '',
        year: track.metadata.year,
        genre: track.metadata.genre || '',
        track_number: track.metadata.track_number,
        track_total: track.metadata.track_total,
        comment: track.metadata.comment || '',
        lyrics: track.metadata.lyrics || '',
        remove_artwork: false,
      });
      setArtworkPreview(track.metadata.artwork_base64 || null);
      setRemoveArtwork(false);
      setShowMbDropdown(false);
      setShowOstDropdown(false);
      setOstError(null);
      setLyricsStatus(null);
    } else {
      setFormData({});
      setArtworkPreview(null);
      setLyricsStatus(null);
    }
  }, [track]);

  // Global paste listener: captures image from clipboard (Ctrl+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!track) return;
      if (e.clipboardData?.items) {
        for (const item of e.clipboardData.items) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                setArtworkPreview(result);
                setRemoveArtwork(false);
                setFormData((prev) => ({
                  ...prev,
                  new_artwork_base64: result,
                  remove_artwork: false,
                }));
              };
              reader.readAsDataURL(blob);
            }
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [track]);

  if (!track) {
    return (
      <div className="w-80 lg:w-96 bg-[#18191f] border border-[#2b2d37] rounded-lg p-6 flex flex-col items-center justify-center text-[#6B7082] shadow-lg">
        <Disc className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">Выберите трек для редактирования</p>
      </div>
    );
  }

  const handleInputChange = (field: keyof SaveTrackPayload, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleArtworkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setArtworkPreview(result);
        setRemoveArtwork(false);
        setFormData((prev) => ({ ...prev, new_artwork_base64: result, remove_artwork: false }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePasteClipboardClick = async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            setArtworkPreview(result);
            setRemoveArtwork(false);
            setFormData((prev) => ({
              ...prev,
              new_artwork_base64: result,
              remove_artwork: false,
            }));
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      alert('В буфере обмена нет изображения. Скопируйте изображение в буфер и повторите.');
    } catch {
      alert('Нажмите Ctrl+V в окне для вставки изображения из буфера обмена.');
    }
  };

  const handleDropCover = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOverCover(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setArtworkPreview(result);
        setRemoveArtwork(false);
        setFormData((prev) => ({ ...prev, new_artwork_base64: result, remove_artwork: false }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveArtwork = () => {
    setArtworkPreview(null);
    setRemoveArtwork(true);
    setFormData((prev) => ({ ...prev, new_artwork_base64: undefined, remove_artwork: true }));
  };

  const handleSaveClick = async () => {
    if (!formData.file_path) return;
    const cleanTrim = (val?: string) => {
      if (!val) return undefined;
      const t = val.trim();
      return t.length > 0 ? t : undefined;
    };

    await onSave({
      file_path: formData.file_path,
      title: cleanTrim(formData.title),
      artist: cleanTrim(formData.artist),
      album: cleanTrim(formData.album),
      year: formData.year ? Number(formData.year) : undefined,
      genre: cleanTrim(formData.genre),
      track_number: formData.track_number ? Number(formData.track_number) : undefined,
      track_total: formData.track_total ? Number(formData.track_total) : undefined,
      comment: cleanTrim(formData.comment),
      lyrics: formData.lyrics !== undefined ? formData.lyrics : undefined,
      save_lrc_file: saveLrcFile,
      new_artwork_base64: formData.new_artwork_base64,
      remove_artwork: removeArtwork,
    });
  };

  const handleFindLyrics = async () => {
    const title = formData.title || track.metadata.title || track.file_name;
    if (!title) {
      setLyricsStatus({ type: 'error', text: 'Укажите название трека для поиска' });
      return;
    }

    setIsSearchingLyrics(true);
    setLyricsStatus(null);
    try {
      const res = await invoke<LrcLibLyrics | null>('find_lyrics', {
        title,
        artist: formData.artist || track.metadata.artist || undefined,
        album: formData.album || track.metadata.album || undefined,
        duration: track.properties.duration_seconds || undefined,
      });

      if (res && (res.syncedLyrics || res.plainLyrics)) {
        const foundText = res.syncedLyrics || res.plainLyrics || '';
        const isSynced = Boolean(res.syncedLyrics);
        setFormData((prev) => ({ ...prev, lyrics: foundText }));
        setLyricsStatus({
          type: 'success',
          text: isSynced ? 'Синхронизированный текст LRC найден в LRCLIB!' : 'Текст песни найден в LRCLIB!',
        });
      } else {
        setLyricsStatus({ type: 'info', text: 'Текст не найден в открытой базе LRCLIB' });
      }
    } catch (err) {
      setLyricsStatus({ type: 'error', text: `Ошибка поиска текста: ${err}` });
    } finally {
      setIsSearchingLyrics(false);
    }
  };

  const handleSearchMusicBrainz = async () => {
    const query = formData.title || track.file_name;
    if (!query) return;

    setIsSearchingMb(true);
    try {
      const results = await onSearchMusicBrainz(query);
      setMbResults(results);
      setShowMbDropdown(true);
    } finally {
      setIsSearchingMb(false);
    }
  };

  const applyMbMatch = (match: MusicBrainzRecording) => {
    setFormData((prev) => ({
      ...prev,
      title: match.title || prev.title,
      artist: match.artist || prev.artist,
      album: match.album || prev.album,
      year: match.year || prev.year,
    }));
    setShowMbDropdown(false);
  };

  const handleSearchLierkourOst = async () => {
    const query = (formData.album || formData.title || track.file_name || '').trim();
    setIsSearchingOst(true);
    setOstError(null);
    try {
      const results = await invoke<LierkourOstCandidate[]>('search_lierkour_ost', { query });
      setOstResults(results);
      setShowOstDropdown(true);
      if (results.length === 0) {
        setOstError('Совпадений в Lierkour не найдено');
      }
    } catch (err) {
      setOstResults([]);
      setShowOstDropdown(true);
      setOstError(`${err}`);
    } finally {
      setIsSearchingOst(false);
    }
  };

  const applyOstMatch = (item: LierkourOstCandidate) => {
    if (item.poster_data_uri) {
      setArtworkPreview(item.poster_data_uri);
      setRemoveArtwork(false);
    }
    setFormData((prev) => ({
      ...prev,
      album: `${item.original_title || item.title} OST`,
      artist: prev.artist || item.creator || prev.artist,
      year: item.year || prev.year,
      genre: item.genres || prev.genre || 'Soundtrack',
      new_artwork_base64: item.poster_data_uri || prev.new_artwork_base64,
      remove_artwork: item.poster_data_uri ? false : prev.remove_artwork,
    }));
    setShowOstDropdown(false);
  };

  return (
    <div className="w-84 lg:w-96 bg-[#18191f] border border-[#2b2d37] rounded-lg flex flex-col h-full shadow-lg overflow-hidden">
      {/* Header with Reload and MusicBrainz */}
      <div className="px-4 py-2.5 bg-[#1f2027] border-b border-[#2b2d37] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#9EA2B0] uppercase tracking-wider">
            Свойства трека
          </span>
          <button
            onClick={() => onReload()}
            disabled={isReloading}
            className="p-1 rounded text-[#8E92A2] hover:text-[#39C5BB] hover:bg-[#282a35] transition-colors cursor-pointer"
            title="Перечитать файл с диска (AIMP, Tag&Rename)"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isReloading ? 'animate-spin text-[#39C5BB]' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleFindLyrics}
            disabled={isSearchingLyrics}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-[#272935] hover:bg-[#323544] text-[#E0E2EC] transition-colors border border-[#393c4e] cursor-pointer"
            title="Поиск текста трека в открытой базе LRCLIB"
          >
            {isSearchingLyrics ? <RefreshCw className="w-3 h-3 animate-spin text-[#39C5BB]" /> : <FileText className="w-3 h-3 text-[#39C5BB]" />}
            <span>Текст</span>
          </button>

          <button
            onClick={handleSearchLierkourOst}
            disabled={isSearchingOst}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-[#272935] hover:bg-[#323544] text-[#E0E2EC] transition-colors border border-[#8B0000]/50 cursor-pointer"
            title="Найти фильм или игру в запущенном Lierkour (:8765) для тегов OST и обложки"
          >
            {isSearchingOst ? <RefreshCw className="w-3 h-3 animate-spin text-[#39C5BB]" /> : <Film className="w-3 h-3 text-[#39C5BB]" />}
            <span>OST</span>
          </button>

          <button
            onClick={handleSearchMusicBrainz}
            disabled={isSearchingMb}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded bg-[#272935] hover:bg-[#323544] text-[#39C5BB] transition-colors border border-[#39C5BB]/20 cursor-pointer"
            title="Поиск недостающих метаданных в MusicBrainz"
          >
            {isSearchingMb ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            <span>MusicBrainz</span>
          </button>
        </div>
      </div>

      {/* Lierkour OST match dropdown */}
      {showOstDropdown && (
        <div className="bg-[#21232d] border-b border-[#2b2d37] p-2 max-h-48 overflow-y-auto">
          <div className="flex justify-between items-center text-[11px] text-[#9EA2B0] mb-1 px-1">
            <span>Lierkour OST:</span>
            <button onClick={() => setShowOstDropdown(false)} className="text-[#39C5BB] hover:underline cursor-pointer">
              Закрыть
            </button>
          </div>
          {ostError && <div className="text-[11px] text-[#f87171] px-1 py-1">{ostError}</div>}
          {ostResults.map((m) => (
            <div
              key={m.id}
              onClick={() => applyOstMatch(m)}
              className="p-2 text-xs rounded hover:bg-[#2c2f3d] cursor-pointer border border-transparent hover:border-[#39C5BB]/30 transition-colors"
            >
              <div className="font-semibold text-white">{m.title}</div>
              <div className="text-[#A2A6B7] text-[11px]">
                {m.media_type} · {m.creator || '—'} {m.year ? `(${m.year})` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MusicBrainz match dropdown */}
      {showMbDropdown && mbResults.length > 0 && (
        <div className="bg-[#21232d] border-b border-[#2b2d37] p-2 max-h-48 overflow-y-auto">
          <div className="flex justify-between items-center text-[11px] text-[#9EA2B0] mb-1 px-1">
            <span>Найдено в MusicBrainz:</span>
            <button onClick={() => setShowMbDropdown(false)} className="text-[#39C5BB] hover:underline cursor-pointer">
              Закрыть
            </button>
          </div>
          {mbResults.map((m) => (
            <div
              key={m.id}
              onClick={() => applyMbMatch(m)}
              className="p-2 text-xs rounded hover:bg-[#2c2f3d] cursor-pointer border border-transparent hover:border-[#39C5BB]/30 transition-colors"
            >
              <div className="font-semibold text-white">{m.title}</div>
              <div className="text-[#A2A6B7] text-[11px]">
                {m.artist} — {m.album || 'Без альбома'} {m.year ? `(${m.year})` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {/* Cover Art Box with Drag/Drop and Paste */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOverCover(true);
          }}
          onDragLeave={() => setIsDraggingOverCover(false)}
          onDrop={handleDropCover}
          className={`flex gap-3 items-center p-2.5 bg-[#1e2028] border rounded-md transition-colors ${
            isDraggingOverCover ? 'border-[#39C5BB] bg-[#39C5BB]/10' : 'border-[#2b2d37]'
          }`}
        >
          <div className="w-20 h-20 rounded bg-[#131418] border border-[#2e313d] flex items-center justify-center overflow-hidden shrink-0 relative group">
            {artworkPreview ? (
              <img src={artworkPreview} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-8 h-8 text-[#4a4d5e]" />
            )}
          </div>
          <div className="flex-1 space-y-1.5">
            <span className="text-xs font-medium text-[#C8CBD8] block">Обложка альбома</span>
            <div className="flex flex-wrap gap-1.5">
              <label className="cursor-pointer px-2 py-1 text-xs rounded bg-[#282a35] hover:bg-[#343746] text-[#E0E2EC] border border-[#393c4e] transition-colors">
                Файл...
                <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleArtworkFile} className="hidden" />
              </label>

              <button
                type="button"
                onClick={handlePasteClipboardClick}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[#282a35] hover:bg-[#343746] text-[#39C5BB] border border-[#393c4e] transition-colors cursor-pointer"
                title="Вставить обложку из буфера обмена (или нажмите Ctrl+V)"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Буфер</span>
              </button>

              {artworkPreview && (
                <button
                  type="button"
                  onClick={handleRemoveArtwork}
                  className="p-1 text-xs rounded bg-[#8B0000]/20 hover:bg-[#8B0000]/40 text-[#ff7070] border border-[#8B0000]/40 transition-colors cursor-pointer"
                  title="Удалить обложку"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-[#787c8e]">Файл, перетаскивание или Ctrl+V</p>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9EA2B0]">Название трека (Title)</label>
          <input
            type="text"
            value={formData.title || ''}
            onChange={(e) => handleInputChange('title', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
            placeholder="Название..."
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9EA2B0]">Исполнитель (Artist)</label>
          <input
            type="text"
            value={formData.artist || ''}
            onChange={(e) => handleInputChange('artist', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
            placeholder="Исполнитель..."
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9EA2B0]">Альбом (Album)</label>
          <input
            type="text"
            value={formData.album || ''}
            onChange={(e) => handleInputChange('album', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
            placeholder="Альбом..."
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#9EA2B0]">Год (Year)</label>
            <input
              type="number"
              value={formData.year || ''}
              onChange={(e) => handleInputChange('year', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
              placeholder="2024"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#9EA2B0]">Жанр (Genre)</label>
            <input
              type="text"
              value={formData.genre || ''}
              onChange={(e) => handleInputChange('genre', e.target.value)}
              className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
              placeholder="Electronic..."
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#9EA2B0]">Номер трека</label>
            <input
              type="number"
              value={formData.track_number || ''}
              onChange={(e) => handleInputChange('track_number', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
              placeholder="1"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#9EA2B0]">Всего треков</label>
            <input
              type="number"
              value={formData.track_total || ''}
              onChange={(e) => handleInputChange('track_total', e.target.value ? parseInt(e.target.value) : undefined)}
              className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors"
              placeholder="12"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#9EA2B0]">Комментарий</label>
          <textarea
            rows={2}
            value={formData.comment || ''}
            onChange={(e) => handleInputChange('comment', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-xs text-white outline-none transition-colors resize-none"
            placeholder="Заметки или описание..."
          />
        </div>

        {/* Lyrics Section */}
        <div className="pt-2 border-t border-[#272935] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#39C5BB]" />
              <label className="text-[11px] font-semibold text-[#C8CBD8]">Текст песни (Lyrics)</label>
              {formData.lyrics && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    formData.lyrics.includes('[') && formData.lyrics.includes(']')
                      ? 'bg-[#39C5BB]/15 text-[#39C5BB] border border-[#39C5BB]/30'
                      : 'bg-[#292c3a] text-[#9EA2B0]'
                  }`}
                >
                  {formData.lyrics.includes('[') && formData.lyrics.includes(']') ? 'LRC Synced' : 'Plain'}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleFindLyrics}
              disabled={isSearchingLyrics}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-[#282a36] hover:bg-[#333747] text-[#39C5BB] border border-[#39C5BB]/30 transition-colors cursor-pointer"
              title="Найти текст в LRCLIB"
            >
              {isSearchingLyrics ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              <span>Найти текст</span>
            </button>
          </div>

          {lyricsStatus && (
            <div
              className={`p-2 rounded text-[11px] flex items-center gap-1.5 ${
                lyricsStatus.type === 'success'
                  ? 'bg-[#39C5BB]/10 text-[#39C5BB] border border-[#39C5BB]/20'
                  : lyricsStatus.type === 'error'
                  ? 'bg-[#8B0000]/15 text-[#ff8080] border border-[#8B0000]/30'
                  : 'bg-[#262835] text-[#A6ABB8] border border-[#343747]'
              }`}
            >
              {lyricsStatus.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>{lyricsStatus.text}</span>
            </div>
          )}

          <textarea
            rows={5}
            value={formData.lyrics || ''}
            onChange={(e) => handleInputChange('lyrics', e.target.value)}
            className="w-full px-3 py-1.5 bg-[#14151a] border border-[#2e313d] focus:border-[#39C5BB] rounded text-[11px] font-mono text-white outline-none transition-colors resize-y"
            placeholder="Текст трека или тайминги LRC..."
          />

          <div className="flex items-center justify-between text-[11px]">
            <label className="flex items-center gap-2 text-[#9EA2B0] hover:text-[#E0E2EC] cursor-pointer">
              <input
                type="checkbox"
                checked={saveLrcFile}
                onChange={(e) => setSaveLrcFile(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-[#14151a] border-[#343747] text-[#39C5BB] focus:ring-0 cursor-pointer"
              />
              <span>Сохранять .lrc файл рядом с аудио</span>
            </label>

            {formData.lyrics && (
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, lyrics: '' }))}
                className="text-[10px] text-[#8E92A2] hover:text-[#ff7070] cursor-pointer"
              >
                Очистить текст
              </button>
            )}
          </div>
        </div>

        {/* File details */}
        <div className="pt-2 border-t border-[#272935] text-[11px] text-[#717688] space-y-0.5">
          <div className="truncate">Путь: {track.file_path}</div>
          <div>Битрейт: {track.properties.bitrate_kbps ? `${track.properties.bitrate_kbps} kbps` : '—'}</div>
          <div>Частота: {track.properties.sample_rate_hz ? `${track.properties.sample_rate_hz} Hz` : '—'}</div>
        </div>
      </div>

      {/* Footer Save Button */}
      <div className="p-3 bg-[#1f2027] border-t border-[#2b2d37]">
        <button
          onClick={handleSaveClick}
          disabled={isSaving}
          className="w-full py-2 px-4 rounded font-semibold text-xs text-black bg-[#39C5BB] hover:bg-[#48d8ce] active:bg-[#2fa89f] transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
        >
          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Сохранить изменения (Ctrl+S)</span>
        </button>
      </div>
    </div>
  );
};
