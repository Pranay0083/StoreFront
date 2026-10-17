import busboy from 'busboy';
import { parse } from 'csv-parse';
import type { Request } from 'express';
import mongoose, { Schema, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { AppError, BadRequestError, NotFoundError } from '../../core/errors';
import type { JobQueue } from '../../core/queue/job-queue';
import { slugify, type CatalogService } from '../catalog/catalog.service';
import { ProductModel } from '../catalog/product.model';
import { IMPORT_COLUMNS, parseRow } from './import-row';

export const PROCESS_IMPORT_JOB = 'catalog.import';
const BUCKET = 'imports';
const MAX_STORED_ERRORS = 1_000;
const PROGRESS_EVERY_ROWS = 25;

export const IMPORT_STATUSES = ['queued', 'processing', 'completed', 'completed_with_errors', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface ImportRowError {
  row: number;
  slug?: string;
  errors: string[];
}

export interface ImportRecord {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  filename: string;
  sha256: string;
  size: number;
  status: ImportStatus;
  createdBy: string;
  bytesRead: number;
  rows: number;
  created: number;
  updated: number;
  failed: number;
  errors: ImportRowError[];
  errorsTruncated: boolean;
  failure?: string;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const importSchema = new Schema<ImportRecord>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true },
    sha256: { type: String, required: true },
    size: { type: Number, required: true },
    status: { type: String, enum: IMPORT_STATUSES, required: true },
    createdBy: { type: String, required: true },
    bytesRead: { type: Number, default: 0 },
    rows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    errors: [{ _id: false, row: Number, slug: String, errors: [String] }],
    errorsTruncated: { type: Boolean, default: false },
    failure: String,
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true, versionKey: false, suppressReservedKeysWarning: true },
);
importSchema.index({ sha256: 1 }, { unique: true });
importSchema.index({ createdAt: -1 });
export const ProductImportModel = mongoose.model<ImportRecord>('ProductImport', importSchema, 'product_imports');

export interface ImportView extends Omit<ImportRecord, '_id' | 'fileId' | 'errors'> {
  id: string;
  progress: number;
  errorCount: number;
}

