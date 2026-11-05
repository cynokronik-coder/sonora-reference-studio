import type { AnalysisReport } from '../audio/analysis/analyze';
import type { PresetDefinition } from '../audio/presets/library';
import type { AudioAssetMeta, ExportRecord, ProjectState, ProjectSummary } from '../audio/model/types';

const DB_NAME = 'sonora-reference-studio';
const DB_VERSION = 1;

interface StoredAsset {
  meta: AudioAssetMeta;
  blob: Blob;
}

interface StoredExport {
  record: ExportRecord;
  blob: Blob;
}

interface Store {
  listProjects(): Promise<ProjectSummary[]>;
  saveProject(project: ProjectState): Promise<void>;
  getProject(id: string): Promise<ProjectState | null>;
  deleteProject(id: string): Promise<void>;
  saveAsset(meta: AudioAssetMeta, blob: Blob): Promise<void>;
  listAssets(projectId: string): Promise<AudioAssetMeta[]>;
  getAssetBlob(assetId: string): Promise<Blob | null>;
  deleteAsset(assetId: string): Promise<void>;
  saveAnalysis(assetId: string, report: AnalysisReport): Promise<void>;
  loadAnalyses(assetIds: string[]): Promise<Record<string, AnalysisReport>>;
  savePreset(preset: PresetDefinition): Promise<void>;
  listUserPresets(): Promise<PresetDefinition[]>;
  deletePreset(id: string): Promise<void>;
  saveExport(record: ExportRecord, blob: Blob): Promise<void>;
  listExports(projectId: string): Promise<ExportRecord[]>;
  getExportBlob(exportId: string): Promise<Blob | null>;
  deleteExport(exportId: string): Promise<void>;
  clearAllData(): Promise<void>;
}

export interface StorageStatus {
  persistent: boolean;
  reason: string | null;
}

let status: StorageStatus = { persistent: true, reason: null };
let storePromise: Promise<Store> | null = null;

function summarizeProject(project: ProjectState): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    folder: project.folder,
    trackCount: project.tracks.length,
    hasReference: project.referenceAssetIds.length > 0,
  };
}

