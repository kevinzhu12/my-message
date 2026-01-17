export interface Chat {
  id: number;
  display_name: string;
  last_message_text: string | null;
  last_message_time: number | null;
  last_message_is_from_me: boolean | null;
  is_group: boolean;
  handles: string[];
  chat_identifier: string | null;
}

export interface ChatsResponse {
  chats: Chat[];
  total: number;
  has_more: boolean;
}

export interface SearchChatsResponse {
  chats: Chat[];
  query: string;
}

export interface ChatsByIdsResponse {
  chats: Chat[];
}

export interface Reaction {
  emoji: string;
  is_from_me: boolean;
}

export interface Attachment {
  id: number;
  filename: string | null;
  mime_type: string | null;
  transfer_name: string | null;
  total_bytes: number;
}

export interface Message {
  id: number;
  guid?: string;
  text: string | null;
  time: number;
  is_from_me: boolean;
  handle: string | null;
  contact_name: string | null;
  reactions: Reaction[];
  attachments: Attachment[];
}

export interface MessagesResponse {
  messages: Message[];
  total: number;
  has_more: boolean;
}

export interface DraftResponse {
  draft_text: string;
}

export interface SendResponse {
  ok: boolean;
  error?: string;
}

export interface BasicInfo {
  birthday?: string | null;
  hometown?: string | null;
  work?: string | null;
  school?: string | null;
}

export interface ContactContext {
  handle: string;
  display_name?: string | null;
  basic_info: BasicInfo;
  notes?: string | null;
  last_analyzed_at?: number | null;
  last_analyzed_message_id?: number | null;
  created_at: number;
  updated_at: number;
}

export type SuggestionActionType = "send" | "call" | "facetime" | "switch_chat";

export interface SuggestionAction {
  action: SuggestionActionType;
  chat_search_term?: string | null;
}


export interface AssistHistoryEntry {
  prompt: string;
  reply: string;
}