const view = (r: ImportRecord): ImportView => {
  const { _id, fileId: _fileId, errors, ...rest } = r;
  const done = r.status === 'completed' || r.status === 'completed_with_errors' || r.status === 'failed';
  return {
    ...rest,
    id: String(_id),
    errorCount: errors?.length ?? 0,
    progress: done ? 1 : r.size ? Math.min(0.99, r.bytesRead / r.size) : 0,
  };
};

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export class ImportsService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly jobs: JobQueue,
    private readonly logger: Logger,
    private readonly options: { maxBytes: number; maxRows: number },
  ) {}

  register(): void {
    this.jobs.register<{ importId: string }>({
      name: PROCESS_IMPORT_JOB,
      queue: 'maintenance',
      attempts: 3,
      handler: async ({ importId }) => {
        await this.process(importId);
      },
    });
  }

  private bucket() {
    return new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: BUCKET });
  }

  /** Streams the upload into GridFS while hashing it; the same file content is only ever imported once. */
  async upload(req: Request, actor: string): Promise<{ import: ImportView; duplicate: boolean }> {
    const stored = await this.receive(req);
    const existing = await ProductImportModel.findOne({ sha256: stored.sha256 }).lean<ImportRecord>();
    if (existing) {
      await this.bucket().delete(stored.fileId);
      return { import: view(existing), duplicate: true };
    }
    let record: ImportRecord;
    try {
      record = (await ProductImportModel.create({ ...stored, status: 'queued', createdBy: actor, errors: [] })).toObject();
    } catch (e) {
      await this.bucket().delete(stored.fileId);
      if ((e as { code?: number }).code === 11000) {
        const raced = await ProductImportModel.findOne({ sha256: stored.sha256 }).lean<ImportRecord>();
        return { import: view(raced!), duplicate: true };
      }
      throw e;
    }
    await this.jobs.enqueue(PROCESS_IMPORT_JOB, { importId: String(record._id) }, { jobId: `import-${record._id}` });
    return { import: view(record), duplicate: false };
  }

  private receive(req: Request): Promise<{ fileId: Types.ObjectId; filename: string; size: number; sha256: string }> {
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
      return Promise.reject(new BadRequestError('Upload the CSV as multipart/form-data in a "file" field'));
    }
    return new Promise((resolve, reject) => {
      let seen = false;
      const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: this.options.maxBytes } });
      bb.on('file', (field, stream, info) => {
        if (field !== 'file' || seen) {
          stream.resume();
          return;
        }
        seen = true;
        const filename = info.filename || 'upload.csv';
        if (!/\.csv$/i.test(filename)) {
          stream.resume();
          reject(new BadRequestError('Only .csv files can be imported'));
          return;
        }
        const hash = createHash('sha256');
        let size = 0;
        let truncated = false;
        const upload = this.bucket().openUploadStream(filename, { metadata: { contentType: 'text/csv' } });
        stream.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          size += chunk.length;
        });
        stream.on('limit', () => (truncated = true));
        upload.on('error', reject);
        upload.on('finish', async () => {
          if (truncated) {
            await this.bucket().delete(upload.id);
            reject(
              new AppError(413, `CSV files are limited to ${Math.round(this.options.maxBytes / 1024)} KB`, undefined, 'PAYLOAD_TOO_LARGE'),
            );
            return;
          }
          if (size === 0) {
            await this.bucket().delete(upload.id);
            reject(new BadRequestError('The uploaded file is empty'));
            return;
          }
          resolve({ fileId: upload.id, filename, size, sha256: hash.digest('hex') });
        });
        stream.pipe(upload);
      });
      bb.on('error', reject);
      bb.on('close', () => {
        if (!seen) reject(new BadRequestError('Attach the CSV in a "file" field'));
      });
      req.pipe(bb);
    });
  }

  /** Validates and upserts rows by slug, so a retried job converges on the same catalog state. */
  async process(importId: string): Promise<ImportView> {
    const record = await ProductImportModel.findOneAndUpdate(
      { _id: importId, status: { $in: ['queued', 'processing'] } },
      { $set: { status: 'processing', startedAt: new Date(), bytesRead: 0, rows: 0, created: 0, updated: 0, failed: 0, errors: [] } },
      { new: true },
    ).lean<ImportRecord>();
    if (!record) {
      const done = await ProductImportModel.findById(importId).lean<ImportRecord>();
      if (!done) throw new NotFoundError('Import not found');
      return view(done);
    }

    const counters = { bytesRead: 0, rows: 0, created: 0, updated: 0, failed: 0 };
    const errors: ImportRowError[] = [];
    const actor = record.createdBy.replace(/^admin:/, '');
    try {
      const download = this.bucket().openDownloadStream(record.fileId);
      download.on('data', (chunk: Buffer) => (counters.bytesRead += chunk.length));
      const parser = download.pipe(
        parse({
          columns: (header: string[]) => {
            const columns = header.map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
            const missing = ['title', 'category', 'price', 'images', 'sizes'].filter(c => !columns.includes(c));
            if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);
            return columns.map(c => ((IMPORT_COLUMNS as readonly string[]).includes(c) ? c : false));
          },
          bom: true,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
        }),
      );
      for await (const raw of parser as AsyncIterable<Record<string, string>>) {
        counters.rows++;
        const rowNumber = counters.rows + 1;
        if (counters.rows > this.options.maxRows) throw new Error(`Imports are limited to ${this.options.maxRows} rows`);
        const parsed = parseRow(raw);
        if (!parsed.ok) {
          counters.failed++;
          if (errors.length < MAX_STORED_ERRORS) errors.push({ row: rowNumber, slug: raw.slug || undefined, errors: parsed.errors });
        } else {
          try {
            const slug = parsed.product.slug || slugify(parsed.product.title);
            const existing = await ProductModel.findOne({ slug }, { _id: 1 }).lean<{ _id: Types.ObjectId }>();
            if (existing) {
              const { slug: _slug, ...patch } = parsed.product;
              await this.catalog.update(String(existing._id), patch, actor);
              counters.updated++;
            } else {
              await this.catalog.create({ ...parsed.product, slug }, actor);
              counters.created++;
            }
          } catch (e) {
            counters.failed++;
            if (errors.length < MAX_STORED_ERRORS)
              errors.push({ row: rowNumber, slug: raw.slug || undefined, errors: [(e as Error).message] });
          }
        }
        if (counters.rows % PROGRESS_EVERY_ROWS === 0) await ProductImportModel.updateOne({ _id: record._id }, { $set: { ...counters } });
      }
      const status: ImportStatus = counters.failed ? 'completed_with_errors' : 'completed';
      const finished = await ProductImportModel.findByIdAndUpdate(
        record._id,
        {
          $set: {
            ...counters,
            bytesRead: record.size,
            status,
            errors,
            errorsTruncated: counters.failed > errors.length,
            finishedAt: new Date(),
          },
        },
        { new: true },
      ).lean<ImportRecord>();
      this.logger.info({ importId, ...counters }, 'Product CSV import finished');
      return view(finished!);
    } catch (e) {
      const failure = (e as Error).message;
      const failed = await ProductImportModel.findByIdAndUpdate(
        record._id,
        { $set: { ...counters, status: 'failed', failure, errors, finishedAt: new Date() } },
        { new: true },
      ).lean<ImportRecord>();
      this.logger.warn({ importId, failure }, 'Product CSV import failed');
      return view(failed!);
    }
  }

  async list(limit = 20): Promise<ImportView[]> {
    return (await ProductImportModel.find().sort({ createdAt: -1 }).limit(limit).lean<ImportRecord[]>()).map(view);
  }

  async get(id: string): Promise<ImportView & { errors: ImportRowError[] }> {
    const record = await this.require(id);
    return { ...view(record), errors: record.errors.slice(0, 50) };
  }

  async errorReport(id: string): Promise<{ filename: string; csv: string }> {
    const record = await this.require(id);
    const lines = [
      'row,slug,error',
      ...record.errors.flatMap(e => e.errors.map(msg => [String(e.row), e.slug ?? '', msg].map(csvCell).join(','))),
    ];
    if (record.failure) lines.push(['', '', `Import failed: ${record.failure}`].map(csvCell).join(','));
    return { filename: `${record.filename.replace(/\.csv$/i, '')}-errors.csv`, csv: `${lines.join('\n')}\n` };
  }

  private async require(id: string): Promise<ImportRecord> {
    const record = Types.ObjectId.isValid(id) ? await ProductImportModel.findById(id).lean<ImportRecord>() : null;
    if (!record) throw new NotFoundError('Import not found');
    return record;
  }
}
