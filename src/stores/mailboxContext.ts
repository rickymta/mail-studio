import { createContext, useContext } from 'react';
import { useMail, type createMailbox } from './mail';
export type Mailbox = ReturnType<typeof createMailbox>;
export const MailboxContext = createContext<Mailbox>(useMail);
export const useMailboxStore = () => useContext(MailboxContext);
