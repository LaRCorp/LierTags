export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  track_number?: number;
  track_total?: number;
  comment?: string;
  lyrics?: string;
  is_synced_lyrics?: boolean;
  has_artwork: boolean;
  artwork_mime?: string;
  artwork_base64?: string;
}

export interface AudioProperties {
  duration_seconds: number;
  bitrate_kbps?: number;
  sample_rate_hz?: number;
  channels?: number;
}

export interface Track {
  id: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  extension: string;
  metadata: TrackMetadata;
  properties: AudioProperties;
  dirty?: boolean;
}

export interface ImportPayload {
  type: string;
  title: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  artwork_url?: string;
  source_url?: string;
  track_number?: number;
  comment?: string;
}

export interface SaveTrackPayload {
  file_path: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  track_number?: number;
  track_total?: number;
  comment?: string;
  lyrics?: string;
  save_lrc_file?: boolean;
  new_artwork_base64?: string;
  remove_artwork: boolean;
}

export interface MusicBrainzRecording {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  release_id?: string;
  year?: number;
}

export interface LrcLibLyrics {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

export interface OrganizePreviewItem {
  original_path: string;
  file_name: string;
  destination_path: string;
  relative_destination: string;
  status: 'ready' | 'identical' | 'missing_tags' | 'target_exists' | string;
  will_move: boolean;
}

export interface OrganizeAction {
  original_path: string;
  destination_path: string;
}

export interface OrganizeSummary {
  moved_count: number;
  skipped_count: number;
  error_count: number;
  logs: string[];
}

export type DuplicateMode = 'metadata' | 'hash' | 'size_duration';

export interface DuplicateFileItem {
  track_id: string;
  file_path: string;
  file_name: string;
  file_size_bytes: number;
  bitrate_kbps?: number;
  extension: string;
  duration_seconds: number;
}

export interface DuplicateGroup {
  group_id: string;
  title: string;
  artist?: string;
  match_reason: string;
  files: DuplicateFileItem[];
}

export interface DeleteSummary {
  deleted_count: number;
  failed_count: number;
  logs: string[];
}

export interface DropResult {
  mode: 'folder' | 'files' | 'empty';
  folder_path?: string;
  tracks: Track[];
}

export interface PagedTracksResult {
  tracks: Track[];
  total: number;
  offset: number;
  limit: number;
}
