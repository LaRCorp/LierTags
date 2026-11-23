export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  track_number?: number;
  track_total?: number;
  comment?: string;
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

export interface DropResult {
  mode: 'folder' | 'files' | 'empty';
  folder_path?: string;
  tracks: Track[];
}
