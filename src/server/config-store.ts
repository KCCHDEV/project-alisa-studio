import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ConfigReadResult<T> {
  value: T | null;
  source: string | null;
  repaired: boolean;
  errors: string[];
}

export interface AtomicJsonStoreOptions {
  backupCount?: number;
  legacyPaths?: string[];
}

export interface AtomicJsonWriteOptions {
  /** Keep existing backups untouched while repairing a missing/corrupt primary. */
  rotateBackups?: boolean;
  /** Preserve an unusable primary file for diagnostics before replacing it. */
  archivePrimary?: boolean;
}

/**
 * Small, synchronous JSON store for app-critical state.
 *
 * Writes happen in the same directory as the primary file, are flushed before
 * rename, and keep rolling copies. A process crash can therefore leave either
 * the old complete file or the new complete file, never a half-written JSON
 * document.
 */
export class AtomicJsonStore<T extends object> {
  readonly filePath: string;
  readonly backupPaths: string[];

  private readonly legacyPaths: string[];
  private readonly temporaryPrefix: string;

  constructor(filePath: string, options: AtomicJsonStoreOptions = {}) {
    this.filePath = path.resolve(filePath);
    const backupCount = Math.max(0, Math.min(10, Math.floor(options.backupCount ?? 3)));
    this.backupPaths = Array.from(
      { length: backupCount },
      (_, index) => `${this.filePath}.bak${index + 1}`,
    );
    this.legacyPaths = (options.legacyPaths || []).map(candidate => path.resolve(candidate));
    this.temporaryPrefix = `${path.basename(this.filePath)}.tmp-`;
  }

  read(): ConfigReadResult<T> {
    const candidates = [
      this.filePath,
      ...this.backupPaths,
      ...this.listTemporaryFiles(),
      ...this.legacyPaths,
    ];
    const errors: string[] = [];

    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('config root must be a JSON object');
        }
        try { fs.chmodSync(candidate, 0o600); } catch { /* Best effort on Windows. */ }
        return {
          value: parsed as T,
          source: candidate,
          repaired: candidate !== this.filePath,
          errors,
        };
      } catch (error) {
        errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { value: null, source: null, repaired: errors.length > 0, errors };
  }

  write(value: T, options: AtomicJsonWriteOptions = {}): void {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const runtimeDir = path.dirname(this.filePath);
    this.ensurePrivateDirectory(runtimeDir);

    const rotateBackups = options.rotateBackups !== false;
    if (options.archivePrimary && fs.existsSync(this.filePath)) {
      this.archivePrimary(runtimeDir);
    }
    if (rotateBackups) {
      this.rotateBackups();
    }

    const temporaryFile = path.join(
      runtimeDir,
      `${path.basename(this.filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(temporaryFile, 'w', 0o600);
      fs.writeFileSync(fileDescriptor, serialized, 'utf8');
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = undefined;
      try { fs.chmodSync(temporaryFile, 0o600); } catch { /* Best effort on Windows. */ }

      this.replacePrimary(temporaryFile);
      try { fs.chmodSync(this.filePath, 0o600); } catch { /* Best effort on Windows. */ }
      this.fsyncDirectory(runtimeDir);
      this.cleanupTemporaryFiles();
    } catch (error) {
      if (fileDescriptor !== undefined) {
        try { fs.closeSync(fileDescriptor); } catch { /* Nothing else to do. */ }
      }
      throw error;
    } finally {
      if (fs.existsSync(temporaryFile)) {
        try { fs.unlinkSync(temporaryFile); } catch { /* Keep it for recovery on the next launch. */ }
      }
    }
  }

  private ensurePrivateDirectory(directory: string): void {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch { /* Best Effort on Windows. */ }
  }

  private listTemporaryFiles(): string[] {
    const directory = path.dirname(this.filePath);
    try {
      return fs.readdirSync(directory)
        .filter(name => name.startsWith(this.temporaryPrefix))
        .map(name => path.join(directory, name))
        .filter(candidate => {
          try { return fs.statSync(candidate).isFile(); } catch { return false; }
        })
        .sort((left, right) => {
          try { return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs; } catch { return 0; }
        });
    } catch {
      return [];
    }
  }

  private rotateBackups(): void {
    for (let index = this.backupPaths.length - 1; index > 0; index -= 1) {
      const previous = this.backupPaths[index - 1];
      const next = this.backupPaths[index];
      if (!fs.existsSync(previous)) continue;
      fs.copyFileSync(previous, next);
      try { fs.chmodSync(next, 0o600); } catch { /* Best effort on Windows. */ }
    }
    if (this.backupPaths[0] && fs.existsSync(this.filePath)) {
      fs.copyFileSync(this.filePath, this.backupPaths[0]);
      try { fs.chmodSync(this.backupPaths[0], 0o600); } catch { /* Best effort on Windows. */ }
    }
  }

  private archivePrimary(runtimeDir: string): void {
    const archivePath = path.join(
      runtimeDir,
      `${path.basename(this.filePath)}.corrupt-${Date.now()}`,
    );
    fs.copyFileSync(this.filePath, archivePath);
    try { fs.chmodSync(archivePath, 0o600); } catch { /* Best effort on Windows. */ }
  }

  private replacePrimary(temporaryFile: string): void {
    try {
      fs.renameSync(temporaryFile, this.filePath);
      return;
    } catch (error) {
      // POSIX rename replaces atomically. Windows may reject that replacement;
      // move the already-backed-up old file aside and restore it if needed.
      if (process.platform !== 'win32' || !fs.existsSync(this.filePath)) throw error;
    }

    const displacedFile = `${this.filePath}.replace-${process.pid}-${Date.now()}`;
    fs.renameSync(this.filePath, displacedFile);
    try {
      fs.renameSync(temporaryFile, this.filePath);
      try { fs.unlinkSync(displacedFile); } catch { /* Old copy is recoverable as a backup. */ }
    } catch (error) {
      try { fs.renameSync(displacedFile, this.filePath); } catch { /* Backups still protect the previous value. */ }
      throw error;
    }
  }

  private fsyncDirectory(directory: string): void {
    let directoryDescriptor: number | undefined;
    try {
      directoryDescriptor = fs.openSync(directory, 'r');
      fs.fsyncSync(directoryDescriptor);
    } catch {
      // Directory fsync is not available on every supported platform/filesystem.
    } finally {
      if (directoryDescriptor !== undefined) {
        try { fs.closeSync(directoryDescriptor); } catch { /* Best effort. */ }
      }
    }
  }

  private cleanupTemporaryFiles(): void {
    for (const candidate of this.listTemporaryFiles()) {
      try { fs.unlinkSync(candidate); } catch { /* A future launch can recover it. */ }
    }
  }
}
