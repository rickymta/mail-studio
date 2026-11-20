import { t } from '@/lib/i18n';

/** What a user must register with each OAuth provider before browser sign-in works. */
export const OAUTH = [
  {
    id: 'google',
    name: 'Google',
    console: 'https://console.cloud.google.com/apis/credentials',
    // Google's token endpoint rejects a "Desktop app" client without its secret, PKCE or not.
    needsSecret: true,
    steps: () =>
      t(
        'In Google Cloud Console create an OAuth client of type “Desktop app”, enable the Gmail API, and paste its client ID and secret here.',
      ),
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    console: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    needsSecret: false,
    steps: () =>
      t(
        'In Microsoft Entra register an app with the “Mobile and desktop applications” platform and the redirect URI http://localhost, add the IMAP.AccessAsUser.All and SMTP.Send permissions, and paste its application (client) ID here. No secret is needed.',
      ),
  },
];
