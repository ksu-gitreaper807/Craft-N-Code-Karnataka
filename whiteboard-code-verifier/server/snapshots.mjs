import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractProgram, isOverlay } from '../src/board.js';
import { handwritingChannels, inkFingerprint } from '../src/handwriting.js';
import { snapshotBundle } from './snapshot-bundle.mjs';
import { createSnapshotSync } from './snapshot-sync.mjs';
import { libraries } from '../src/libraries.js';
import { validLanguage, languageInfo } from '../src/languages.js';

const execute = promisify(execFile);
const APP = fileURLToPath(new URL('../', import.meta.url));
export const SNAPSHOT_BODY_LIMIT = 4 * 1024 * 1024;
export const SNAPSHOT_ID = /^\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}-[a-z0-9-]{1,60}-[a-f0-9]{8}$/;
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const HISTORICAL_HEADERS = new Set([...libraries.map((library) => library.file), 'board_contract.h']);

function snapshotProgram(scene) {
  if (scene?.type !== 'excalidraw' || !Array.isArray(scene.elements) || scene.elements.length > 2000 ||
      Buffer.byteLength(JSON.stringify(scene)) > 2_000_000) throw invalid('Choose a board with at most 2,000 elements and 2 MB of scene data.');
  const validElements = scene.elements.every((el) => el && typeof el.id === 'string' && el.id &&
    typeof el.type === 'string' && ['x', 'y', 'width', 'height'].every((name) => Number.isFinite(el[name])) &&
    (el.strokeColor == null || typeof el.strokeColor === 'string') &&
    (el.type !== 'text' || (typeof el.text === 'string' && Number.isFinite(el.fontSize) && el.fontSize > 0)));
  if (!validElements || new Set(scene.elements.map((el) => el.id)).size !== scene.elements.length) throw invalid('The board contains invalid elements.');
  const frameId = scene.verifier?.frameId;
  if (!validLanguage(scene.verifier?.language)) throw invalid('Choose C++ or Python.');
  const language = scene.verifier?.language ?? 'c';
  if (!scene.elements.some((el) => el.id === frameId && el.type === 'frame' && !el.isDeleted)) throw invalid('Select a program frame before saving a snapshot.');
  const channels = handwritingChannels(scene.elements, frameId);
  let program;
  if (channels.code || channels.stdin) {
    const ocr = scene.verifier.ocr;
    if (!ocr || (ocr.language ?? 'c') !== language || ocr.frameId !== frameId || ocr.fingerprint !== inkFingerprint(scene.elements, frameId) ||
        typeof ocr.confirmedAt !== 'string' || !Number.isFinite(Date.parse(ocr.confirmedAt)) ||
        !Array.isArray(ocr.reviewed?.code) || !Array.isArray(ocr.reviewed?.stdin) ||
        ![...ocr.reviewed.code, ...ocr.reviewed.stdin].every((line) => typeof line === 'string') ||
        ocr.reviewed.code.join('\n') !== ocr.program?.source || ocr.reviewed.stdin.join('\n') !== ocr.program?.stdin) {
      throw invalid('Review and confirm the current handwriting before saving a snapshot.');
    }
    program = ocr.program;
  } else program = extractProgram(scene.elements, frameId);
  const execution = scene.verifier.execution;
  if (execution != null) {
    if (!execution || execution.language !== language || ![1, 2, 3].includes(execution.level) ||
        !['run', 'case'].includes(execution.kind) || !execution.result ||
        !['success', 'compile_error', 'runtime_error', 'timeout', 'output_limit', 'invalid_source', 'runner_error'].includes(execution.result.status)) {
      throw invalid('Snapshot execution metadata is invalid.');
    }
    // The complete board remains unchanged. Replay uses the actual submitted
    // source/input, which can differ after editor edits, templates, or Gemini.
    program = { ...program, source: execution.source, stdin: execution.stdin };
  }
  if (typeof program.source !== 'string' || !program.source.trim() || program.source.includes('\0') || Buffer.byteLength(program.source) > 32_768 ||
      typeof program.stdin !== 'string' || program.stdin.includes('\0') || Buffer.byteLength(program.stdin) > 8192) {
    throw invalid('Snapshot source must be nonempty and at most 32 KiB; input must be at most 8 KiB, without NUL characters.');
  }
  return { ...program, language };
}

export async function prepareSnapshot(body, now = new Date()) {
  const scene = body?.scene;
  const program = snapshotProgram(scene);
  const title = (typeof body.title === 'string' ? body.title : 'Lesson').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) || 'Lesson';
  const createdAt = now.toISOString();
  const day = createdAt.slice(0, 10);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'lesson';
  const id = `${day}/${createdAt.slice(11, 19).replaceAll(':', '-')}-${slug}-${randomUUID().slice(0, 8)}`;
  const savedScene = { ...scene, elements: scene.elements.filter((el) => !isOverlay(el)),
    verifier: { ...scene.verifier, ...(scene.verifier.execution ? { result: null } : {}),
      language: program.language, snapshot: { title, createdAt } } };
  // Compact JSON keeps large stroke arrays within the board import limit.
  const serialized = JSON.stringify(savedScene) + '\n';
  if (Buffer.byteLength(serialized) > 2_000_000) throw invalid('The saved scene exceeds the 2 MB board import limit.');
  const bundle = await snapshotBundle(savedScene, program);
  const files = new Map([['board.excalidraw', serialized], [languageInfo(program.language).file, program.source], ['input.txt', program.stdin], ...bundle.files]);
  files.set('lib.lock', bundle.manifest(files));
  return { id, title, createdAt, files };
}

