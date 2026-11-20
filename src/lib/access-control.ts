export function canAcknowledgeInstallation(
  actorId: string,
  assignedEngineerId: string | null,
  canSupervise: boolean
): boolean {
  return canSupervise || (actorId.length > 0 && assignedEngineerId === actorId);
}
