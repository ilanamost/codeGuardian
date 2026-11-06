// Settings Account and Security constants (UI texts and limits, not data). The profile comes
// from account.service (GET /api/account).

// Same limits as PasswordChange in .orchestrate/api-contract.yaml.
export const PASSWORD_LIMIT = { min: 8, max: 200 } as const

// Field names the server uses in `details.issue[].field` for PUT /api/account/password.
export const PASSWORD_FIELD = {
  current: 'currentPassword',
  new: 'newPassword'
} as const

// Registration limits (contract 0.8.0, Registration), the same as the server's.
export const USERNAME_LIMIT = { min: 3, max: 32 } as const
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/
export const EMAIL_LIMIT = { max: 254 } as const
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Contract 0.13.0 (AccountUpdate, also Registration): an email never holds a control or line
// separator character (U+0000-U+001F, U+007F, U+0085, U+2028, U+2029).
// eslint-disable-next-line no-control-regex
export const EMAIL_FORBIDDEN_PATTERN = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/

// Field names the server uses in `details.issue[].field` for PUT /api/account (plan 034).
export const ACCOUNT_FIELD = {
  username: 'username',
  email: 'email',
  currentPassword: 'currentPassword'
} as const

// Sign-in limits (contract 0.8.0, SignIn).
export const SIGN_IN_LIMIT = { usernameMax: 64, passwordMax: 200 } as const

// The profile photo (plan 028, Scope 17): the types the server accepts (checked on the file's
// magic bytes, never its name or MIME type) and the size limit.
export const AVATAR_LIMIT = { maxByte: 2 * 1024 * 1024 } as const
export const AVATAR_TYPE_LIST = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AvatarType = (typeof AVATAR_TYPE_LIST)[number]

export const ACCOUNT_TEXT = {
  heading: 'Account',
  profileImage: 'Profile image',
  username: 'User name',
  email: 'Email address',
  memberSince: 'Member since',
  loading: 'Loading account...',
  uploadPhoto: 'Upload photo',
  changePhoto: 'Change photo',
  removePhoto: 'Remove photo',
  savePhoto: 'Save photo',
  savingPhoto: 'Saving...',
  cancelPhoto: 'Cancel',
  photoPreview: 'New profile photo preview',
  photoHint: 'PNG, JPEG or WebP, at most 2 MB.',
  photoUpdated: 'Photo updated',
  photoRemoved: 'Photo removed',
  // Plan 034: editing the user name and email (the current password is required to save).
  editDetails: 'Edit',
  editDetailsLabel: 'Edit user name and email',
  editHeading: 'Edit account details',
  currentPassword: 'Current password',
  currentPasswordHint: 'Enter your current password to save these changes.',
  saveDetails: 'Save',
  savingDetails: 'Saving...',
  cancelDetails: 'Cancel',
  detailsUpdated: 'Account updated',
  // Plan 040: GitHub sign-in in Settings > Account.
  githubHeading: 'GitHub sign-in',
  githubNotConnected: 'Not connected',
  githubConnectedAs: (login: string) => `Connected as @${login}`,
  githubLink: 'Link GitHub',
  githubLinking: 'Redirecting...',
  githubUnlink: 'Unlink GitHub',
  githubUnlinking: 'Unlinking...',
  githubUnlinked: 'GitHub sign-in removed',
  githubOnlyHint: 'GitHub is your only way to sign in, so it cannot be removed.',
  // A GitHub-only account has no password to confirm an edit with.
  githubNoEdit: 'Your user name and email come from GitHub.',
  // The sidebar profile link to Settings > Account.
  profileLink: (name: string) => `Open account settings for ${name}`
} as const

export const SECURITY_TEXT = {
  heading: 'Security',
  currentPassword: 'Current password',
  newPassword: 'New password',
  confirmPassword: 'Confirm password',
  updatePassword: 'Update password',
  savePassword: 'Save password',
  savingPassword: 'Saving...',
  cancel: 'Cancel',
  signOut: 'Sign Out',
  signingOut: 'Signing out...',
  passwordUpdated: 'Password updated',
  signedOut: 'Signed out',
  // The sign-out confirmation dialog.
  signOutTitle: 'Sign out?',
  signOutDetail: 'You will need to sign in again to use the app.',
  signOutConfirm: 'Sign out',
  // Plan 040: an account that signs in with GitHub has no password.
  githubOnly: 'You sign in with GitHub, so this account has no password to change.'
} as const
