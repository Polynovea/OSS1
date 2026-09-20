export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  timestamp: string;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  author: string;
  status: "draft" | "published" | "in_review" | "approved" | "scheduled" | "archived";
  cover_image?: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContentBlock {
  id: string;
  title: string;
  body: string;
  media: string | null;
}

export interface LiveMetric {
  id: number;
  label: string;
  value: string;
  period: string;
  trend: string;
  trendDirection: "up" | "down";
}

export type SocialPlatform = string;

export type ContentType = "Reel" | "Short" | "Video" | "Post" | "Story" | "Article" | "Ad";

export interface Platform {
  id: string;
  name: string;
  for_social: boolean;
  for_ads: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CheckpointState = "logged" | "due" | "pending" | "future";

export interface CheckpointMetrics {
  views?: number;
  reach?: number;
  watch_time?: string;         // e.g. "2h 10m 27s"
  avg_watch_time?: string;     // e.g. "11s"
  interactions?: number;
  profile_activity?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
  follows?: number;
  skip_rate?: number;          // percentage e.g. 59.0
  followers_pct?: number;      // % of viewers who are followers
  non_followers_pct?: number;
  top_source?: string;         // "Feed" | "Reels tab" | "Stories" | etc.
  impressions?: number;        // YouTube: total thumbnail impressions
  impressions_ctr?: number;    // YouTube: impressions click-through rate (%)
  logged_at?: string;          // ISO timestamp
}

export interface SocialPost {
  id: string;
  entity: "polynovea";
  title: string;
  platform: SocialPlatform;
  type: ContentType;
  posted: string;           // ISO date string
  views?: number;
  status: "published" | "draft" | "active";
  checkpoints: CheckpointState[];
  checkpoint_metrics?: (CheckpointMetrics | null)[];
  created_at: string;
  updated_at: string;
}

export type AdPlatform = string;
export type AdObjective = "Awareness" | "Reach" | "Engagement" | "Conversions";
export type AdStatus = "ACTIVE" | "COMPLETED" | "PAUSED";

export interface AdCampaign {
  id: string;
  entity: "polynovea" | "venue" | string;
  venue_id?: string;   // present for venue-specific campaigns
  campaign: string;
  platform: AdPlatform;
  objective: AdObjective | string;
  budget: number;
  spend: number;
  ctr: number;
  conversions: number;
  status: AdStatus;
  created_at: string;
  updated_at: string;
}


export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export type AdminRole = "master" | "admin" | "editor" | "viewer";

export interface AdminUser {
  id: string;
  auth_user_id?: string | null;
  username: string;
  email: string;
  display_name?: string | null;
  role: AdminRole;
  is_active: boolean;
  surface_access: string[];
  module_access: string[];
  module_write_access: string[];
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminActivityLog {
  id: string;
  actor_email: string;
  actor_username?: string | null;
  actor_role?: string | null;
  action: string;
  target_type: string;
  target_id?: string | null;
  target_label?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}
