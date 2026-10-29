// Paste the Client ID of your GitHub OAuth App here (see README.md, step 1).
// Device Flow must be enabled on that OAuth App. No client secret is needed.
export const GITHUB_CLIENT_ID = 'YOUR_GITHUB_OAUTH_CLIENT_ID';

// The ONLY scope ever requested. public_repo cannot read private repositories.
export const OAUTH_SCOPE = 'public_repo';
