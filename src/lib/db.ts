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

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) {
        const store = db.createObjectStore('assets', { keyPath: 'meta.id' });
        store.createIndex('projectId', 'meta.projectId', { unique: false });
      }
      if (!db.objectStoreNames.contains('analyses')) db.createObjectStore('analyses', { keyPath: 'assetId' });
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('exports')) {
        const store = db.createObjectStore('exports', { keyPath: 'record.id' });
        store.createIndex('projectId', 'record.projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
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
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readonly');
  const store = tx.objectStore('projects');
  const projects = (await requestToPromise(store.getAll())) as ProjectState[];
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      folder: project.folder,
      trackCount: project.tracks.length,
      hasReference: project.referenceAssetIds.length > 0,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(project: ProjectState): Promise<void> {
  await transaction('projects', 'readwrite', (tx) => {
    tx.objectStore('projects').put(project);
  });
}

export async function getProject(id: string): Promise<ProjectState | null> {
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readonly');
  const project = await requestToPromise(tx.objectStore('projects').get(id));
  return (project as ProjectState) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'assets', 'exports'], 'readwrite');
  tx.objectStore('projects').delete(id);
  const assetStore = tx.objectStore('assets');
  const index = assetStore.index('projectId');
  const assets = (await requestToPromise(index.getAll(id))) as StoredAsset[];
  for (const asset of assets) assetStore.delete(asset.meta.id);
  const exportStore = tx.objectStore('exports');
  const exportIndex = exportStore.index('projectId');
  const exports = (await requestToPromise(exportIndex.getAll(id))) as StoredExport[];
  for (const record of exports) exportStore.delete(record.record.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
  await transaction('assets', 'readwrite', (tx) => {
    tx.objectStore('assets').put({ meta, blob } satisfies StoredAsset);
  });
}

export async function listAssets(projectId: string): Promise<AudioAssetMeta[]> {
  const db = await openDatabase();
  const tx = db.transaction('assets', 'readonly');
  const index = tx.objectStore('assets').index('projectId');
  const records = (await requestToPromise(index.getAll(projectId))) as StoredAsset[];
  return records.map((r) => r.meta);
}

export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  const db = await openDatabase();
  const tx = db.transaction('assets', 'readonly');
  const record = (await requestToPromise(tx.objectStore('assets').get(assetId))) as StoredAsset | undefined;
  return record?.blob ?? null;
}

export async function deleteAsset(assetId: string): Promise<void> {
  await transaction('assets', 'readwrite', (tx) => {
    tx.objectStore('assets').delete(assetId);
  });
}

export async function saveAnalysis(assetId: string, report: AnalysisReport): Promise<void> {
  await transaction('analyses', 'readwrite', (tx) => {
    tx.objectStore('analyses').put({ assetId, report });
  });
}

export async function loadAnalyses(projectAssetIds: string[]): Promise<Record<string, AnalysisReport>> {
  const db = await openDatabase();
  const tx = db.transaction('analyses', 'readonly');
  const store = tx.objectStore('analyses');
  const out: Record<string, AnalysisReport> = {};
  for (const id of projectAssetIds) {
    const record = (await requestToPromise(store.get(id))) as { assetId: string; report: AnalysisReport } | undefined;
    if (record) out[id] = record.report;
  }
  return out;
}

export async function savePreset(preset: PresetDefinition): Promise<void> {
  await transaction('presets', 'readwrite', (tx) => {
    tx.objectStore('presets').put(preset);
  });
}

export async function listUserPresets(): Promise<PresetDefinition[]> {
  const db = await openDatabase();
  const tx = db.transaction('presets', 'readonly');
  const presets = (await requestToPromise(tx.objectStore('presets').getAll())) as PresetDefinition[];
  return presets;
}

export async function deletePreset(id: string): Promise<void> {
  await transaction('presets', 'readwrite', (tx) => {
    tx.objectStore('presets').delete(id);
  });
}

export async function saveExport(record: ExportRecord, blob: Blob): Promise<void> {
  await transaction('exports', 'readwrite', (tx) => {
    tx.objectStore('exports').put({ record, blob } satisfies StoredExport);
  });
}

export async function listExports(projectId: string): Promise<ExportRecord[]> {
  const db = await openDatabase();
  const tx = db.transaction('exports', 'readonly');
  const index = tx.objectStore('exports').index('projectId');
  const records = (await requestToPromise(index.getAll(projectId))) as StoredExport[];
  return records.map((r) => r.record).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getExportBlob(exportId: string): Promise<Blob | null> {
  const db = await openDatabase();
  const tx = db.transaction('exports', 'readonly');
  const record = (await requestToPromise(tx.objectStore('exports').get(exportId))) as StoredExport | undefined;
  return record?.blob ?? null;
}

export async function deleteExport(exportId: string): Promise<void> {
  await transaction('exports', 'readwrite', (tx) => {
    tx.objectStore('exports').delete(exportId);
  });
}

export async function clearAllData(): Promise<void> {
  const db = await openDatabase();
  const names = ['projects', 'assets', 'analyses', 'presets', 'exports'];
  const tx = db.transaction(names, 'readwrite');
  for (const name of names) tx.objectStore(name).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
