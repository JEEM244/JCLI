export type PatchStatus = "draft" | "approved" | "rejected" | "applied" | "rolled_back";

export interface FilePatch {
  id: string;
  projectId: string;
  targetPath: string;
  candidatePath: string;
  originalHash: string;
  proposedHash: string;
  originalContent: string;
  proposedContent: string;
  status: PatchStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  appliedAt?: string;
  rolledBackAt?: string;
  backupPath?: string;
  appliedHash?: string;
}