/** Whether the app is running on durable IndexedDB or a session-only fallback. */
export function storageStatus(): StorageStatus {
  return status;
}

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = openIdbStore().then(
      (store) => store,
      (error: unknown) => {
        status = {
          persistent: false,
          reason: error instanceof Error ? error.message : String(error),
        };
        console.warn('Sonora is falling back to session-only storage:', status.reason);
        return createMemoryStore();
      },
    );
  }
  return storePromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function openIdbStore(): Promise<Store> {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    throw new Error('IndexedDB is unavailable in this browser context.');
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const opened = request.result;
      if (!opened.objectStoreNames.contains('projects')) opened.createObjectStore('projects', { keyPath: 'id' });
      if (!opened.objectStoreNames.contains('assets')) {
        const store = opened.createObjectStore('assets', { keyPath: 'meta.id' });
        store.createIndex('projectId', 'meta.projectId', { unique: false });
      }
      if (!opened.objectStoreNames.contains('analyses')) opened.createObjectStore('analyses', { keyPath: 'assetId' });
      if (!opened.objectStoreNames.contains('presets')) opened.createObjectStore('presets', { keyPath: 'id' });
      if (!opened.objectStoreNames.contains('exports')) {
        const store = opened.createObjectStore('exports', { keyPath: 'record.id' });
        store.createIndex('projectId', 'record.projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB open was blocked by another tab.'));
  });

  const transaction = <T>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T> => {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
      Promise.resolve(fn(tx))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          try {
            tx.abort();
          } catch {
            /* already aborted */
          }
          reject(error);
        });
    });
  };

  return {
    async listProjects() {
      const tx = db.transaction('projects', 'readonly');
      const projects = (await requestToPromise(tx.objectStore('projects').getAll())) as ProjectState[];
      return projects.map(summarizeProject).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async saveProject(project) {
      await transaction('projects', 'readwrite', (tx) => {
        tx.objectStore('projects').put(project);
      });
    },
    async getProject(id) {
      const tx = db.transaction('projects', 'readonly');
      const project = await requestToPromise(tx.objectStore('projects').get(id));
      return (project as ProjectState) ?? null;
    },
    async deleteProject(id) {
      const tx = db.transaction(['projects', 'assets', 'exports'], 'readwrite');
      tx.objectStore('projects').delete(id);
      const assetStore = tx.objectStore('assets');
      const assets = (await requestToPromise(assetStore.index('projectId').getAll(id))) as StoredAsset[];
      for (const asset of assets) assetStore.delete(asset.meta.id);
      const exportStore = tx.objectStore('exports');
      const exports = (await requestToPromise(exportStore.index('projectId').getAll(id))) as StoredExport[];
      for (const record of exports) exportStore.delete(record.record.id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async saveAsset(meta, blob) {
      await transaction('assets', 'readwrite', (tx) => {
        tx.objectStore('assets').put({ meta, blob } satisfies StoredAsset);
      });
    },
    async listAssets(projectId) {
      const tx = db.transaction('assets', 'readonly');
      const records = (await requestToPromise(tx.objectStore('assets').index('projectId').getAll(projectId))) as StoredAsset[];
      return records.map((record) => record.meta);
    },
    async getAssetBlob(assetId) {
      const tx = db.transaction('assets', 'readonly');
      const record = (await requestToPromise(tx.objectStore('assets').get(assetId))) as StoredAsset | undefined;
      return record?.blob ?? null;
    },
    async deleteAsset(assetId) {
      await transaction('assets', 'readwrite', (tx) => {
        tx.objectStore('assets').delete(assetId);
      });
    },
    async saveAnalysis(assetId, report) {
      await transaction('analyses', 'readwrite', (tx) => {
        tx.objectStore('analyses').put({ assetId, report });
      });
    },
    async loadAnalyses(assetIds) {
      const tx = db.transaction('analyses', 'readonly');
      const store = tx.objectStore('analyses');
      const out: Record<string, AnalysisReport> = {};
      for (const id of assetIds) {
        const record = (await requestToPromise(store.get(id))) as { assetId: string; report: AnalysisReport } | undefined;
        if (record) out[id] = record.report;
      }
      return out;
    },
    async savePreset(preset) {
      await transaction('presets', 'readwrite', (tx) => {
        tx.objectStore('presets').put(preset);
      });
    },
    async listUserPresets() {
      const tx = db.transaction('presets', 'readonly');
      return (await requestToPromise(tx.objectStore('presets').getAll())) as PresetDefinition[];
    },
    async deletePreset(id) {
      await transaction('presets', 'readwrite', (tx) => {
        tx.objectStore('presets').delete(id);
      });
    },
    async saveExport(record, blob) {
      await transaction('exports', 'readwrite', (tx) => {
        tx.objectStore('exports').put({ record, blob } satisfies StoredExport);
      });
    },
    async listExports(projectId) {
      const tx = db.transaction('exports', 'readonly');
      const records = (await requestToPromise(tx.objectStore('exports').index('projectId').getAll(projectId))) as StoredExport[];
      return records.map((record) => record.record).sort((a, b) => b.createdAt - a.createdAt);
    },
    async getExportBlob(exportId) {
      const tx = db.transaction('exports', 'readonly');
      const record = (await requestToPromise(tx.objectStore('exports').get(exportId))) as StoredExport | undefined;
      return record?.blob ?? null;
    },
    async deleteExport(exportId) {
      await transaction('exports', 'readwrite', (tx) => {
        tx.objectStore('exports').delete(exportId);
      });
    },
    async clearAllData() {
      const names = ['projects', 'assets', 'analyses', 'presets', 'exports'];
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) tx.objectStore(name).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

function createMemoryStore(): Store {
  const projects = new Map<string, ProjectState>();
  const assets = new Map<string, StoredAsset>();
  const analyses = new Map<string, AnalysisReport>();
  const presets = new Map<string, PresetDefinition>();
  const exports = new Map<string, StoredExport>();

  return {
    async listProjects() {
      return [...projects.values()].map(summarizeProject).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async saveProject(project) {
      projects.set(project.id, structuredClone(project));
    },
    async getProject(id) {
      const project = projects.get(id);
      return project ? structuredClone(project) : null;
    },
    async deleteProject(id) {
      projects.delete(id);
      for (const [key, asset] of assets) if (asset.meta.projectId === id) assets.delete(key);
      for (const [key, record] of exports) if (record.record.projectId === id) exports.delete(key);
    },
    async saveAsset(meta, blob) {
      assets.set(meta.id, { meta: structuredClone(meta), blob });
    },
    async listAssets(projectId) {
      return [...assets.values()]
        .filter((asset) => asset.meta.projectId === projectId)
        .map((asset) => structuredClone(asset.meta));
    },
    async getAssetBlob(assetId) {
      return assets.get(assetId)?.blob ?? null;
    },
    async deleteAsset(assetId) {
      assets.delete(assetId);
    },
    async saveAnalysis(assetId, report) {
      analyses.set(assetId, structuredClone(report));
    },
    async loadAnalyses(assetIds) {
      const out: Record<string, AnalysisReport> = {};
      for (const id of assetIds) {
        const report = analyses.get(id);
        if (report) out[id] = structuredClone(report);
      }
      return out;
    },
    async savePreset(preset) {
      presets.set(preset.id, structuredClone(preset));
    },
    async listUserPresets() {
      return [...presets.values()].map((preset) => structuredClone(preset));
    },
    async deletePreset(id) {
      presets.delete(id);
    },
    async saveExport(record, blob) {
      exports.set(record.id, { record: structuredClone(record), blob });
    },
    async listExports(projectId) {
      return [...exports.values()]
        .filter((entry) => entry.record.projectId === projectId)
        .map((entry) => structuredClone(entry.record))
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    async getExportBlob(exportId) {
      return exports.get(exportId)?.blob ?? null;
    },
    async deleteExport(exportId) {
      exports.delete(exportId);
    },
    async clearAllData() {
      projects.clear();
      assets.clear();
      analyses.clear();
      presets.clear();
      exports.clear();
    },
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return (await getStore()).listProjects();
}

export async function saveProject(project: ProjectState): Promise<void> {
  return (await getStore()).saveProject(project);
}

export async function getProject(id: string): Promise<ProjectState | null> {
  return (await getStore()).getProject(id);
}

export async function deleteProject(id: string): Promise<void> {
  return (await getStore()).deleteProject(id);
}

export async function duplicateProject(project: ProjectState, newId: string): Promise<ProjectState> {
  const copy = structuredClone(project);
  copy.id = newId;
  copy.name = `${project.name} copy`;
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  await saveProject(copy);
  return copy;
}

export async function saveAsset(meta: AudioAssetMeta, blob: Blob): Promise<void> {
  return (await getStore()).saveAsset(meta, blob);
}

export async function listAssets(projectId: string): Promise<AudioAssetMeta[]> {
  return (await getStore()).listAssets(projectId);
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  return (await getStore()).getAssetBlob(assetId);
}

export async function deleteAsset(assetId: string): Promise<void> {
  return (await getStore()).deleteAsset(assetId);
}

export async function saveAnalysis(assetId: string, report: AnalysisReport): Promise<void> {
  return (await getStore()).saveAnalysis(assetId, report);
}

export async function loadAnalyses(projectAssetIds: string[]): Promise<Record<string, AnalysisReport>> {
  return (await getStore()).loadAnalyses(projectAssetIds);
}

export async function savePreset(preset: PresetDefinition): Promise<void> {
  return (await getStore()).savePreset(preset);
}

export async function listUserPresets(): Promise<PresetDefinition[]> {
  return (await getStore()).listUserPresets();
}

export async function deletePreset(id: string): Promise<void> {
  return (await getStore()).deletePreset(id);
}

export async function saveExport(record: ExportRecord, blob: Blob): Promise<void> {
  return (await getStore()).saveExport(record, blob);
}

export async function listExports(projectId: string): Promise<ExportRecord[]> {
  return (await getStore()).listExports(projectId);
}

export async function getExportBlob(exportId: string): Promise<Blob | null> {
  return (await getStore()).getExportBlob(exportId);
}

export async function deleteExport(exportId: string): Promise<void> {
  return (await getStore()).deleteExport(exportId);
}

export async function clearAllData(): Promise<void> {
  return (await getStore()).clearAllData();
}
