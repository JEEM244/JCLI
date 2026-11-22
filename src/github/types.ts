export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitHubCompareFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
}

export interface GitHubComparison {
  status: string;
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  files: GitHubCompareFile[];
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  body: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  body: string;
  isPullRequest: boolean;
}

export interface GitHubIssueLink {
  projectId: string;
  taskId: string;
  issueNumber: number;
  issueUrl: string;
  createdAt: string;
}
