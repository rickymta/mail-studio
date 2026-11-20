import { createContext, useContext } from 'react';
import { useMail, type createMailbox } from './mail';
export type Mailbox = ReturnType<typeof createMailbox>;
export const MailboxContext = createContext<Mailbox>(useMail);
export const useMailboxStore = () => useContext(MailboxContext);
let focused: { store: Mailbox; search: React.RefObject<HTMLInputElement | null> } | null = null;
export function focusMailbox(store: Mailbox, search: React.RefObject<HTMLInputElement | null>) {
  focused = { store, search };
}
export function releaseMailbox(store: Mailbox) {
  if (focused?.store === store) focused = null;
}
export const focusedMailbox = () => focused;
