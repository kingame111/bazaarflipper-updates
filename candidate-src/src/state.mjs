export const state = {
  startedAt: Date.now(),
  collectorActive: true,
  flips: [],
  reverseNpcFlips: [],
  lastHypixelUpdate: null,
  lastFetchAt: null,
  lastSuccessfulFetchAt: null,
  lastFetchDurationMs: null,
  lastError: null,
  itemMetadataLastUpdated: null,
  skippedForLowMemory: 0,
  historyWrites: 0,
  dynamicsWrites: 0,
  newSnapshots: 0,
  taxContext: { mayorName: 'Unknown', multiplier: 1, flatAddRate: 0, reason: 'Not checked yet', sourceLastUpdated: null },
  update: { configured: false, updateAvailable: false, error: null },
  dualSync: { lastSyncAt: null, lastSuccessAt: null, lastError: null, peerReachable: null, sentSnapshots: 0, sentRows: 0, receivedSnapshots: 0, receivedRows: 0 }
};
