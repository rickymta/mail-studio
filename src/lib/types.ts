export interface AppError {
  kind: string;
  message: string;
}

export type Security = 'tls' | 'starttls' | 'none';

export interface Account {
  id: number;
  email: string;
  name: string;
  provider: string;
  color: string;
  /** Plain text appended to new messages. */
  signature: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  username: string;
  auth: 'password' | 'oauth';
  oauthProvider: string;
  position: number;
  lastSync: number | null;
  lastError: string | null;
}

export interface Provider {
  id: string;
  name: string;
  domains: string[];
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  /** `google` / `microsoft` when OAuth sign-in exists, else empty. */
  oauth: string;
  /** No password works over IMAP / SMTP any more: OAuth is the only sign-in. */
  oauthOnly: boolean;
  passwordIsAppPassword: boolean;
  helpUrl: string;
  savesSent: boolean;
}

export type Role =
  'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'important' | '';

export interface Folder {
  id: number;
  accountId: number;
  path: string;
  name: string;
  delimiter: string;
  role: Role;
  selectable: boolean;
  total: number;
  unread: number;
}

export interface Addr {
  name: string;
  email: string;
}

export interface Summary {
  id: number;
  accountId: number;
  folderId: number;
  folderRole: Role;
  uid: number;
  subject: string;
  from: Addr;
  to: Addr[];
  date: number;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  snippet: string;
}

export interface AttachmentInfo {
  index: number;
  name: string;
  mime: string;
  size: number;
  inline: boolean;
}

export interface Detail extends Summary {
  cc: Addr[];
  bcc: Addr[];
  replyTo: Addr[];
  messageId: string;
  references: string;
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
  hasRemoteImages: boolean;
}

export interface Page {
  items: Summary[];
  total: number;
}

export type Scope = 'folder' | 'inbox' | 'unread' | 'flagged' | 'all';

export interface ListQuery {
  scope: Scope;
  folderId?: number;
  accountId?: number;
  unread?: boolean;
  flagged?: boolean;
  attachments?: boolean;
  query?: string;
  limit?: number;
  offset?: number;
}

export type DraftAttachment =
  | { kind: 'file'; path: string; name: string; size: number }
  | { kind: 'message'; messageId: number; index: number; name: string; size: number };

export interface Draft {
  id: number;
  accountId: number;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  /** What the user wrote (HTML). */
  html: string;
  /** The quoted original, appended when sending. */
  quote: string;
  attachments: DraftAttachment[];
  inReplyTo: string;
  references: string;
  replyToMessage: number | null;
  updatedAt: number;
}

export interface MailEvent {
  seq: number;
  kind: 'sync' | 'folders' | 'messages' | 'newMail' | 'accounts' | 'drafts';
  data: Record<string, unknown>;
}