export function createSnapshotStore({ root = resolve(APP, process.env.SNAPSHOT_DIR || 'snapshots'), now = () => new Date() } = {}) {
  root = resolve(root);
  let saving = false;
  const git = async (args, timeout = 8000) => (await execute('git', [
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
    '-c', 'user.name=Boardroom', '-c', 'user.email=boardroom@localhost', '-C', root, ...args,
  ], { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;

  async function hasHistory() {
    try { return (await stat(join(root, '.git'))).isDirectory(); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  const sync = createSnapshotSync({ git, hasHistory });

  return {
    syncStatus: sync.status,
    retrySync: sync.sync,
    startSync: sync.start,
    stopSync: sync.stop,
    async save(body) {
      if (saving) throw invalid('A snapshot is already being saved. Try again shortly.', 429);
      saving = true;
      try {
        const { id, title, createdAt, files } = await prepareSnapshot(body, now());
        const day = createdAt.slice(0, 10);
        const parent = join(root, day);
        await mkdir(parent, { recursive: true, mode: 0o700 });
        const temporary = await mkdtemp(join(parent, '.pending-'));
        try {
          for (const [name, content] of files) {
            if (name.startsWith('lib/')) await mkdir(join(temporary, 'lib'), { recursive: true, mode: 0o700 });
            await writeFile(join(temporary, name), content, { mode: 0o600 });
          }
          await rename(temporary, join(root, id));
        } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
        const result = { id, title, createdAt, commit: null };
        try {
          const paths = [...files.keys()].map((name) => `${id}/${name}`);
          await git(['init', '--quiet']);
          await git(['add', '--force', '--', ...paths]);
          // Only commit this new folder, even if the local archive has other staged work.
          await git(['commit', '--quiet', '--only', `--date=${createdAt}`, '-m', `board: ${title}`, '--', ...paths]);
          result.commit = (await git(['rev-parse', 'HEAD'])).trim();
          sync.queue();
        } catch {
          result.warning = 'Files were saved, but Git history could not be recorded. Check that Git is installed and the snapshot repository is writable, then commit the saved folder manually.';
        }
        return result;
      } finally { saving = false; }
    },
    async list() {
      if (!await hasHistory()) return [];
      // One log query returns both commit metadata and each snapshot's unique path.
      let output;
      try { output = await git(['log', '-30', '--format=%x1e%H%x00%aI%x00%s', '--name-only']); }
      catch (error) {
        if (/does not have any commits|bad default revision/.test(error.stderr ?? '')) return [];
        throw invalid('Could not read lesson history. Check Git and snapshot directory permissions.', 503);
      }
      return output.split('\x1e').slice(1).flatMap((record) => {
        const [header, ...paths] = record.split('\n');
        const [commit, createdAt, subject] = header.split('\0');
        const path = paths.find((name) => name.endsWith('/board.excalidraw'));
        const id = path?.slice(0, -'/board.excalidraw'.length);
        return id && SNAPSHOT_ID.test(id) ? [{ id, commit, createdAt, title: subject.replace(/^board: /, '') }] : [];
      });
    },
    async read(id) {
      if (!SNAPSHOT_ID.test(id)) throw invalid('Snapshot not found.', 404);
      try { return JSON.parse(await git(['show', `HEAD:${id}/board.excalidraw`])); }
      catch { throw invalid('Snapshot not found in Git history.', 404); }
    },
    async libraries(id) {
      if (!SNAPSHOT_ID.test(id)) throw invalid('Snapshot not found.', 404);
      let rawManifest;
      try { rawManifest = await git(['show', `HEAD:${id}/lib.lock`]); }
      catch {
        // Snapshots from before portable bundles have no vendored headers.
        try { await git(['cat-file', '-e', `HEAD:${id}/board.excalidraw`]); }
        catch { throw invalid('Snapshot not found in Git history.', 404); }
        return { legacy: true, headers: [] };
      }
      let manifest;
      try { manifest = JSON.parse(rawManifest); }
      catch { throw invalid('Saved library manifest is unreadable.', 503); }
      if (!manifest || typeof manifest.files !== 'object' || !manifest.files || Array.isArray(manifest.files)) {
        throw invalid('Saved library manifest is unreadable.', 503);
      }
      const names = Object.keys(manifest.files ?? {}).filter((path) =>
        path.startsWith('lib/') && HISTORICAL_HEADERS.has(path.slice(4))).sort();
      let headers;
      try {
        headers = await Promise.all(names.map(async (path) => {
          const file = path.slice(4);
          const [saved, current] = await Promise.all([
            git(['show', `HEAD:${id}/${path}`]), readFile(join(APP, 'runner/lib', file), 'utf8'),
          ]);
          return { file, saved, current, changed: saved !== current };
        }));
      } catch { throw invalid('Could not read the saved library files.', 503); }
      return { legacy: false, headers };
    },
  };
}
