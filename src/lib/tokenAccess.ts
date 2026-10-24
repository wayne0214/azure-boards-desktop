/**
 * What a personal access token needs, by feature. Matches the Azure DevOps APIs each feature calls;
 * names are as Azure DevOps shows them under Custom defined scopes.
 */
export interface TokenAccess {
  feature: string
  detail: string
  scopes: string[]
  required?: boolean
}

export const TOKEN_ACCESS: TokenAccess[] = [
  {
    feature: 'Boards and work items',
    detail: 'Boards, My Work, requirements, test cases, mentions and bug reports.',
    scopes: ['Work Items: Read & write', 'Project and Team: Read'],
    required: true,
  },
  {
    feature: 'Pull requests',
    detail: 'Reviewing, voting, commenting, completing, and Start work branches.',
    scopes: ['Code: Read & write'],
  },
  {
    feature: 'Test Plans',
    detail: 'Plans, suites, runs and results. Only if your account has Test Plans access.',
    scopes: ['Test Management: Read & write'],
  },
  {
    feature: 'Versioning setup',
    detail: 'Setting up git-tools on a repository. Usually one person does this, once.',
    scopes: [
      'Code: Read & write',
      'Build: Read & execute',
      'Secure Files: Read, create & manage',
      'Pipeline Resources: Use & manage',
      'Identity: Read',
      'Security: Manage',
    ],
  },
]

/** Features that sign in on their own and need nothing from the token. */
export const TOKEN_NOT_NEEDED = 'Timesheet and Meeting Rooms sign in separately and need nothing from this token.'
